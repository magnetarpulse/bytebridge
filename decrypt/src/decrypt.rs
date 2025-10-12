use libsodium_sys as sodium;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

// ============================================================================
// Constants
// ============================================================================

/// Length of the context string used in key derivation (required by crypto_kdf)
const CONTEXT_LENGTH: usize = 8;

/// Prefix used when deriving worker-specific sub-keys
const WORKER_CONTEXT_PREFIX: &str = "worker-";

/// Maximum number of parallel encryption workers supported.
const MAX_WORKER_COUNT: usize = 32;

/// Nonce size for XChaCha20-Poly1305 (24 bytes)
const NONCE_SIZE: usize = sodium::crypto_aead_xchacha20poly1305_ietf_NPUBBYTES as usize;

/// Size of chunk metadata prepended to plaintext (4 bytes workerId + 4 bytes chunkIndex)
const CHUNK_METADATA_SIZE: usize = 8;

/// Size of derived sub-keys in bytes
const SUBKEY_SIZE: usize = 32;

/// Default buffer pool size (number of buffers to cache)
const DEFAULT_BUFFER_POOL_SIZE: usize = 16;

/// Default maximum chunk size (100 MB)
const DEFAULT_MAX_CHUNK_SIZE: usize = 100 * 1024 * 1024;

/// Default memory limit (512 MB)
const DEFAULT_MEMORY_LIMIT_MB: usize = 512;

// ============================================================================
// Type Aliases
// ============================================================================

/// Represents a chunk as (chunk_index, encrypted_data)
pub type ChunkData = (usize, Vec<u8>);

/// Master encryption key (32 bytes)
pub type MasterKey = [u8; 32];

/// Derived sub-key for a worker (32 bytes)
pub type SubKey = [u8; 32];

// ============================================================================
// Configuration
// ============================================================================

/// Configuration parameters for decryption operations
#[derive(Debug, Clone)]
pub struct DecryptConfig {
    /// Maximum number of encryption workers allowed during file encryption.
    pub max_worker_count: usize,
    
    /// Maximum size of a single chunk in bytes
    pub max_chunk_size: usize,
    
    /// Size of the buffer pool (number of buffers to cache)
    pub buffer_pool_size: usize,
    
    /// Memory limit in megabytes
    pub memory_limit_mb: usize,
}

impl Default for DecryptConfig {
    fn default() -> Self {
        Self {
            max_worker_count: MAX_WORKER_COUNT,
            max_chunk_size: DEFAULT_MAX_CHUNK_SIZE,
            buffer_pool_size: DEFAULT_BUFFER_POOL_SIZE,
            memory_limit_mb: DEFAULT_MEMORY_LIMIT_MB,
        }
    }
}

impl DecryptConfig {
    pub fn new() -> Self {
        Self::default()
    }
    
    pub fn with_max_workers(mut self, count: usize) -> Self {
        self.max_worker_count = count;
        self
    }
    
    pub fn with_max_chunk_size(mut self, size: usize) -> Self {
        self.max_chunk_size = size;
        self
    }
    
    pub fn with_buffer_pool_size(mut self, size: usize) -> Self {
        self.buffer_pool_size = size;
        self
    }
    
    pub fn with_memory_limit_mb(mut self, limit: usize) -> Self {
        self.memory_limit_mb = limit;
        self
    }
}

// ============================================================================
// Buffer Pool
// ============================================================================

/// A pool of reusable buffers for decryption operations
pub struct DecryptBufferPool {
    buffers: Arc<Mutex<Vec<Vec<u8>>>>,
    max_pool_size: usize,
    current_memory: Arc<AtomicUsize>,
    memory_limit: usize,
}

impl DecryptBufferPool {
    pub fn new(config: &DecryptConfig) -> Self {
        Self {
            buffers: Arc::new(Mutex::new(Vec::with_capacity(config.buffer_pool_size))),
            max_pool_size: config.buffer_pool_size,
            current_memory: Arc::new(AtomicUsize::new(0)),
            memory_limit: config.memory_limit_mb * 1024 * 1024,
        }
    }
    
