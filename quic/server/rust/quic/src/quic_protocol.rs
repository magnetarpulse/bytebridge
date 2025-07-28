use anyhow::Result;
use bytes::{Bytes, Buf, BytesMut};
use h3::{
    ext::Protocol,
    server::{RequestResolver, Connection},
};
use h3_webtransport::server::WebTransportSession;
use http::Method;
use serde_json;
use std::{path::PathBuf, sync::Arc, time::{Duration, Instant}};
use tokio::{fs::File, sync::mpsc, time::timeout};
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tracing::{debug, error, info, instrument, trace, warn};
use urlencoding::decode;

// Buffer pool for high-throughput scenarios
static BUFFER_POOL: once_cell::sync::Lazy<Arc<BufferPool>> = once_cell::sync::Lazy::new(|| {
    Arc::new(BufferPool::new(64 * 1024, 32)) // 64KB buffers, pool of 32
});

struct BufferPool {
    buffers: tokio::sync::Mutex<Vec<Vec<u8>>>,
    buffer_size: usize,
    max_pool_size: usize,
    large_buffers: tokio::sync::Mutex<Vec<Vec<u8>>>,
    large_buffer_size: usize, 
    max_large_pool_size: usize,
}

impl BufferPool {
    fn new(buffer_size: usize, max_pool_size: usize) -> Self {
        Self {
            buffers: tokio::sync::Mutex::new(Vec::new()),
            buffer_size,
            max_pool_size,
            large_buffers: tokio::sync::Mutex::new(Vec::new()),
            large_buffer_size: 262_144, // 256KB for bulk transfers
            max_large_pool_size: 8,     // Fewer large buffers
        }
    }
    
    async fn get_buffer(&self) -> Vec<u8> {
        let mut buffers = self.buffers.lock().await;
        buffers.pop().unwrap_or_else(|| vec![0u8; self.buffer_size])
    }
    
    async fn get_large_buffer(&self) -> Vec<u8> {
        let mut buffers = self.large_buffers.lock().await;
        buffers.pop().unwrap_or_else(|| vec![0u8; self.large_buffer_size])
    }
    
    async fn return_buffer(&self, mut buffer: Vec<u8>) {
        if buffer.len() == self.buffer_size {
            let mut buffers = self.buffers.lock().await;
            if buffers.len() < self.max_pool_size {
                buffer.clear();
                buffer.resize(self.buffer_size, 0);
                buffers.push(buffer);
            }
        } else if buffer.len() == self.large_buffer_size {
            let mut large_buffers = self.large_buffers.lock().await;
            if large_buffers.len() < self.max_large_pool_size {
                buffer.clear();
                buffer.resize(self.large_buffer_size, 0);
                large_buffers.push(buffer);
            }
        }
        // If buffer is not of standard sizes or pools are full, just let it drop
    }
}

async fn copy_with_buffer<R, W>(reader: &mut R, writer: &mut W, mut buffer: Vec<u8>) -> Result<u64>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut total_bytes = 0u64;
    
    loop {
        // Use timeout for read operations to avoid hanging
        let bytes_read = match timeout(Duration::from_secs(30), reader.read(&mut buffer)).await {
            Ok(result) => result?,
            Err(_) => {
                warn!("Read operation timed out after 30 seconds");
                return Err(anyhow::anyhow!("Read operation timed out"));
            }
        };
        
        if bytes_read == 0 {
            break;
        }
        
        // Use timeout for write operations as well
        match timeout(Duration::from_secs(30), writer.write_all(&buffer[..bytes_read])).await {
            Ok(result) => result?,
            Err(_) => {
                warn!("Write operation timed out after 30 seconds");
                return Err(anyhow::anyhow!("Write operation timed out"));
            }
        };
        
        total_bytes += bytes_read as u64;
    }
    
    match timeout(Duration::from_secs(5), writer.flush()).await {
        Ok(result) => result?,
        Err(_) => {
            warn!("Flush operation timed out after 5 seconds");
            // Continue even if flush times out as we've already written the data
        }
    };
    
    // Return buffer to pool
    BUFFER_POOL.return_buffer(buffer).await;
    
    Ok(total_bytes)
}

