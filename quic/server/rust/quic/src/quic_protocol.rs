use anyhow::{          
    Context,
    Result
};
use bytes::{         
    Bytes,                
    BytesMut,             
    Buf
};
use crossbeam::queue::SegQueue;
use std::sync::atomic::{        
    AtomicU64, 
    AtomicUsize, 
    Ordering
};           

use h3::{      
    ext::Protocol,
    server::{
        Connection,
        RequestResolver
    },
};                                                           
use h3_webtransport::server::WebTransportSession;           
use http::Method;                                                  
use urlencoding::decode;                                     
use serde_json;                                              
use std::{
    path::{Path, PathBuf},
    sync::Arc,                                         
    time::{Duration, Instant},
};
use tokio::{
    fs::{create_dir_all, File},                             
    io::{AsyncReadExt, AsyncWriteExt, BufReader},           
    sync::{mpsc, Semaphore},                                 
};
use tracing::{debug, error, info, instrument, trace, warn};   

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

// Rate limiting: Upload operations are more resource-intensive (disk I/O, parsing)
// so we limit them more aggressively than downloads
const MAX_CONCURRENT_UPLOADS: usize = 50;
// Downloads are primarily network-bound, so we can handle more concurrent operations
const MAX_CONCURRENT_DOWNLOADS: usize = 100;

// Session timeout: 30 minutes allows for large file transfers while preventing
// resource leaks from abandoned connections
const SESSION_TIMEOUT: Duration = Duration::from_secs(1800); // 30 minutes

// Heartbeat interval: 5 seconds provides good balance between connection health
// monitoring and network overhead
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

// Stream accept timeout: 600 seconds gives clients time to establish streams
// while preventing indefinite waiting that could exhaust server resources
const STREAM_ACCEPT_TIMEOUT: Duration = Duration::from_secs(600);

// Buffer sizes optimized for different use cases:
// Small buffers (64KB) for metadata and control messages, which fits in L2 cache
const SMALL_BUFFER_SIZE: usize = 64 * 1024; // 64KB
// Large buffers (256KB) for file data, which balances memory usage with I/O efficiency
const LARGE_BUFFER_SIZE: usize = 256 * 1024; // 256KB
// Read chunk size (16KB) optimized for streaming reads, which reduces syscall overhead
// while maintaining responsiveness
const READ_CHUNK_SIZE: usize = 16 * 1024; // 16KB for stream reads

// ============================================================================
// ZERO-COPY BUFFER POOL
// ============================================================================

// Global buffer pool using lazy initialization to avoid static initialization order issues
// Memory allocation is expensive in hot paths. Reusing buffers eliminates allocation overhead.
// Pre-allocated buffers are stored in lock-free queues and reused across requests.
static BUFFER_POOL: once_cell::sync::Lazy<Arc<BufferPool>> =
    once_cell::sync::Lazy::new(|| Arc::new(BufferPool::new(SMALL_BUFFER_SIZE, 64, LARGE_BUFFER_SIZE, 16)));

struct BufferPool {
    // Lock-free queue for small buffers, which means no contention between threads
    small_buffers: SegQueue<BytesMut>,
    small_buffer_size: usize,
    // Atomic counter to track pool size without locking the queue
    small_pool_count: AtomicUsize,
    max_small_pool_size: usize,
    
    // Separate pool for large buffers to avoid fragmentation
    large_buffers: SegQueue<BytesMut>,
    large_buffer_size: usize,
    // Atomic counter prevents unbounded growth of the pool
    large_pool_count: AtomicUsize,
    max_large_pool_size: usize,
}

impl BufferPool {
    fn new(
        small_buffer_size: usize,
        max_small_pool_size: usize,
        large_buffer_size: usize,
        max_large_pool_size: usize,
    ) -> Self {
        Self {
            small_buffers: SegQueue::new(),
            small_buffer_size,
            small_pool_count: AtomicUsize::new(0),
            max_small_pool_size,
            large_buffers: SegQueue::new(),
            large_buffer_size,
            large_pool_count: AtomicUsize::new(0),
            max_large_pool_size,
        }
    }