    pub fn get_buffer(&self, min_capacity: usize) -> Result<Vec<u8>, DecryptError> {
        self.check_memory_limit(min_capacity)?;
        
        let mut buffers = self.buffers.lock().unwrap();
        
        if let Some(pos) = buffers.iter().position(|b| b.capacity() >= min_capacity) {
            let mut buffer = buffers.swap_remove(pos);
            buffer.clear();
            buffer.resize(min_capacity, 0);
            debug!("Reused buffer from pool (capacity: {})", buffer.capacity());
            return Ok(buffer);
        }
        
        drop(buffers);
        
        let buffer = vec![0u8; min_capacity];
        self.current_memory.fetch_add(buffer.capacity(), Ordering::Relaxed);
        debug!("Allocated new buffer (size: {})", min_capacity);
        
        Ok(buffer)
    }
    
    pub fn return_buffer(&self, mut buffer: Vec<u8>) {
        let mut buffers = self.buffers.lock().unwrap();
        
        if buffers.len() < self.max_pool_size {
            buffer.clear();
            buffers.push(buffer);
            debug!("Returned buffer to pool (pool size: {})", buffers.len());
        } else {
            let capacity = buffer.capacity();
            drop(buffer);
            self.current_memory.fetch_sub(capacity, Ordering::Relaxed);
            debug!("Dropped buffer, pool full");
        }
    }
    
    fn check_memory_limit(&self, allocation_size: usize) -> Result<(), DecryptError> {
        let current = self.current_memory.load(Ordering::Relaxed);
        let new_total = current.saturating_add(allocation_size);
        
        if new_total > self.memory_limit {
            error!(
                "Memory limit exceeded: current={} bytes, requested={} bytes, limit={} bytes",
                current, allocation_size, self.memory_limit
            );
            return Err(DecryptError::MemoryLimitExceeded {
                current_mb: current / (1024 * 1024),
                requested_mb: allocation_size / (1024 * 1024),
                limit_mb: self.memory_limit / (1024 * 1024),
            });
        }
        
        Ok(())
    }
    
    pub fn current_memory_usage(&self) -> usize {
        self.current_memory.load(Ordering::Relaxed)
    }
    
    pub fn current_memory_usage_mb(&self) -> usize {
        self.current_memory_usage() / (1024 * 1024)
    }
}

impl Clone for DecryptBufferPool {
    fn clone(&self) -> Self {
        Self {
            buffers: Arc::clone(&self.buffers),
            max_pool_size: self.max_pool_size,
            current_memory: Arc::clone(&self.current_memory),
            memory_limit: self.memory_limit,
        }
    }
}

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum DecryptError {
    InvalidHeaderSize {
        expected: usize,
        actual: usize,
    },
    InitializationFailed {
        reason: String,
    },
    DecryptionFailed {
        chunk_index: Option<usize>,
        reason: String,
    },
    DecompressionFailed {
        error: String,
    },
    KeyDerivationFailed {
        worker_index: usize,
        reason: String,
    },
    InvalidInput {
        field: String,
        reason: String,
    },
    NoChunks,
    MissingHeader {
        actual_index: usize,
    },
    InvalidWorkerCount {
        count: usize,
        reason: String,
    },
    MissingWorkerState {
        worker_id: usize,
    },
    MissingWorkerSubkey {
        worker_id: usize,
    },
    InvalidChunkOrder {
        reason: String,
    },
    MemoryLimitExceeded {
        current_mb: usize,
        requested_mb: usize,
        limit_mb: usize,
    },
    ChunkSizeExceeded {
        chunk_index: usize,
        size: usize,
        max_size: usize,
    },
    MissingUploadId {
        path: String,
    },
}