pub async fn handle_connection(
    mut conn: Connection<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
) -> Result<()> {
    // Set up connection monitoring
    let conn_id = format!("{:?}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    info!("New connection established: {}", conn_id);
    
    // Accept a single request and handle it
    // H3 connections can only handle one request before they're consumed
    if let Ok(Some(resolver)) = conn.accept().await {
        info!("Accepted request on connection {}", conn_id);
        handle_request(resolver, conn, files_dir).await;
    } else {
        info!("Connection {} closed without any request", conn_id);
    }
    
    info!("Connection {} handler completed", conn_id);
    Ok(())
}

async fn handle_request(
    resolver: RequestResolver<h3_quinn::Connection, Bytes>,
    conn: Connection<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
) {
    let (req, stream) = match resolver.resolve_request().await {
        Ok(req) => req,
        Err(err) => {
            error!("Failed to resolve request: {:?}", err);
            return;
        }
    };
    
    if let (&Method::CONNECT, Some(&Protocol::WEB_TRANSPORT)) = (req.method(), req.extensions().get::<Protocol>()) {
        info!("Peer wants to initiate a WebTransport session for path: {}", req.uri().path());
        
        let path = req.uri().path().to_string();
        
        if let Some(upload_id) = path.strip_prefix("/upload/") {
            let session = match WebTransportSession::accept(req, stream, conn).await {
                Ok(s) => s,
                Err(e) => { error!("Failed to accept WT session: {:?}", e); return; }
            };
            info!("Accepted upload session for '{}'", upload_id);
            if let Err(e) = handle_upload_session(session, files_dir).await {
                error!("Upload session error: {:?}", e);
            }
        } else if let Some(filename_str) = path.strip_prefix("/download/") {
            let session = match WebTransportSession::accept(req, stream, conn).await {
                Ok(s) => s,
                Err(e) => { error!("Failed to accept WT session: {:?}", e); return; }
            };
            info!("Accepted download session for '{}'", filename_str);
            if let Err(e) = handle_download_session(session, files_dir, filename_str).await {
                error!("Download session error: {:?}", e);
            }
        } else {
            warn!("Rejecting WebTransport session for unknown path: {}", path);
        }
    } else {
        warn!("Rejecting non-WebTransport request: {} {}", req.method(), req.uri().path());
    }
}

#[instrument(skip_all)]
async fn handle_upload_session(
    session: WebTransportSession<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
) -> Result<()> {
    // Extract upload ID from the URL path
    let session_id = session.session_id();
    let upload_id = format!("{:?}", session_id);
    info!("Started WebTransport session for upload: {}", upload_id);
    
    // Create session state for monitoring activity
    let session_state = Arc::new(SessionState::new(upload_id.clone()));
    
    // Instead of cloning, we'll use the session directly
    // WebTransportSession doesn't implement Clone, so we'll use datagram sender directly
    // before passing the session to the stream handler
    
    // Create a channel to signal session termination
    let (termination_tx, mut termination_rx) = mpsc::channel(1);
    
    // Get a datagram sender for heartbeats before moving the session
    let mut datagram_sender = session.datagram_sender();
    let heartbeat_state = session_state.clone();
    
    // Spawn a heartbeat task that sends small datagrams periodically to maintain the connection
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval_timer = tokio::time::interval(Duration::from_secs(5));
        let mut consecutive_failures = 0;
        
        loop {
            interval_timer.tick().await;
            
            // Check if we should stop sending heartbeats (if inactive for too long)
            if heartbeat_state.inactive_duration() > Duration::from_secs(60) && consecutive_failures > 3 {
                info!("Session {} appears inactive, stopping heartbeats", heartbeat_state.id);
                break;
            }
            
            // Try to send a tiny heartbeat datagram
            let heartbeat_payload = Bytes::from_static(b"ping");
            match datagram_sender.send_datagram(heartbeat_payload) {
                Ok(_) => {
                    consecutive_failures = 0;
                    trace!("Sent heartbeat for session {}", heartbeat_state.id);
                },
                Err(e) => {
                    consecutive_failures += 1;
                    warn!("Failed to send heartbeat for session {}: {:?}", heartbeat_state.id, e);
                    if consecutive_failures > 5 {
                        error!("Too many heartbeat failures for session {}, stopping", heartbeat_state.id);
                        break;
                    }
                }
            }
        }
    });
    
    // For the stream handler
    let stream_state = session_state.clone();
    
    // Spawn a task to handle incoming streams
    let stream_handle = tokio::spawn(async move {
        // Accept multiple streams over the same session
        while let Ok(stream_result) = tokio::time::timeout(Duration::from_secs(60), session.accept_uni()).await {
            match stream_result {
                Ok(Some((_, mut stream))) => {
                    // Update activity timestamp whenever we receive data
                    stream_state.update_activity();
                    
                    // Clone necessary values for the task
                    let files_dir = files_dir.clone();
                    
                    // Process the stream using a state machine to handle multiple chunks
                    let mut buffer = BytesMut::with_capacity(262_144); // 256KB buffer
                    let mut current_file: Option<File> = None;
                    let mut current_filepath = PathBuf::new();
                    let mut bytes_written = 0u64;
                    let mut start_time = Instant::now();
                    
                    // Loop to process the entire stream
                    'stream_loop: loop {
                        // Read data into buffer
                        let mut temp_buf = [0u8; 16384]; // 16KB read buffer
                        let bytes_read = match stream.read(&mut temp_buf).await {
                            Ok(0) => break 'stream_loop, // End of stream
                            Ok(n) => n,
                            Err(e) => {
                                error!("Error reading from stream: {:?}", e);
                                break 'stream_loop;
                            }
                        };
                        
                        // Update activity timestamp
                        stream_state.update_activity();
                        
                        // Append to our buffer
                        buffer.extend_from_slice(&temp_buf[..bytes_read]);
                        
                        // Process buffer - look for metadata lines
                        'process_buffer: loop {
                            // If we're not currently writing to a file, look for metadata
                            if current_file.is_none() {
                                // Find a newline which indicates end of metadata
                                if let Some(nl_pos) = buffer.iter().position(|&b| b == b'\n') {
                                    // Extract metadata line
                                    let metadata_bytes = buffer.split_to(nl_pos + 1);
                                    let metadata_line = String::from_utf8_lossy(&metadata_bytes[..nl_pos]).to_string();
                                    
                                    // Parse metadata to get filename
                                    if let Some(filename) = extract_filename_from_metadata(&metadata_line) {
                                        info!("Processing file: {} (from metadata: {})", filename, metadata_line);
                                        
                                        // Create the file
                                        current_filepath = files_dir.join(&filename);
                                        match File::create(&current_filepath).await {
                                            Ok(file) => {
                                                current_file = Some(file);
                                                bytes_written = 0;
                                                start_time = Instant::now();
                                            },
                                            Err(e) => {
                                                error!("Failed to create file {}: {:?}", filename, e);
                                                // Skip this chunk, look for next metadata
                                                continue 'process_buffer;
                                            }
                                        }
                                    } else {
                                        error!("Invalid metadata format: {}", metadata_line);
                                        // Skip this chunk, look for next metadata
                                        continue 'process_buffer;
                                    }
                                } else {
                                    // No complete metadata line yet, need more data
                                    break 'process_buffer;
                                }
                            }
                            
                            // We have an open file, write data until we find a potential metadata marker
                            if let Some(file) = &mut current_file {
                                // Look for potential metadata marker - JSON typically starts with {
                                if let Some(json_start) = buffer.iter().position(|&b| b == b'{') {
                                    // First write any data before the potential marker
                                    if json_start > 0 {
                                        let data_chunk = buffer.split_to(json_start);
                                        if let Err(e) = file.write_all(&data_chunk).await {
                                            error!("Error writing to file: {:?}", e);
                                            current_file = None;
                                            continue 'process_buffer;
                                        }
                                        bytes_written += data_chunk.len() as u64;
                                    }
                                    
                                    // Check if this is actually a metadata line by looking for newline
                                    if let Some(nl_pos) = buffer.iter().position(|&b| b == b'\n') {
                                        let potential_metadata = String::from_utf8_lossy(&buffer[..nl_pos]);
                                        // Simple heuristic: if it contains "filename" and looks like JSON, it's probably metadata
                                        if potential_metadata.contains("filename") && 
                                           potential_metadata.contains("uploadId") &&
                                           potential_metadata.starts_with('{') && 
                                           (potential_metadata.contains('}') || potential_metadata.len() > 20) {
                                           
                                            info!("Found new chunk metadata: {}", potential_metadata);
                                            
                                            // This is likely a metadata line, finalize current file
                                            file.flush().await.ok();
                                            let elapsed = start_time.elapsed().as_secs_f64();
                                            let rate = if elapsed > 0.0 { bytes_written as f64 / elapsed / 1_000_000.0 } else { 0.0 };
                                            info!("Finished writing file: {:?} ({} bytes, {:.2} MB/s)", 
                                                  current_filepath, bytes_written, rate);
                                            
                                            // Close current file
                                            current_file = None;
                                            
                                            // Don't consume the buffer - let the outer loop process this metadata
                                            continue 'process_buffer;
                                        } else {
                                            // Not metadata, just regular data that happens to contain '{'
                                            let data_chunk = buffer.split_to(nl_pos + 1);
                                            if let Err(e) = file.write_all(&data_chunk).await {
                                                error!("Error writing to file: {:?}", e);
                                                current_file = None;
                                                continue 'process_buffer;
                                            }
                                            bytes_written += data_chunk.len() as u64;
                                        }
                                    } else {
                                        // No newline after '{', so not enough data to determine
                                        // Keep buffer as is and wait for more data
                                        break 'process_buffer;
                                    }
                                } else {
                                    // No potential metadata marker, write entire buffer
                                    if !buffer.is_empty() {
                                        let bytes_to_write = buffer.len();
                                        if let Err(e) = file.write_all(&buffer).await {
                                            error!("Error writing to file: {:?}", e);
                                            current_file = None;
                                        } else {
                                            bytes_written += bytes_to_write as u64;
                                        }
                                        buffer.clear();
                                    }
                                    break 'process_buffer; // Need more data
                                }
                            } else {
                                // No current file but we should have one by now
                                // This is an error state - reset and look for metadata
                                buffer.clear();
                                break 'process_buffer;
                            }
                        }
                    }
                    
                    // Finalize the last file if needed
                    if let Some(mut file) = current_file {
                        // Write any remaining data in the buffer
                        if !buffer.is_empty() {
                            file.write_all(&buffer).await.ok();
                            bytes_written += buffer.len() as u64;
                        }
                        
                        file.flush().await.ok();
                        let elapsed = start_time.elapsed().as_secs_f64();
                        let rate = if elapsed > 0.0 { bytes_written as f64 / elapsed / 1_000_000.0 } else { 0.0 };
                        info!("Finished writing file: {:?} ({} bytes, {:.2} MB/s)", 
                              current_filepath, bytes_written, rate);
                    }
                },
                _ => {
                    // Signal main task that streams are done
                    let _ = termination_tx.send(()).await;
                    break; // Session closed or error
                }
            }
        }
    });
    
    // Wait for either the session to end or a timeout
    tokio::select! {
        _ = termination_rx.recv() => {
            info!("WebTransport session streams completed for upload ID: {}", upload_id);
        }
        _ = tokio::time::sleep(Duration::from_secs(1800)) => {
            info!("WebTransport session timed out after 30 minutes for upload ID: {}", upload_id);
        }
    }
    
    // Clean up the tasks
    heartbeat_handle.abort();
    stream_handle.abort();
    
    info!("WebTransport session ended for upload ID: {}", upload_id);
    Ok(())
}