    #[allow(dead_code)]
    fn get_small_buffer(&self) -> BytesMut {
        // Try to reuse a buffer from the pool first
        // Avoids memory allocation overhead in hot paths
        // Lock-free pop operation, with atomic counter update for tracking
        self.small_buffers
            .pop()
            .map(|buf| {
                // Update pool size atomically, relaxed ordering is sufficient
                // because we only need eventual consistency for pool metrics
                self.small_pool_count.fetch_sub(1, Ordering::Relaxed);
                buf
            })
            // If pool is empty, allocate a new buffer with the desired capacity
            .unwrap_or_else(|| BytesMut::with_capacity(self.small_buffer_size))
    }

    fn get_large_buffer(&self) -> BytesMut {
        // Same pattern as small buffers but for large buffer pool
        // Separate pools prevent fragmentation and optimize for different use cases
        self.large_buffers
            .pop()
            .map(|buf| {
                self.large_pool_count.fetch_sub(1, Ordering::Relaxed);
                buf
            })
            .unwrap_or_else(|| BytesMut::with_capacity(self.large_buffer_size))
    }

    fn return_buffer(&self, mut buffer: BytesMut) {
        let capacity = buffer.capacity();
        
        // Check if buffer belongs in large buffer pool
        // 10% tolerance allows for slight capacity variations from allocator
        // Range check ensures we only pool appropriately-sized buffers
        if capacity >= self.large_buffer_size * 9 / 10 && capacity <= self.large_buffer_size * 11 / 10 {
            let current_count = self.large_pool_count.load(Ordering::Relaxed);
            // Prevent unbounded pool growth which could lead to memory leaks
            if current_count < self.max_large_pool_size {
                // Clear buffer data but preserve capacity for reuse
                buffer.clear();
                self.large_buffers.push(buffer);
                // Atomically update pool size for tracking
                self.large_pool_count.fetch_add(1, Ordering::Relaxed);
            }
            // If pool is full, buffer is dropped and memory is freed
        } else if capacity >= self.small_buffer_size * 9 / 10 && capacity <= self.small_buffer_size * 11 / 10 {
            // Same logic for small buffer pool
            let current_count = self.small_pool_count.load(Ordering::Relaxed);
            if current_count < self.max_small_pool_size {
                buffer.clear();
                self.small_buffers.push(buffer);
                self.small_pool_count.fetch_add(1, Ordering::Relaxed);
            }
        }
        // Buffers with unexpected sizes are dropped to prevent pool contamination
    }

    // Expose metrics for monitoring and debugging
    // Pool metrics help diagnose memory usage patterns and tune pool sizes
    #[allow(dead_code)]
    pub fn small_pool_size(&self) -> usize {
        // Relaxed ordering is sufficient for metrics, as we don't need precise values
        self.small_pool_count.load(Ordering::Relaxed)
    }

    #[allow(dead_code)]
    pub fn large_pool_size(&self) -> usize {
        self.large_pool_count.load(Ordering::Relaxed)
    }
}

// ============================================================================
// METADATA STRUCTURES
// ============================================================================

// File metadata extracted from JSON headers in upload streams
// Each file upload starts with a JSON line containing metadata
// Parsed from incoming stream data before file content begins
#[derive(Debug)]
struct FileMetadata {
    filename: String,
    // Upload ID for tracking and organizing uploads, which used for directory structure
    #[allow(dead_code)]
    upload_id: String,
    // Optional file size for progress tracking and validation
    #[allow(dead_code)]
    size: Option<u64>,
}