impl fmt::Display for DecryptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecryptError::InvalidHeaderSize { expected, actual } => {
                write!(f, "Invalid header size: expected {} bytes, got {} bytes", expected, actual)
            }
            DecryptError::InitializationFailed { reason } => {
                write!(f, "Failed to initialize decryption: {}", reason)
            }
            DecryptError::DecryptionFailed { chunk_index, reason } => {
                match chunk_index {
                    Some(idx) => write!(f, "Decryption failed for chunk {}: {}", idx, reason),
                    None => write!(f, "Decryption failed: {}", reason),
                }
            }
            DecryptError::DecompressionFailed { error } => {
                write!(f, "LZ4 decompression failed: {}", error)
            }
            DecryptError::KeyDerivationFailed { worker_index, reason } => {
                write!(f, "Failed to derive key for worker {}: {}", worker_index, reason)
            }
            DecryptError::InvalidInput { field, reason } => {
                write!(f, "Invalid input for field '{}': {}", field, reason)
            }
            DecryptError::NoChunks => {
                write!(f, "No chunks provided for decryption")
            }
            DecryptError::MissingHeader { actual_index } => {
                write!(f, "First chunk must be index 0 (header), got index {}", actual_index)
            }
            DecryptError::InvalidWorkerCount { count, reason } => {
                write!(f, "Invalid worker count {}: {}", count, reason)
            }
            DecryptError::MissingWorkerState { worker_id } => {
                write!(f, "No decryption state found for worker {}", worker_id)
            }
            DecryptError::MissingWorkerSubkey { worker_id } => {
                write!(f, "No sub-key found for worker {}", worker_id)
            }
            DecryptError::InvalidChunkOrder { reason } => {
                write!(f, "Invalid chunk ordering: {}", reason)
            }
            DecryptError::MemoryLimitExceeded { current_mb, requested_mb, limit_mb } => {
                write!(
                    f,
                    "Memory limit exceeded: current {} MB + requested {} MB exceeds limit of {} MB",
                    current_mb, requested_mb, limit_mb
                )
            }
            DecryptError::ChunkSizeExceeded { chunk_index, size, max_size } => {
                write!(
                    f,
                    "Chunk {} size {} bytes exceeds maximum allowed size of {} bytes",
                    chunk_index, size, max_size
                )
            }
            DecryptError::MissingUploadId { path } => {
                write!(f, "Could not extract uploadId from path: {}", path)
            }
        }
    }
}

impl std::error::Error for DecryptError {}

// ============================================================================
// Core Structures
// ============================================================================

/// Metadata parsed from the header (chunk 0)
#[derive(Debug)]
pub struct UploadMetadata {
    pub version: u32,
    pub algorithm: String,
    pub file_name: String,
    pub original_size: u64,
    pub compression_enabled: bool,
    pub timestamp: u64,
}

/// Parses the upload metadata from chunk 0 (unencrypted JSON)
fn parse_metadata(data: &[u8]) -> Result<UploadMetadata, DecryptError> {
    let json_str = std::str::from_utf8(data)
        .map_err(|e| DecryptError::InitializationFailed {
            reason: format!("Invalid UTF-8 in metadata: {}", e),
        })?;
    
    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| DecryptError::InitializationFailed {
            reason: format!("Invalid JSON in metadata: {}", e),
        })?;
    
    Ok(UploadMetadata {
        version: json["version"].as_u64().unwrap_or(1) as u32,
        algorithm: json["algorithm"].as_str().unwrap_or("XChaCha20-Poly1305-IETF").to_string(),
        file_name: json["fileName"].as_str().unwrap_or("").to_string(),
        original_size: json["originalSize"].as_u64().unwrap_or(0),
        compression_enabled: json["compressionEnabled"].as_bool().unwrap_or(true),
        timestamp: json["timestamp"].as_u64().unwrap_or(0),
    })
}

// ============================================================================
// Upload ID Extraction
// ============================================================================

/// Extracts the uploadId from the directory path.
/// 
/// For chunked directories: /path/to/received_files/{uploadId}/chunks
/// Returns the uploadId (directory name containing the chunks).
pub fn extract_upload_id_from_path(path: &Path) -> Result<String, DecryptError> {
    // Get the parent directory (should be the uploadId directory)
    let upload_id = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| DecryptError::MissingUploadId {
            path: path.display().to_string(),
        })?;
    
    debug!("Extracted uploadId from path: {}", upload_id);
    Ok(upload_id)
}