// Session state tracking for monitoring activity
struct SessionState {
    id: String,
    last_active: std::sync::Mutex<Instant>,
}

impl SessionState {
    fn new(id: String) -> Self {
        Self {
            id,
            last_active: std::sync::Mutex::new(Instant::now()),
        }
    }
    
    fn update_activity(&self) {
        let mut last_active = self.last_active.lock().unwrap();
        *last_active = Instant::now();
    }
    
    fn inactive_duration(&self) -> Duration {
        let last_active = self.last_active.lock().unwrap();
        last_active.elapsed()
    }
}

// Helper function to extract filename from JSON metadata
fn extract_filename_from_metadata(metadata: &str) -> Option<String> {
    // Try to parse as proper JSON first
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(metadata) {
        if let Some(serde_json::Value::String(filename)) = json_value.get("filename") {
            return Some(filename.clone());
        }
    }
    
    // Fall back to simple extraction if JSON parsing fails
    if let Some(start) = metadata.find("\"filename\":") {
        let value_start = metadata[start..].find(":\"")? + start + 2;
        if value_start >= metadata.len() {
            return None;
        }
        let value_end = metadata[value_start..].find("\"")? + value_start;
        if value_end > value_start && value_end <= metadata.len() {
            return Some(metadata[value_start..value_end].to_string());
        }
    }
    
    None
}