impl FileMetadata {
    // Zero-copy parsing, which works directly with byte slices without string conversion
    // Avoids unnecessary memory allocation and copying for JSON parsing
    // serde_json::from_slice operates directly on bytes
    fn from_bytes(data: &[u8]) -> Result<Self> {
        let value: serde_json::Value = serde_json::from_slice(data)
            .context("Failed to parse metadata JSON")?;
        
        // Extract required filename field with proper error handling
        let filename = value.get("filename")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing filename field"))?
            .to_string();
        
        // Extract required upload ID for organizing files into directories
        let upload_id = value.get("uploadId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uploadId field"))?
            .to_string();
        
        // Optional size field for progress tracking, it gracefully handles missing values
        let size = value.get("size")
            .and_then(|v| v.as_u64());
        
        Ok(Self {
            filename,
            upload_id,
            size,
        })
    }

    fn sanitize_filename(&self) -> String {
        // Prevent path traversal attacks and filesystem conflicts
        // Untrusted filenames could escape upload directories or overwrite system files
        // Replace dangerous characters with safe alternatives
        self.filename
            .replace("..", "")  // Remove parent directory references
            .replace('/', "_")  // Replace path separators with underscores
            .replace('\\', "_") // Handle Windows-style path separators
    }
}

// ============================================================================
// LOCK-FREE SESSION STATE
// ============================================================================

// Session state tracking without locks to avoid contention in high-throughput scenarios
// Multiple threads need to update activity timestamps concurrently
// Atomic operations provide thread-safe updates without blocking
struct SessionState {
    id: String,
    // Atomic timestamp storage, no locks needed for concurrent access
    last_active_nanos: AtomicU64,
}

impl SessionState {
    fn new(id: String) -> Self {
        Self {
            id,
            // Initialize with current time to avoid immediate timeout
            last_active_nanos: AtomicU64::new(Self::now_nanos()),
        }
    }

    fn now_nanos() -> u64 {
        // Nanoseconds provides high resolution for activity tracking
        // Note: This actually measures time since program start, not absolute time
        Instant::now().elapsed().as_nanos() as u64
    }

    fn update_activity(&self) {
        // Relaxed ordering is ok, we only need eventual consistency for activity tracking
        // Slight delays in activity updates don't affect correctness
        self.last_active_nanos.store(Self::now_nanos(), Ordering::Relaxed);
    }

    fn inactive_duration(&self) -> Duration {
        let last = self.last_active_nanos.load(Ordering::Relaxed);
        let now = Self::now_nanos();
        // Saturating subtraction prevents underflow if clocks are inconsistent
        Duration::from_nanos(now.saturating_sub(last))
    }
}

// ============================================================================
// DIRECTORY MANAGEMENT
// ============================================================================

// Create and validate upload directories for organizing files by upload session
// Separate directories prevent file conflicts between concurrent uploads
// Sanitize upload ID and create directory structure atomically
async fn ensure_upload_directory(base_dir: &Path, upload_id: &str) -> Result<PathBuf> {
    // Sanitize upload_id to prevent directory traversal attacks
    // Untrusted upload IDs could create directories outside the base path
    // Whitelist only safe characters (alphanumeric, dash, underscore)
    let safe_upload_id = upload_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();

    // Reject empty upload IDs that would result in invalid directory names
    if safe_upload_id.is_empty() {
        return Err(anyhow::anyhow!("Invalid upload ID"));
    }

    let upload_dir = base_dir.join(&safe_upload_id);
    // Async directory creation, which won't block the thread
    // create_dir_all creates parent directories if they don't exist
    create_dir_all(&upload_dir)
        .await
        .context("Failed to create upload directory")?;

    Ok(upload_dir)
}

// ============================================================================
// HEARTBEAT MANAGEMENT
// ============================================================================