// ============================================================================
// Nonce Derivation (matches frontend)
// ============================================================================

/// Derives the nonce for a chunk using BLAKE2b hash of "uploadId:chunkIndex"
/// 
/// This matches the frontend's deriveNonce() function exactly.
fn derive_nonce(upload_id: &str, chunk_index: usize) -> Result<[u8; NONCE_SIZE], DecryptError> {
    let input = format!("{}:{}", upload_id, chunk_index);
    let input_bytes = input.as_bytes();
    
    let mut nonce = [0u8; NONCE_SIZE];
    
    unsafe {
        let result = sodium::crypto_generichash(
            nonce.as_mut_ptr(),
            NONCE_SIZE,
            input_bytes.as_ptr(),
            input_bytes.len() as u64,
            std::ptr::null(),
            0,
        );
        
        if result != 0 {
            return Err(DecryptError::DecryptionFailed {
                chunk_index: Some(chunk_index),
                reason: format!("Failed to derive nonce (crypto_generichash returned {})", result),
            });
        }
    }
    
    Ok(nonce)
}

// ============================================================================
// Key Derivation
// ============================================================================

/// Derives a sub-key for a specific worker from the master key.
pub fn derive_worker_subkey(master_key: &MasterKey, worker_index: usize) -> Result<SubKey, DecryptError> {
    debug!("Deriving sub-key for worker {}", worker_index);
    
    let mut subkey = [0u8; SUBKEY_SIZE];
    let context = format!("{}{}", WORKER_CONTEXT_PREFIX, worker_index);
    
    let mut context_bytes = [0u8; CONTEXT_LENGTH];
    let context_str = context.as_bytes();
    let copy_len = std::cmp::min(context_str.len(), CONTEXT_LENGTH);
    context_bytes[..copy_len].copy_from_slice(&context_str[..copy_len]);
    
    unsafe {
        let result = sodium::crypto_kdf_derive_from_key(
            subkey.as_mut_ptr(),
            SUBKEY_SIZE,
            0,  // subkey_id
            context_bytes.as_ptr() as *const i8,
            master_key.as_ptr(),
        );
        
        if result != 0 {
            error!("Key derivation failed for worker {} (return code: {})", worker_index, result);
            return Err(DecryptError::KeyDerivationFailed {
                worker_index,
                reason: format!("libsodium crypto_kdf_derive_from_key returned {}", result),
            });
        }
    }
    
    debug!("Successfully derived sub-key for worker {}", worker_index);
    Ok(subkey)
}


// ============================================================================
// Stateless Chunk Decryption
// ============================================================================