#[instrument(skip_all, fields(filename = %filename_encoded))]
async fn handle_download_session(
    mut session: WebTransportSession<h3_quinn::Connection, Bytes>,
    files_dir: Arc<PathBuf>,
    filename_encoded: &str, 
) -> Result<()> {
    let filename = decode(filename_encoded)?;
    let filepath = files_dir.join(filename.as_ref());

    if !filepath.exists() {
        error!("Requested file not found: {:?}", filepath);
        return Ok(());
    }

    info!("Opening a server-initiated stream to send '{:?}'", filepath);
    
    // Get the session ID before moving anything
    let session_id = format!("{:?}", session.session_id());
    
    // For heartbeats, we'll use a separate datagram sender instead of cloning the session
    let mut datagram_sender = session.datagram_sender();
    
    // Start a separate task for heartbeats
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval_timer = tokio::time::interval(Duration::from_secs(5));
        let mut consecutive_failures = 0;
        
        loop {
            interval_timer.tick().await;
            
            // Send small heartbeat datagrams to keep connection alive
            let heartbeat_payload = Bytes::from_static(b"ping");
            match datagram_sender.send_datagram(heartbeat_payload) {
                Ok(_) => {
                    consecutive_failures = 0;
                    trace!("Sent heartbeat for download session {}", session_id);
                },
                Err(e) => {
                    consecutive_failures += 1;
                    warn!("Failed to send heartbeat for download session {}: {:?}", session_id, e);
                    if consecutive_failures > 5 {
                        error!("Too many heartbeat failures for download session {}, stopping", session_id);
                        break;
                    }
                }
            }
        }
    });
    
    // Open a stream for file transfer - we use session directly since we captured the datagram_sender separately
    let mut stream = session.open_uni(session.session_id()).await?;
    
    let file = File::open(&filepath).await?;
    let file_size = file.metadata().await?.len();
    let mut buf_reader = BufReader::new(file);
    
    // Use larger buffer for better throughput - 256KB chunks
    let buffer = BUFFER_POOL.get_large_buffer().await;
    
    // Track progress for logging
    let mut bytes_sent = 0u64;
    let start_time = Instant::now();
    let mut last_log = Instant::now();
    
    // Send the file with progress tracking
    let mut copy_buffer = buffer;
    loop {
        let bytes_read = buf_reader.read(&mut copy_buffer).await?;
        if bytes_read == 0 {
            break;
        }
        
        stream.write_all(&copy_buffer[..bytes_read]).await?;
        bytes_sent += bytes_read as u64;
        
        // Log progress every 3 seconds
        if last_log.elapsed() > Duration::from_secs(3) {
            let percent = if file_size > 0 { (bytes_sent as f64 / file_size as f64) * 100.0 } else { 0.0 };
            let elapsed = start_time.elapsed().as_secs_f64();
            let rate = if elapsed > 0.0 { bytes_sent as f64 / elapsed / 1_000_000.0 } else { 0.0 };
            
            debug!("Transfer progress: {:.1}% ({}/{} bytes) at {:.2} MB/s", 
                percent, bytes_sent, file_size, rate);
            
            last_log = Instant::now();
        }
    }
    
    // Return the buffer to the pool
    BUFFER_POOL.return_buffer(copy_buffer).await;
    
    // Properly close the stream
    stream.shutdown().await?;
    
    // Clean up the heartbeat task
    heartbeat_handle.abort();
    
    let elapsed = start_time.elapsed().as_secs_f64();
    let rate = if elapsed > 0.0 { bytes_sent as f64 / elapsed / 1_000_000.0 } else { 0.0 };
    info!("Finished sending file: {:?} ({} bytes, {:.2} MB/s)", filepath, bytes_sent, rate);

    // Add a small, non-blocking delay to give the client a grace period to process
    // the end-of-stream signal before the server's connection object is dropped.
    tokio::time::sleep(Duration::from_millis(500)).await;
    
    Ok(())
}