// Spawn a background task to maintain connection health with periodic heartbeats
// WebTransport connections can silently fail due to network issues or NAT timeouts
// Send periodic datagrams and track failures to detect dead connections
fn spawn_heartbeat_task(
    session: &WebTransportSession<h3_quinn::Connection, Bytes>,
    session_state: Arc<SessionState>,
) -> tokio::task::JoinHandle<()> {
    let mut datagram_sender = session.datagram_sender();
    
    tokio::spawn(async move {
        // Regular interval timer for consistent heartbeat timing
        let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
        let mut consecutive_failures = 0;

        loop {
            interval.tick().await;

            // Graceful shutdown condition -> Inactive sessions with failures indicate dead connections
            // Combine inactivity timeout with failure count to avoid premature shutdowns
            if session_state.inactive_duration() > SESSION_TIMEOUT
                && consecutive_failures > 3
            {
                info!("Session {} inactive, stopping heartbeats", session_state.id);
                break;
            }

            // Send lightweight ping datagram to test connection health
            // Datagrams are unreliable but have lower overhead than streams
            match datagram_sender.send_datagram(Bytes::from_static(b"ping")) {
                Ok(_) => {
                    // Reset failure counter on successful send
                    consecutive_failures = 0;
                    trace!("Heartbeat sent for session {}", session_state.id);
                }
                Err(e) => {
                    consecutive_failures += 1;
                    warn!(
                        "Heartbeat failed for session {}: {:?} (failures: {})",
                        session_state.id, e, consecutive_failures
                    );
                    // Fail-fast: Too many consecutive failures indicate permanent connection loss
                    if consecutive_failures > 5 {
                        error!("Too many heartbeat failures, stopping");
                        break;
                    }
                }
            }
        }
    })
}

// ============================================================================
// FILE UPLOAD PROCESSING
// ============================================================================

// Manages writing data to individual files with performance tracking
// Abstracts file I/O operations and provides metrics for monitoring
// Tracks bytes written and timing for throughput calculations
struct FileWriter {
    file: File,
    path: PathBuf,
    bytes_written: u64,
    start_time: Instant, // For calculating write throughput
}

impl FileWriter {
    async fn new(path: PathBuf) -> Result<Self> {
        // Create file asynchronously to avoid blocking the thread
        let file = File::create(&path)
            .await
            .context("Failed to create file")?;
        Ok(Self {
            file,
            path,
            bytes_written: 0,
            start_time: Instant::now(), // Start timing from file creation
        })
    }

    // Zero-copy write, it works directly with byte slices without intermediate buffers
    // Minimizes memory copies in the critical path for maximum throughput
    // Direct write_all call passes data straight to the kernel
    async fn write(&mut self, data: &[u8]) -> Result<()> {
        self.file.write_all(data).await?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    async fn finalize(mut self) -> Result<()> {
        // Ensure all data is written to disk before considering the file complete
        self.file.flush().await?;
        let elapsed = self.start_time.elapsed().as_secs_f64();
        // Calculate throughput for performance monitoring
        let rate = if elapsed > 0.0 {
            self.bytes_written as f64 / elapsed / 1_000_000.0 // Convert to MB/s
        } else {
            0.0
        };
        info!(
            "Completed file: {:?} ({} bytes, {:.2} MB/s)",
            self.path, self.bytes_written, rate
        );
        Ok(())
    }
}

// State machine for processing upload streams that contain multiple files
// Streams alternate between metadata (JSON) and file data
// State transitions guide parsing logic between metadata and content phases
enum StreamState {
    WaitingForMetadata,      // Expecting JSON metadata line
    WritingFile(FileWriter), // Actively writing file content to disk
}

// Processes incoming upload streams that may contain multiple files
// Upload streams contain interleaved metadata and file data
// State machine tracks current parsing phase and accumulated buffer data
struct StreamProcessor {
    buffer: BytesMut,    // Accumulates incoming data for processing
    state: StreamState,  // Current parsing state
    upload_dir: PathBuf, // Base directory for saving files
}

impl StreamProcessor {
    fn new(upload_dir: PathBuf) -> Self {
        Self {
            buffer: BytesMut::with_capacity(LARGE_BUFFER_SIZE),
            state: StreamState::WaitingForMetadata,
            upload_dir,
        }
    }