/// Decrypts a single chunk using stateless AEAD with derived nonce.
/// 
/// Format of encrypted_chunk: [24 bytes nonce][N bytes ciphertext + 16 bytes MAC]
/// Plaintext format: [4 bytes workerId][4 bytes chunkIndex][M bytes compressed data]
fn decrypt_chunk_stateless(
    encryption_key: &[u8; 32],
    upload_id: &str,
    chunk_index: usize,
    encrypted_chunk: &[u8],
    buffer_pool: &DecryptBufferPool,
) -> Result<(usize, Vec<u8>), DecryptError> {  // Returns (workerId, data)
    debug!("Decrypting chunk {} ({} bytes)", chunk_index, encrypted_chunk.len());
    
    // Extract nonce (first 24 bytes)
    if encrypted_chunk.len() < NONCE_SIZE {
        return Err(DecryptError::DecryptionFailed {
            chunk_index: Some(chunk_index),
            reason: format!("Chunk too small: {} bytes (need at least {})", encrypted_chunk.len(), NONCE_SIZE),
        });
    }
    
    let nonce = &encrypted_chunk[..NONCE_SIZE];
    let ciphertext = &encrypted_chunk[NONCE_SIZE..];
    
    // Verify the nonce matches what we'd derive
    let expected_nonce = derive_nonce(upload_id, chunk_index)?;
    if nonce != &expected_nonce[..] {
        warn!("Nonce mismatch for chunk {}", chunk_index);
    }
    
    // Decrypt using XChaCha20-Poly1305
    let max_decrypted_len = ciphertext.len();
    let mut decrypted = buffer_pool.get_buffer(max_decrypted_len)?;
    
    unsafe {
        let mut decrypted_len: u64 = 0;
        
        let result = sodium::crypto_aead_xchacha20poly1305_ietf_decrypt(
            decrypted.as_mut_ptr(),
            &mut decrypted_len as *mut u64,
            std::ptr::null_mut(),
            ciphertext.as_ptr(),
            ciphertext.len() as u64,
            std::ptr::null(),
            0,
            nonce.as_ptr(),
            encryption_key.as_ptr(),
        );
        
        if result != 0 {
            buffer_pool.return_buffer(decrypted);
            return Err(DecryptError::DecryptionFailed {
                chunk_index: Some(chunk_index),
                reason: format!("Decryption failed (wrong key or corrupted data, libsodium returned {})", result),
            });
        }
        
        decrypted.truncate(decrypted_len as usize);
    }
    
    // Verify and strip metadata (first 8 bytes = [4 bytes workerId][4 bytes chunkIndex])
    if decrypted.len() < CHUNK_METADATA_SIZE {
        let len = decrypted.len();
        buffer_pool.return_buffer(decrypted);
        return Err(DecryptError::DecryptionFailed {
            chunk_index: Some(chunk_index),
            reason: format!("Decrypted data too small: {} bytes", len),
        });
    }
    
    // Extract worker ID and chunk index from metadata
    let metadata_worker_id = u32::from_be_bytes(decrypted[..4].try_into().unwrap()) as usize;
    let metadata_chunk_index = u32::from_be_bytes(decrypted[4..8].try_into().unwrap()) as usize;
    
    if metadata_chunk_index != chunk_index {
        warn!("Chunk index mismatch: expected {}, got {} in metadata", chunk_index, metadata_chunk_index);
    }
    
    // Strip metadata, return worker ID and compressed data
    let compressed_data = decrypted[CHUNK_METADATA_SIZE..].to_vec();
    buffer_pool.return_buffer(decrypted);
    
    debug!("Successfully decrypted chunk {} from worker {} to {} bytes", chunk_index, metadata_worker_id, compressed_data.len());
    Ok((metadata_worker_id, compressed_data))
}

// ============================================================================
// Decompression
// ============================================================================

/// Decompresses LZ4-compressed data.
pub fn decompress_lz4(compressed: &[u8]) -> Result<Vec<u8>, DecryptError> {
    debug!("Decompressing {} bytes of LZ4 data", compressed.len());
    
    lz4_flex::decompress_size_prepended(compressed)
        .map_err(|e| {
            error!("LZ4 decompression failed: {}", e);
            DecryptError::DecompressionFailed {
                error: e.to_string(),
            }
        })
        .map(|data| {
            debug!("Successfully decompressed to {} bytes", data.len());
            data
        })
}

// ============================================================================
// Single-Worker Decryption
// ============================================================================

pub fn decrypt_file_to_writer<W, I, E>(
    master_key: &MasterKey,
    chunks: I,
    input_path: &Path,
    writer: &mut W,
    config: &DecryptConfig,
) -> Result<(usize, UploadMetadata), DecryptError> 
where
    W: std::io::Write,
    I: Iterator<Item = Result<ChunkData, E>>,
    E: std::error::Error + 'static,
{
    info!("Starting streaming single-worker file decryption");
    
    // Extract uploadId from the input path
    let upload_id = extract_upload_id_from_path(input_path)?;
    info!("Using uploadId for nonce derivation: {}", upload_id);
    
    let buffer_pool = DecryptBufferPool::new(config);
    let mut total_written = 0usize;
    let mut chunk_count = 0usize;
    let mut metadata: Option<UploadMetadata> = None;

    for chunk_result in chunks {
        let (idx, chunk_data) = chunk_result.map_err(|e| DecryptError::DecryptionFailed {
            chunk_index: None,
            reason: format!("Failed to load chunk: {}", e),
        })?;
        
        chunk_count += 1;
        
        // Chunk 0 is the metadata (unencrypted JSON)
        if idx == 0 {
            let meta = parse_metadata(&chunk_data)?;
            info!("Parsed metadata: version={}, algorithm={}, compression={}, file_name={}", 
                meta.version, meta.algorithm, meta.compression_enabled, meta.file_name);
            
            metadata = Some(meta);
            continue;
        }
        
        if metadata.is_none() {
            return Err(DecryptError::DecryptionFailed {
                chunk_index: Some(idx),
                reason: "Data chunk before metadata".to_string(),
            });
        }
        
        // Validate chunk size
        if chunk_data.len() > config.max_chunk_size {
            return Err(DecryptError::ChunkSizeExceeded {
                chunk_index: idx,
                size: chunk_data.len(),
                max_size: config.max_chunk_size,
            });
        }
        
        debug!("Processing chunk {} ({} bytes)", idx, chunk_data.len());
        
        // Decrypt chunk (stateless AEAD) - returns (worker_id, data)
        let (_worker_id, decrypted_compressed) = decrypt_chunk_stateless(
            master_key,
            &upload_id,
            idx,
            &chunk_data,
            &buffer_pool,
        )?;
        
        // Decompress if compression was enabled
        let decompressed = if metadata.as_ref().unwrap().compression_enabled {
            decompress_lz4(&decrypted_compressed)?
        } else {
            decrypted_compressed
        };
        
        // Write immediately to output
        writer.write_all(&decompressed)
            .map_err(|e| DecryptError::DecryptionFailed {
                chunk_index: Some(idx),
                reason: format!("Failed to write output: {}", e),
            })?;
        
        total_written += decompressed.len();
    }

    let metadata = metadata.ok_or(DecryptError::NoChunks)?;

    writer.flush()
        .map_err(|e| DecryptError::DecryptionFailed {
            chunk_index: None,
            reason: format!("Failed to flush output: {}", e),
        })?;

    info!(
        "Successfully decrypted {} chunks, wrote {} bytes, peak memory: ~{} MB",
        chunk_count - 1,
        total_written,
        buffer_pool.current_memory_usage_mb()
    );
    
    Ok((total_written, metadata))
}

// ============================================================================
// Parallel Multi-Worker Decryption
// ============================================================================

fn derive_all_worker_subkeys(
    master_key: &MasterKey,
    worker_count: usize,
) -> Result<HashMap<usize, SubKey>, DecryptError> {
    debug!("Deriving sub-keys for {} workers", worker_count);
    
    let mut worker_subkeys = HashMap::with_capacity(worker_count);
    
    for worker_id in 0..worker_count {
        let subkey = derive_worker_subkey(master_key, worker_id)?;
        worker_subkeys.insert(worker_id, subkey);
    }
    
    info!("Successfully derived {} worker sub-keys", worker_count);
    Ok(worker_subkeys)
}