    // Zero-copy chunk processing, it combines data accumulation and processing
    // Streaming data arrives in arbitrary chunks, need to buffer for parsing
    // Accumulate chunks in buffer, then process complete logical units
    async fn process_chunk(&mut self, chunk: &[u8]) -> Result<()> {
        self.buffer.extend_from_slice(chunk);
        self.process_buffer().await
    }

    async fn process_buffer(&mut self) -> Result<()> {
        loop {
            match &mut self.state {
                StreamState::WaitingForMetadata => {
                    // Use memchr for SIMD-optimized newline search
                    // Much faster than byte-by-byte iteration for finding delimiters
                    // SIMD instructions can check multiple bytes simultaneously
                    if let Some(newline_pos) = memchr::memchr(b'\n', &self.buffer) {
                        // Zero-copy split, which create slice without copying data
                        let metadata_bytes = &self.buffer[..newline_pos];

                        match FileMetadata::from_bytes(metadata_bytes) {
                            Ok(metadata) => {
                                let filename = metadata.sanitize_filename();
                                let filepath = self.upload_dir.join(&filename);
                                
                                info!("Starting file: {}", filename);
                                
                                match FileWriter::new(filepath).await {
                                    Ok(writer) => {
                                        // Advance buffer past processed metadata
                                        self.buffer.advance(newline_pos + 1);
                                        // Transition to file writing state
                                        self.state = StreamState::WritingFile(writer);
                                    }
                                    Err(e) => {
                                        error!("Failed to create file writer: {:?}", e);
                                        // Skip this metadata and continue processing
                                        self.buffer.advance(newline_pos + 1);
                                        continue;
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Invalid metadata: {:?}", e);
                                // Skip invalid metadata line
                                self.buffer.advance(newline_pos + 1);
                                continue;
                            }
                        }
                    } else {
                        // Need more data to find complete metadata line
                        break;
                    }
                }
                StreamState::WritingFile(writer) => {
                    // SIMD-optimized search for next metadata marker (JSON starts with '{')
                    // Need to detect when file content ends and next metadata begins
                    // Fast byte search for JSON opening brace using SIMD instructions
                    if let Some(json_start) = memchr::memchr(b'{', &self.buffer) {
                        // Write file data that appears before the potential metadata
                        if json_start > 0 {
                            writer.write(&self.buffer[..json_start]).await?;
                            self.buffer.advance(json_start);
                        }

                        // Determine if this '{' actually starts metadata or is file content
                        // '{' characters can appear in binary file data, need validation
                        if let Some(newline_pos) = memchr::memchr(b'\n', &self.buffer) {
                            let potential_metadata = &self.buffer[..newline_pos];

                            // Heuristic: Real metadata contains "filename" field and starts with '{'
                            // Use memchr for fast substring search
                            if memchr::memmem::find(potential_metadata, b"\"filename\"").is_some()
                                && potential_metadata.starts_with(b"{")
                            {
                                // This is actual metadata; Finalize current file
                                let current_writer =
                                    std::mem::replace(&mut self.state, StreamState::WaitingForMetadata);
                                if let StreamState::WritingFile(w) = current_writer {
                                    w.finalize().await?;
                                }
                                // Process the metadata in next iteration
                                continue;
                            } else {
                                // False positive; This is file content, not metadata
                                writer.write(&self.buffer[..=newline_pos]).await?;
                                self.buffer.advance(newline_pos + 1);
                            }
                        } else {
                            // Not enough data to determine if this is metadata
                            break;
                        }
                    } else {
                        // No potential metadata marker found; Write all remaining data
                        if !self.buffer.is_empty() {
                            let len = self.buffer.len();
                            writer.write(&self.buffer[..]).await?;
                            self.buffer.advance(len);
                        }
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    async fn finalize(self) -> Result<()> {
        // Write any remaining buffered data and finalize the current file
        // Stream end might occur while writing a file, need to flush remaining data
        if let StreamState::WritingFile(mut writer) = self.state {
            if !self.buffer.is_empty() {
                writer.write(&self.buffer).await?;
            }
            writer.finalize().await?;
        }
        // If state is WaitingForMetadata, no cleanup needed
        Ok(())
    }
}

// ============================================================================
// CONNECTION HANDLING
// ============================================================================

// Entry point for handling new QUIC connections
// Each QUIC connection can multiplex multiple HTTP/3 requests
// Accept connection and delegate to request handling logic
pub async fn handle_connection(
    mut conn: Connection<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
    upload_semaphore: Arc<Semaphore>,
    download_semaphore: Arc<Semaphore>,
) -> Result<()> {
    // Accept the first request on this connection
    // HTTP/3 connections start with a request that establishes the session
    if let Ok(Some(resolver)) = conn.accept().await {
        handle_request(resolver, conn, files_dir, upload_semaphore, download_semaphore).await;
    }
    Ok(())
}

// Route incoming HTTP/3 requests to appropriate handlers based on URL path
// Different paths indicate different operations (upload vs download)
// Pattern match on request method and protocol, then route by URL path
async fn handle_request(
    resolver: RequestResolver<h3_quinn::Connection, Bytes>,
    conn: Connection<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
    upload_semaphore: Arc<Semaphore>,
    download_semaphore: Arc<Semaphore>,
) {
    // Resolve the HTTP/3 request to get headers and stream
    let (req, stream) = match resolver.resolve_request().await {
        Ok(req) => req,
        Err(err) => {
            error!("Failed to resolve request: {:?}", err);
            return;
        }
    };

    // Only handle WebTransport CONNECT requests
    // WebTransport uses HTTP CONNECT method with WebTransport protocol extension
    // Check both method and protocol extension to identify WebTransport requests
    if let (&Method::CONNECT, Some(&Protocol::WEB_TRANSPORT)) =
        (req.method(), req.extensions().get::<Protocol>())
    {
        let path = req.uri().path().to_string();

        // Route upload requests: /upload/{upload_id}
        if let Some(upload_id) = path.strip_prefix("/upload/") {
            let upload_id = upload_id.to_string();
            // Accept WebTransport session for bidirectional communication  
            let session = match WebTransportSession::accept(req, stream, conn).await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to accept upload session: {:?}", e);
                    return;
                }
            };
            info!("Accepted upload session: {}", upload_id);
            
            // Handle the upload session with rate limiting
            if let Err(e) = handle_upload_session(session, files_dir, upload_id, upload_semaphore).await {
                error!("Upload session error: {:?}", e);
            }
        // Route download requests: /download/{filename}
        } else if let Some(filename) = path.strip_prefix("/download/") {
            let session = match WebTransportSession::accept(req, stream, conn).await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to accept download session: {:?}", e);
                    return;
                }
            };
            info!("Accepted download session: {}", filename);
            
            // Handle the download session with rate limiting
            if let Err(e) = handle_download_session(session, files_dir, filename, download_semaphore).await {
                error!("Download session error: {:?}", e);
            }
        } else {
            // Reject unknown paths to prevent resource waste
            warn!("Unknown path: {}", path);
        }
    }
    // Non-WebTransport requests are silently ignored
}

// ============================================================================
// UPLOAD SESSION
// ============================================================================

// Handle a complete upload session that may contain multiple files
// WebTransport sessions can receive multiple unidirectional streams
// Accept streams concurrently while managing session lifecycle
#[instrument(skip_all, fields(upload_id = %upload_id))]
async fn handle_upload_session(
    session: WebTransportSession<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
    upload_id: String,
    semaphore: Arc<Semaphore>,
) -> Result<()> {
    // Acquire permit for rate limiting, it is released automatically when dropped
    // Prevent resource exhaustion from too many concurrent uploads
    let _permit = semaphore.acquire().await?;
    
    // Track session activity for timeout management
    let session_state = Arc::new(SessionState::new(upload_id.clone()));
    // Channel for coordinating graceful shutdown
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // Create dedicated directory for this upload session
    // Prevents file conflicts between concurrent uploads
    let upload_dir = ensure_upload_directory(&files_dir, &upload_id).await?;

    // Start background heartbeat task to maintain connection health
    let heartbeat_handle = spawn_heartbeat_task(&session, session_state.clone());

    // Process incoming streams concurrently
    // WebTransport allows multiple parallel streams for better performance
    // Accept streams in a loop and process each one independently
    let stream_state = session_state.clone();
    let stream_handle = tokio::spawn(async move {
        // Reusable buffer for reading stream data, only allocated once per session
        let mut read_buffer = BytesMut::with_capacity(READ_CHUNK_SIZE);
        
        // Accept streams with timeout to prevent indefinite blocking
        while let Ok(stream_result) =
            tokio::time::timeout(STREAM_ACCEPT_TIMEOUT, session.accept_uni()).await
        {
            match stream_result {
                Ok(Some((_, mut stream))) => {
                    // Update activity timestamp for session timeout management
                    stream_state.update_activity();

                    // Create processor for this stream's file uploads
                    let mut processor = StreamProcessor::new(upload_dir.clone());

                    // Read stream data in chunks
                    loop {
                        // Ensure buffer has adequate capacity for reading
                        // Avoids frequent small reallocations during reads
                        if read_buffer.capacity() - read_buffer.len() < READ_CHUNK_SIZE {
                            read_buffer.reserve(READ_CHUNK_SIZE);
                        }

                        // Zero-copy read directly into BytesMut buffer
                        // Eliminates intermediate buffer copies for better performance
                        match stream.read_buf(&mut read_buffer).await {
                            Ok(0) => break, // End of stream, which means no more data
                            Ok(_) => {
                                stream_state.update_activity();
                                
                                // Process the accumulated data for files and metadata
                                if let Err(e) = processor.process_chunk(&read_buffer).await {
                                    error!("Error processing chunk: {:?}", e);
                                    break;
                                }
                                
                                // Clear processed data to reuse buffer
                                read_buffer.clear();
                            }
                            Err(e) => {
                                error!("Stream read error: {:?}", e);
                                break;
                            }
                        }
                    }

                    // Finalize any remaining file data when stream ends
                    if let Err(e) = processor.finalize().await {
                        error!("Error finalizing processor: {:?}", e);
                    }
                }
                // No more streams or timeout; Signal session completion
                Ok(None) | Err(_) => {
                    let _ = shutdown_tx.send(()).await;
                    break;
                }
            }
        }
    });

    // Wait for session completion or timeout using cooperative concurrency
    // Prevents sessions from running indefinitely and consuming resources
    // Race between shutdown signal and timeout, whichever occurs first
    tokio::select! {
        _ = shutdown_rx.recv() => {
            info!("Upload session completed: {}", upload_id);
        }
        _ = tokio::time::sleep(SESSION_TIMEOUT) => {
            info!("Upload session timed out: {}", upload_id);
        }
    }

    // Clean up background tasks to prevent resource leaks
    heartbeat_handle.abort();
    stream_handle.abort();

    Ok(())
}

// ============================================================================
// DOWNLOAD SESSION
// ============================================================================

// Handle file download requests by streaming file contents to the client
// Large files need streaming to avoid loading entire file into memory
// Read file in chunks and write to WebTransport stream with flow control
#[instrument(skip_all, fields(filename = %filename_encoded))]
async fn handle_download_session(
    session: WebTransportSession<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
    filename_encoded: &str,
    semaphore: Arc<Semaphore>,
) -> Result<()> {
    // Acquire permit for download rate limiting
    // Prevent bandwidth exhaustion from too many concurrent downloads
    let _permit = semaphore.acquire().await?;
    
    // Decode URL-encoded filename from request path
    let filename = decode(filename_encoded)?;
    
    // Sanitize filename to prevent path traversal attacks
    // Malicious clients could request files outside the allowed directory
    // Remove dangerous path components and replace separators
    let safe_filename = filename
        .as_ref()
        .replace("..", "")   // Remove parent directory references
        .replace('/', "_")   // Replace Unix path separators
        .replace('\\', "_"); // Replace Windows path separators
    
    let filepath = files_dir.join(&safe_filename);

    // Early exit if requested file doesn't exist
    if !filepath.exists() {
        error!("File not found: {:?}", filepath);
        return Ok(());
    }

    // Start heartbeat to maintain connection during long downloads
    let session_id = format!("{:?}", session.session_id());
    let heartbeat_handle = spawn_heartbeat_task(
        &session,
        Arc::new(SessionState::new(session_id)),
    );

    // Open unidirectional stream for sending file data to client
    // Downloads are one-way data flows from server to client
    let mut stream = session.open_uni(session.session_id()).await?;
    
    // Open file and get metadata for progress tracking
    let file = File::open(&filepath).await?;
    let file_size = file.metadata().await?.len();
    // Use large buffer for efficient file reading
    let mut reader = BufReader::with_capacity(LARGE_BUFFER_SIZE, file);

    // Get buffer from pool for zero-copy operations
    let mut buffer = BUFFER_POOL.get_large_buffer();
    let mut bytes_sent = 0u64;
    let start_time = Instant::now();
    let mut last_log = Instant::now(); // For periodic progress logging

    // Stream file contents in chunks for memory efficiency
    loop {
        // Ensure buffer has adequate capacity for reading
        // Prevents frequent reallocations during file reading
        if buffer.capacity() - buffer.len() < LARGE_BUFFER_SIZE {
            buffer.reserve(LARGE_BUFFER_SIZE);
        }

        // Zero-copy read directly into BytesMut buffer
        // Eliminates intermediate buffer copies between kernel and userspace
        // read_buf extends the buffer in-place without additional allocation
        let bytes_read = reader.read_buf(&mut buffer).await?;
        if bytes_read == 0 {
            break; // End of file reached
        }

        // Stream data to client and track progress
        stream.write_all(&buffer).await?;
        bytes_sent += buffer.len() as u64;
        buffer.clear(); // Reset for next chunk

        // Periodic progress logging for long downloads
        // Provides visibility into download progress without spamming logs
        if last_log.elapsed() > Duration::from_secs(3) {
            let percent = (bytes_sent as f64 / file_size as f64) * 100.0;
            let rate = bytes_sent as f64 / start_time.elapsed().as_secs_f64() / 1_000_000.0;
            debug!("Progress: {:.1}% ({}/{} bytes) at {:.2} MB/s", percent, bytes_sent, file_size, rate);
            last_log = Instant::now();
        }
    }

    // Clean up resources and finalize transfer
    BUFFER_POOL.return_buffer(buffer); // Return buffer to pool for reuse
    stream.shutdown().await?; // Signal end of stream to client
    heartbeat_handle.abort(); // Stop heartbeat task

    // Log final transfer statistics
    let rate = bytes_sent as f64 / start_time.elapsed().as_secs_f64() / 1_000_000.0;
    info!("Download complete: {:?} ({} bytes, {:.2} MB/s)", filepath, bytes_sent, rate);

    // Brief delay to ensure clean connection shutdown
    // Gives time for final packets to be acknowledged
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(())
}

// ============================================================================
// PUBLIC API FOR CREATING SEMAPHORES
// ============================================================================

// Factory functions for creating rate-limiting semaphores
// Centralized semaphore creation ensures consistent limits across the application
// Create Arc-wrapped semaphores with predefined capacity limits

pub fn create_upload_semaphore() -> Arc<Semaphore> {
    // Upload semaphore with lower limit due to higher resource usage
    // Uploads involve disk I/O, parsing, and directory operations
    Arc::new(Semaphore::new(MAX_CONCURRENT_UPLOADS))
}

pub fn create_download_semaphore() -> Arc<Semaphore> {
    // Download semaphore with higher limit for network-bound operations
    // Downloads are primarily network I/O with lower CPU/disk overhead
    Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS))
}