pub fn decrypt_parallel_file_to_writer<W, I, E>(
    master_key: &MasterKey,
    chunks: I,
    worker_count: usize,
    input_path: &Path,
    writer: &mut W,
    config: &DecryptConfig,
) -> Result<(usize, UploadMetadata), DecryptError>
where
    W: std::io::Write,
    I: Iterator<Item = Result<ChunkData, E>>,
    E: std::error::Error + 'static,
{
    info!("Starting streaming parallel decryption with {} workers", worker_count);
    
    if worker_count == 0 {
        return Err(DecryptError::InvalidWorkerCount {
            count: worker_count,
            reason: "Worker count must be at least 1".to_string(),
        });
    }
    
    if worker_count > config.max_worker_count {
        return Err(DecryptError::InvalidWorkerCount {
            count: worker_count,
            reason: format!("Worker count exceeds maximum of {}", config.max_worker_count),
        });
    }
    
    let upload_id = extract_upload_id_from_path(input_path)?;
    info!("Using uploadId for nonce derivation: {}", upload_id);
    
    let subkeys = derive_all_worker_subkeys(master_key, worker_count)?;
    let buffer_pool = DecryptBufferPool::new(config);
    
    let mut worker_pending: HashMap<usize, Vec<Vec<u8>>> = HashMap::new();
    let mut total_written = 0usize;
    let mut chunk_count = 0usize;
    let mut metadata: Option<UploadMetadata> = None;

    for chunk_result in chunks {
        let (chunk_idx, chunk_data) = chunk_result.map_err(|e| DecryptError::DecryptionFailed {
            chunk_index: None,
            reason: format!("Failed to load chunk: {}", e),
        })?;
        
        chunk_count += 1;
        
        // Chunk 0 is the metadata
        if chunk_idx == 0 {
            let meta = parse_metadata(&chunk_data)?;
            info!("Parsed metadata: version={}, algorithm={}, compression={}", 
                meta.version, meta.algorithm, meta.compression_enabled);
            
            metadata = Some(meta);
            continue;
        }
        
        // Skip worker metadata chunks (JSON format)
        if chunk_data.starts_with(b"{") {
            if let Ok(_worker_meta) = parse_metadata(&chunk_data) {
                debug!("Skipping worker metadata chunk {}", chunk_idx);
                continue;
            }
        }
        
        // Validate chunk size
        if chunk_data.len() > config.max_chunk_size {
            return Err(DecryptError::ChunkSizeExceeded {
                chunk_index: chunk_idx,
                size: chunk_data.len(),
                max_size: config.max_chunk_size,
            });
        }
        
        // Decrypt chunk - it will tell us which worker encrypted it
        let (worker_id, decrypted_compressed) = {
            // Try each worker's key until one works
            let mut last_error = None;
            let mut found = None;
            
            for (wid, subkey) in &subkeys {
                match decrypt_chunk_stateless(
                    subkey,
                    &upload_id,
                    chunk_idx,
                    &chunk_data,
                    &buffer_pool,
                ) {
                    Ok((metadata_worker_id, data)) => {
                        if metadata_worker_id != *wid {
                            warn!("Worker ID mismatch: chunk decrypted with worker {} key but contains worker {} ID", 
                                wid, metadata_worker_id);
                        }
                        found = Some((metadata_worker_id, data));
                        break;
                    }
                    Err(e) => {
                        last_error = Some(e);
                    }
                }
            }
            
            found.ok_or_else(|| last_error.unwrap())?
        };
        
        // Decompress if enabled
        let decompressed = if metadata.as_ref().unwrap().compression_enabled {
            decompress_lz4(&decrypted_compressed)?
        } else {
            decrypted_compressed
        };
        
        // Add to worker's buffer
        worker_pending.entry(worker_id)
            .or_insert_with(Vec::new)
            .push(decompressed);
    }
    
    let metadata = metadata.ok_or(DecryptError::NoChunks)?;
    
    // Write all workers' data in order
    for worker_id in 0..worker_count {
        if let Some(worker_data) = worker_pending.get(&worker_id) {
            debug!("Writing {} chunks from worker {}", worker_data.len(), worker_id);
            
            for chunk in worker_data {
                writer.write_all(chunk)
                    .map_err(|e| DecryptError::DecryptionFailed {
                        chunk_index: None,
                        reason: format!("Failed to write worker {} data: {}", worker_id, e),
                    })?;
                
                total_written += chunk.len();
            }
        }
    }
    
    writer.flush()
        .map_err(|e| DecryptError::DecryptionFailed {
            chunk_index: None,
            reason: format!("Failed to flush output: {}", e),
        })?;

    info!(
        "Successfully decrypted {} chunks, wrote {} bytes",
        chunk_count - 1,
        total_written
    );
    
    Ok((total_written, metadata))
}
