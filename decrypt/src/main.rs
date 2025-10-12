use clap::Parser;
use log::{debug, error, info};
use regex::Regex;
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use decrypt::decrypt;
use libsodium_sys as sodium;

/// Comprehensive error type for CLI operations.
/// 
/// This enum represents all possible errors that can occur during CLI
/// execution, from key parsing to file I/O to decryption failures.
/// Each variant provides detailed context about what went wrong.
/// 
/// # Examples
/// 
/// ```ignore
/// match parse_master_key(&key_str) {
///     Ok(key) => { /* use key */ },
///     Err(CliError::InvalidKey(msg)) => eprintln!("Key error: {}", msg),
///     Err(e) => eprintln!("Other error: {}", e),
/// }
/// ```
#[derive(Debug)]
pub enum CliError {
    /// Invalid hex key format provided by user.
    /// 
    /// Occurs when the master key is not exactly 64 hex characters (32 bytes)
    /// or contains invalid hex digits.
    InvalidKey(String),
    
    /// Input file or directory not found at the specified path.
    /// 
    /// Occurs when the provided input path does not exist or is inaccessible.
    PathNotFound(String),
    
    /// Invalid configuration parameter provided via CLI flags.
    /// 
    /// Occurs when command-line arguments contain invalid values (e.g., zero
    /// memory limit, negative worker count).
    InvalidConfig(String),
    
    /// Failed to read a chunk file from disk.
    /// 
    /// Occurs during lazy loading when a specific chunk file cannot be read,
    /// typically due to permissions or file system errors.
    ChunkReadError(String),
    
    /// No encrypted chunk files found in the specified directory.
    /// 
    /// Occurs when scanning a directory that should contain chunks but none
    /// matching the expected pattern (w{worker}_{index}.bin) were found.
    NoChunksFound(String),
    
    /// Decryption operation failed from the decrypt library.
    /// 
    /// Wraps errors from the decrypt crate, including wrong keys, corrupted
    /// data, authentication failures, and decompression errors.
    DecryptionFailed(String),
    
    /// Generic file I/O error occurred.
    /// 
    /// Wraps std::io::Error for file operations like reading metadata,
    /// opening output files, or writing decrypted data.
    IoError(std::io::Error),
    
    /// Regex pattern compilation failed.
    /// 
    /// Occurs if the chunk filename pattern fails to compile (should be rare
    /// as the pattern is hardcoded).
    RegexError(regex::Error),
    
    /// Hex string decoding failed.
    /// 
    /// Occurs when converting the hex-encoded master key to bytes fails due
    /// to invalid hex characters.
    HexError(hex::FromHexError),
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::InvalidKey(msg) => write!(f, "Invalid key: {}", msg),
            CliError::PathNotFound(msg) => write!(f, "Path not found: {}", msg),
            CliError::InvalidConfig(msg) => write!(f, "Invalid configuration: {}", msg),
            CliError::ChunkReadError(msg) => write!(f, "Failed to read chunk: {}", msg),
            CliError::NoChunksFound(msg) => write!(f, "No chunks found: {}", msg),
            CliError::DecryptionFailed(msg) => write!(f, "Decryption failed: {}", msg),
            CliError::IoError(e) => write!(f, "I/O error: {}", e),
            CliError::RegexError(e) => write!(f, "Regex error: {}", e),
            CliError::HexError(e) => write!(f, "Hex decoding error: {}", e),
        }
    }
}

impl std::error::Error for CliError {}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError::IoError(e)
    }
}

impl From<regex::Error> for CliError {
    fn from(e: regex::Error) -> Self {
        CliError::RegexError(e)
    }
}

impl From<hex::FromHexError> for CliError {
    fn from(e: hex::FromHexError) -> Self {
        CliError::HexError(e)
    }
}

impl From<decrypt::DecryptError> for CliError {
    fn from(e: decrypt::DecryptError) -> Self {
        CliError::DecryptionFailed(format!("{}", e))
    }
}

type Result<T> = std::result::Result<T, CliError>;

#[derive(Parser)]
#[command(name = "decrypt")]
#[command(about = "Decryption tool for files encrypted through ByteBridge")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Parser)]
enum Commands {
    /// Unbox (decrypt) encrypted files or directories
    /// 
    /// This command handles both single files and chunked directories.
    /// It auto-detects the encryption mode (single-worker or parallel) and processes
    /// the input appropriately.
    Unbox {
        /// Path to encrypted file or directory containing chunks
        #[arg(short, long)]
        input: PathBuf,

        /// Path to output file (defaults to input path with .decrypted extension)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Master key as hex string (64 characters for 32 bytes)
        #[arg(short, long)]
        key: String,

        /// Memory limit in MB (default: 512)
        #[arg(long, default_value = "512")]
        memory_limit_mb: usize,

        /// This is a validation limit for how many workers could have encrypted
        /// the file, NOT a limit on decryption threads (decryption is always
        /// single-threaded). Should align with frontend's MAX_WORKERS setting (default: 32).
        #[arg(long, default_value = "32")]
        max_workers: usize,

        /// Maximum chunk size in MB (default: 100)
        #[arg(long, default_value = "100")]
        max_chunk_size_mb: usize,
    },
}

/// Metadata for a chunk file without loading its actual data into memory.
/// 
/// This structure stores only the file path, size, and indices needed to
/// identify a chunk, enabling true lazy loading. The actual chunk data is
/// only read from disk when `load_data()` is called, allowing the system
/// to process large files with minimal memory usage.
/// 
/// ```ignore
/// let meta = ChunkMetadata {
///     worker_id: 0,
///     chunk_index: 42,
///     path: PathBuf::from("/tmp/w0_42.bin"),
///     size: 20_971_520,  // 20MB
/// };
/// 
/// // Metadata is tiny, as no data has been loaded yet
/// println!("Chunk size: {} bytes", meta.size);
/// 
/// // Load data on-demand when actually needed
/// let data = meta.load_data()?;
/// ```
#[derive(Debug, Clone)]
struct ChunkMetadata {
    /// Worker ID that created this chunk during parallel encryption.
    /// 
    /// For single-worker encryption, this is always 0. For parallel encryption,
    /// ranges from 0 to (worker_count - 1).
    worker_id: usize,
    
    /// Sequential index of this chunk within the worker's stream.
    /// 
    /// Chunks are numbered 0, 1, 2, ... where chunk 0 is always the header.
    /// This index is used to maintain correct decryption order.
    chunk_index: usize,
    
    /// Absolute path to the chunk file on disk.
    /// 
    /// Typically follows the pattern: `w{worker_id}_{chunk_index}.bin`
    path: PathBuf,
    
    /// Size of the chunk file in bytes.
    /// 
    /// Stored in metadata to avoid extra filesystem calls and for progress
    /// tracking without loading the actual data.
    size: u64,
}

impl ChunkMetadata {
    /// Loads the chunk data from disk on-demand.
    /// 
    /// This function performs the actual file I/O to read the chunk contents.
    /// It should only be called when the chunk is actually needed for decryption,
    /// not during the initial directory scan.
    /// 
    /// # Returns
    /// 
    /// The raw encrypted chunk data as a byte vector.
    /// 
    /// # Errors
    /// 
    /// Returns `CliError::ChunkReadError` if:
    /// - The file no longer exists (was deleted after scanning)
    /// - Insufficient permissions to read the file
    /// - I/O error during read operation
    /// - File system error
    /// 
    /// # Memory Impact
    /// 
    /// This function allocates a Vec<u8> with size equal to the chunk size.
    /// The memory is held until the chunk is processed and then immediately freed, 
    /// keeping peak memory at O(chunk_size).
    /// 
    /// # Examples
    /// 
    /// ```ignore
    /// for meta in chunk_metadata {
    ///     // Load on-demand - memory held briefly
    ///     let data = meta.load_data()?;
    ///     process_chunk(data)?;
    ///     // data freed here automatically
    /// }
    /// ```
    fn load_data(&self) -> Result<Vec<u8>> {
        debug!("Loading chunk {} from worker {} ({} bytes)", 
            self.chunk_index, self.worker_id, self.size);
        
        fs::read(&self.path)
            .map_err(|e| CliError::ChunkReadError(
                format!("Failed to read {}: {}", self.path.display(), e)
            ))
    }
}

/// Iterator that yields chunks one at a time, loading them lazily from disk.
/// 
/// This iterator implements streaming by only loading chunk data when
/// `next()` is called, not during construction. This enables processing
/// arbitrarily large files with minimal memory usage.
/// 
/// # Design
/// 
/// The iterator stores only lightweight `ChunkMetadata` (paths, sizes, indices)
/// and loads the actual chunk bytes on-demand via `load_data()` when `next()`
/// is called. This is the key to achieving O(chunk_size) memory usage instead
/// of O(file_size).
/// 
/// # Examples
/// 
/// ```ignore
/// let metadata = scan_chunk_metadata("/path/to/chunks")?;
/// let iter = ChunkIterator::new(metadata);
/// 
/// println!("Will process {} chunks from {} workers",
///     iter.len(), iter.worker_count());
/// 
/// for chunk_result in iter {
///     let (index, data) = chunk_result?;
///     println!("Processing chunk {} ({} bytes)", index, data.len());
/// }
/// ```
struct ChunkIterator {
    /// Ordered metadata for all chunks in the file.
    /// 
    /// This Vec contains only metadata (~100 bytes per chunk), not actual
    /// chunk data. 
    metadata: Vec<ChunkMetadata>,
    
    /// Current position in the iteration sequence.
    /// 
    /// Incremented each time `next()` is called. When position reaches
    /// metadata.len(), the iterator returns None.
    position: usize,
}

impl ChunkIterator {
    /// Creates a new chunk iterator from pre-scanned metadata.
    /// 
    /// The metadata should already be in the correct processing order:
    /// typically all chunks from worker 0, then worker 1, etc., with each
    /// worker's chunks sorted by index.
    /// 
    /// # Arguments
    /// 
    /// * `metadata` - Pre-sorted vector of chunk metadata
    /// 
    /// # Memory
    /// 
    /// This function does NOT load any chunk data, it only stores the metadata
    /// vector which is typically <100KB even for very large files.
    /// 
    /// # Examples
    /// 
    /// ```ignore
    /// let metadata = vec![
    ///     ChunkMetadata { worker_id: 0, chunk_index: 0, ... },  // Header
    ///     ChunkMetadata { worker_id: 0, chunk_index: 1, ... },  // Data
    ///     ChunkMetadata { worker_id: 0, chunk_index: 2, ... },  // Data
    /// ];
    /// let iter = ChunkIterator::new(metadata);
    /// ```
    fn new(metadata: Vec<ChunkMetadata>) -> Self {
        Self {
            metadata,
            position: 0,
        }
    }

    /// Returns the total number of chunks that will be yielded.
    /// 
    /// This includes the header chunk(s) and all data chunks. Useful for
    /// progress tracking and validation.
    /// 
    /// # Examples
    /// 
    /// ```ignore
    /// let iter = scan_chunk_metadata("/path")?;
    /// println!("Found {} chunks to process", iter.len());
    /// ```
    fn len(&self) -> usize {
        self.metadata.len()
    }

    /// Returns the number of unique workers that encrypted the file.
    /// 
    /// This is determined by finding the maximum worker_id in the metadata
    /// and adding 1 (since IDs are 0-based). For single-worker encryption,
    /// returns 1. For parallel encryption, returns the actual worker count.
    /// 
    /// # Returns
    /// 
    /// Number of workers that participated in encryption (1 to 32 typically).
    /// 
    /// # Examples
    /// 
    /// ```ignore
    /// let iter = scan_chunk_metadata("/path")?;
    /// match iter.worker_count() {
    ///     1 => println!("Single-worker encryption"),
    ///     n => println!("Parallel encryption with {} workers", n),
    /// }
    /// ```
    fn worker_count(&self) -> usize {
        let mut max_worker = 0;
        for meta in &self.metadata {
            max_worker = max_worker.max(meta.worker_id);
        }
        max_worker + 1
    }
}

impl Iterator for ChunkIterator {
    /// Iterator yields Result<(chunk_index, chunk_data)>
    /// 
    /// The Result wrapper allows propagating I/O errors that occur during
    /// lazy loading. The tuple contains the chunk's logical index and its
    /// raw encrypted bytes.
    type Item = Result<(usize, Vec<u8>)>;

    /// Loads and returns the next chunk on-demand.
    /// 
    /// This is where the actual chunk data is read from disk, NOT during
    /// iterator construction. This lazy loading is critical for memory
    /// efficiency.
    /// 
    /// # Returns
    /// 
    /// - `Some(Ok((index, data)))` - Successfully loaded next chunk
    /// - `Some(Err(e))` - Failed to load chunk (I/O error)
    /// - `None` - No more chunks, iteration complete
    /// 
    /// # Memory Behavior
    /// 
    /// Each call to `next()`:
    /// 1. Loads one chunk from disk (~20MB typical)
    /// 2. Returns it wrapped in Result
    /// 3. Previous chunk's memory is freed (if no longer referenced)
    /// 
    /// This ensures only one chunk is in memory at a time during iteration.
    /// 
    /// # Errors
    /// 
    /// Returns `Err` if the chunk file cannot be read, wrapping the I/O error
    /// with context about which chunk failed. The iterator does NOT stop on
    /// error, the caller must handle the error or propagate it.
    /// 
    /// # Examples
    /// 
    /// ```ignore
    /// let mut iter = ChunkIterator::new(metadata);
    /// 
    /// while let Some(chunk_result) = iter.next() {
    ///     match chunk_result {
    ///         Ok((index, data)) => {
    ///             println!("Processing chunk {}", index);
    ///             // data freed after this block
    ///         }
    ///         Err(e) => {
    ///             eprintln!("Failed to load chunk: {}", e);
    ///             break;
    ///         }
    ///     }
    /// }
    /// ```
    fn next(&mut self) -> Option<Self::Item> {
        if self.position >= self.metadata.len() {
            return None;
        }

        let meta = &self.metadata[self.position];
        self.position += 1;

        Some(meta.load_data().map(|data| (meta.chunk_index, data)))
    }
}

/// Parses and validates a hex-encoded master key from user input.
/// 
/// The master key is provided by users as a 64-character hexadecimal string
/// (representing 32 bytes). This function validates the format and converts
/// it to the binary [u8; 32] format required by the decryption functions.
/// 
/// # Arguments
/// 
/// * `hex` - Hexadecimal string, optionally with whitespace/newlines
/// 
/// # Returns
/// 
/// A 32-byte array containing the binary master key.
/// 
/// # Errors
/// 
/// Returns `CliError::InvalidKey` if:
/// - String is not exactly 64 hex characters (after removing whitespace)
/// - String contains non-hexadecimal characters
/// - Hex decoding fails
/// 
/// # Format
/// 
/// Accepts various formats:
/// - Compact: `"a1b2c3d4e5f6..."`
/// - With spaces: `"a1 b2 c3 d4 e5 f6..."`
/// - With newlines: Multi-line input is cleaned automatically
/// 
/// # Security Notes
/// 
/// The key is temporarily in memory as a String during parsing, then copied
/// to a fixed array. Rust does not guarantee secure memory zeroing, so keys
/// remain in memory until garbage collected.
/// 
/// # Examples
/// 
/// ```ignore
/// // Clean hex string
/// let key = parse_master_key(
///     "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
/// )?;
/// 
/// // With whitespace (automatically cleaned)
/// let key = parse_master_key(
///     "0123 4567 89ab cdef 0123 4567 89ab cdef\n\
///      0123 4567 89ab cdef 0123 4567 89ab cdef"
/// )?;
/// 
/// // Invalid, it is too short
/// assert!(parse_master_key("0123").is_err());
/// 
/// // Invalid, it is a non-hex character
/// assert!(parse_master_key("xyz...").is_err());
/// ```
fn parse_master_key(hex: &str) -> Result<[u8; 32]> {
    // Remove whitespace and validate length
    let hex = hex.trim().replace(" ", "").replace("\n", "");
    
    if hex.len() != 64 {
        return Err(CliError::InvalidKey(format!(
            "Key must be exactly 64 hex characters (32 bytes), got {} characters",
            hex.len()
        )));
    }

    // Validate hex format
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CliError::InvalidKey(
            "Key contains invalid hex characters".to_string()
        ));
    }

    // Convert to bytes
    let bytes = hex::decode(&hex)?;

    let mut master_key = [0u8; 32];
    master_key.copy_from_slice(&bytes);
    
    debug!("Successfully parsed master key (32 bytes)");
    Ok(master_key)
}

/// Represents the type of encrypted input detected.
/// 
/// ByteBridge supports two encryption output formats:
/// 1. Single file - All chunks concatenated into one encrypted file
/// 2. Chunked directory - Individual chunk files named w{worker}_{index}.bin
/// 
/// This enum distinguishes between these formats for appropriate processing.
#[derive(Debug)]
enum InputType {
    /// Single encrypted file containing all chunks.
    /// 
    /// The file contains the header chunk followed by all data chunks in
    /// sequence. This is simpler but less flexible than chunked output.
    SingleFile(PathBuf),
    
    /// Directory containing individual encrypted chunk files.
    /// 
    /// Used when encryption produced separate files for each chunk, typically
    /// named following the pattern `w{worker_id}_{chunk_index}.bin`. This
    /// format is more common for large files and parallel encryption.
    ChunkedDirectory(PathBuf),
}

/// Detects whether input is a single file or directory of chunks.
/// 
/// This function performs basic filesystem checks to determine the input
/// format, enabling automatic handling of both encryption output types
/// without requiring the user to specify the format explicitly.
/// 
/// # Arguments
/// 
/// * `input` - Path to either an encrypted file or directory of chunks
/// 
/// # Returns
/// 
/// An `InputType` enum indicating which format was detected.
/// 
/// # Errors
/// 
/// Returns `CliError::PathNotFound` if:
/// - The input path does not exist
/// - The path is neither a file nor directory (e.g., symlink, socket)
/// - Insufficient permissions to access the path
/// 
/// # Detection Logic
/// 
/// 1. Checks if path exists
/// 2. If it's a regular file → `SingleFile`
/// 3. If it's a directory → `ChunkedDirectory`
/// 4. Otherwise → Error
/// 
/// # Examples
/// 
/// ```ignore
/// // Single file
/// let input = Path::new("/tmp/encrypted_file.bin");
/// let type = detect_input_type(input)?;  // SingleFile
/// 
/// // Directory of chunks
/// let input = Path::new("/tmp/chunks/");
/// let type = detect_input_type(input)?;  // ChunkedDirectory
/// 
/// // Non-existent path
/// let input = Path::new("/tmp/missing");
/// assert!(detect_input_type(input).is_err());
/// ```
fn detect_input_type(input: &Path) -> Result<InputType> {
    if !input.exists() {
        return Err(CliError::PathNotFound(
            format!("Input path does not exist: {}", input.display())
        ));
    }

    if input.is_file() {
        info!("Detected single file input: {}", input.display());
        Ok(InputType::SingleFile(input.to_path_buf()))
    } else if input.is_dir() {
        info!("Detected directory input: {}", input.display());
        Ok(InputType::ChunkedDirectory(input.to_path_buf()))
    } else {
        Err(CliError::PathNotFound(
            format!("Input is neither a file nor directory: {}", input.display())
        ))
    }
}

/// Scans directory and collects chunk metadata without loading actual data.
/// 
/// This function performs a directory scan to find all encrypted chunk files,
/// extracts their worker IDs and indices from filenames, sorts them properly,
/// and returns a `ChunkIterator` ready for lazy loading. Critically, this
/// function does NOT load the actual chunk bytes, only filesystem metadata.
/// 
/// # Arguments
/// 
/// * `dir` - Path to directory containing chunk files
/// 
/// # Returns
/// 
/// A `ChunkIterator` configured with metadata for all found chunks, ready
/// for lazy iteration.
/// 
/// # Errors
/// 
/// Returns `CliError` if:
/// - Directory cannot be read (permissions, doesn't exist)
/// - No valid chunk files found matching the expected pattern
/// - Chunk filenames contain invalid worker IDs or indices
/// - Regex pattern fails to compile (should never happen)
/// 
/// # Chunk Filename Pattern
/// 
/// Expected format: `w{worker_id}_{chunk_index}.bin`
/// - worker_id: 0-based worker identifier (0, 1, 2, ...)
/// - chunk_index: 0-based chunk number within worker (0=header, 1+=data)
/// 
/// Examples:
/// - `w0_0.bin` - Worker 0, header chunk
/// - `w0_1.bin` - Worker 0, first data chunk
/// - `w1_0.bin` - Worker 1, header chunk
/// 
/// # Chunk Ordering
/// 
/// Chunks are sorted to ensure correct decryption order:
/// 1. Grouped by worker ID (ascending)
/// 2. Within each worker, sorted by chunk index (ascending)
/// 
/// Result: `[W0_0, W0_1, W0_2, W1_0, W1_1, W2_0, ...]`
/// 
/// # Examples
/// 
/// ```ignore
/// let dir = Path::new("/tmp/encrypted_chunks/");
/// let iter = scan_chunk_metadata(dir)?;
/// 
/// println!("Found {} chunks from {} workers",
///     iter.len(), iter.worker_count());
/// 
/// // Chunks not loaded yet - can iterate when ready
/// for chunk_result in iter {
///     let (index, data) = chunk_result?;
///     // data loaded on-demand here
/// }
/// ```
/// 
/// # Performance
/// 
/// Directory scanning is typically very fast (milliseconds for thousands of
/// files) since only metadata is read. The bottleneck shifts to actual chunk
/// processing where I/O bandwidth and decryption speed matter.
fn scan_chunk_metadata(dir: &Path) -> Result<ChunkIterator> {
    info!("Scanning directory for chunk files: {}", dir.display());
    
    // Pattern: w{workerId}_{chunkIndex}.bin
    let chunk_pattern = Regex::new(r"^w(\d+)_(\d+)\.bin$")?;
    
    // Use BTreeMap for automatic sorting by worker ID
    let mut chunks_by_worker: BTreeMap<usize, Vec<ChunkMetadata>> = BTreeMap::new();
    
    // Scan directory for chunk files (metadata only)
    let entries = fs::read_dir(dir)?;
    
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        
        if !path.is_file() {
            continue;
        }
        
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };
        
        if let Some(captures) = chunk_pattern.captures(filename) {
            let worker_id: usize = captures[1].parse()
                .map_err(|e| CliError::ChunkReadError(
                    format!("Invalid worker ID in {}: {}", filename, e)
                ))?;
            let chunk_index: usize = captures[2].parse()
                .map_err(|e| CliError::ChunkReadError(
                    format!("Invalid chunk index in {}: {}", filename, e)
                ))?;
            
            let metadata = entry.metadata()?;
            let size = metadata.len();
            
            debug!("Found chunk {} from worker {} ({} bytes)", chunk_index, worker_id, size);
            
            chunks_by_worker
                .entry(worker_id)
                .or_insert_with(Vec::new)
                .push(ChunkMetadata {
                    worker_id,
                    chunk_index,
                    path: path.clone(),
                    size,
                });
        }
    }
    
    if chunks_by_worker.is_empty() {
        return Err(CliError::NoChunksFound(
            format!("No chunk files found in directory: {}", dir.display())
        ));
    }
    
    // Determine worker count (BTreeMap keys are already sorted)
    let worker_count = chunks_by_worker.keys().last()
        .map(|&k| k + 1)
        .unwrap_or(1);
    
    info!("Found chunks from {} worker(s)", worker_count);
    
    // Sort chunks within each worker and combine in worker order
    let mut all_metadata = Vec::new();
    for (worker_id, mut worker_chunks) in chunks_by_worker {
        // Sort by chunk index
        worker_chunks.sort_by_key(|meta| meta.chunk_index);
        info!("Worker {} has {} chunk(s)", worker_id, worker_chunks.len());
        all_metadata.extend(worker_chunks);
    }
    
    info!("Found {} total chunks from {} worker(s)", all_metadata.len(), worker_count);
    
    Ok(ChunkIterator::new(all_metadata))
}

/// Creates a lazy iterator for a single encrypted file.
/// 
/// When the input is a single file rather than a directory of chunks, this
/// function wraps it in a `ChunkIterator` for consistent handling. The entire
/// file is treated as one chunk (index 0) from worker 0.
/// 
/// # Arguments
/// 
/// * `path` - Path to the single encrypted file
/// 
/// # Returns
/// 
/// A `ChunkIterator` containing metadata for the single file, ready for lazy
/// loading when iterated.
/// 
/// # Errors
/// 
/// Returns `CliError::IoError` if:
/// - File does not exist
/// - Cannot read file metadata (permissions, I/O error)
/// 
/// # Single File Format
/// 
/// A single encrypted file contains:
/// 1. Header (24 bytes) - XChaCha20-Poly1305 stream header
/// 2. Encrypted data chunks (variable size)
/// 
/// The entire file is processed as one logical chunk by the iterator,
/// which will load it on-demand when `next()` is called.
/// 
/// # Memory Behavior
/// 
/// This function only reads filesystem metadata (size, permissions) and
/// stores the file path. The actual file contents are NOT loaded until
/// the iterator is consumed.
/// 
/// For a 100MB single file:
/// - Memory used by this function: <1KB (just metadata)
/// - Memory used when iterated: ~100MB (file loaded on-demand)
/// 
/// # Examples
/// 
/// ```ignore
/// let file = Path::new("/tmp/large_encrypted_file.bin");
/// let iter = create_single_file_iterator(file)?;
/// 
/// // File not loaded yet
/// println!("File size: {} bytes", iter.len());
/// 
/// // Load on iteration
/// for chunk_result in iter {
///     let (index, data) = chunk_result?;  // File loaded here
///     assert_eq!(index, 0);  // Single file = chunk 0
/// }
/// ```
fn create_single_file_iterator(path: &Path) -> Result<ChunkIterator> {
    info!("Preparing single file: {}", path.display());
    
    let metadata = fs::metadata(path)?;
    let size = metadata.len();
    
    info!("File size: {} bytes", size);
    
    // Single file is treated as one chunk with index 0
    let chunk_meta = ChunkMetadata {
        worker_id: 0,
        chunk_index: 0,
        path: path.to_path_buf(),
        size,
    };
    
    Ok(ChunkIterator::new(vec![chunk_meta]))
}

/// Decrypts encrypted input and streams output directly to a writer.
/// 
/// This is the main decryption orchestrator that handles both single files
/// and chunked directories with full streaming support. Chunks are loaded
/// on-demand via iterators (NO `.collect()`!), achieving O(chunk_size)
/// memory usage instead of O(file_size).
/// 
/// # Arguments
/// 
/// * `input` - Path to encrypted file or directory of chunks
/// * `master_key` - 32-byte master encryption key
/// * `writer` - Output writer where decrypted data will be streamed
/// * `config` - Decryption configuration (memory limits, worker limits, etc.)
/// 
/// # Returns
/// 
/// Total number of bytes written to the output writer.
/// 
/// # Errors
/// 
/// Returns `CliError` for various failures:
/// - `PathNotFound` - Input path doesn't exist
/// - `NoChunksFound` - Directory contains no valid chunks
/// - `InvalidKey` - Wrong decryption key
/// - `DecryptionFailed` - Decryption or decompression failure
/// - `IoError` - File I/O or write errors
/// 
/// # Automatic Format Detection
/// 
/// The function automatically detects and handles:
/// 1. **Single File**: Treats entire file as one chunk stream
/// 2. **Chunked Directory**: Scans for chunk files, detects worker count
/// 
/// # Encryption Mode Detection
/// 
/// For chunked directories, automatically detects:
/// - **Single-Worker**: All chunks from worker 0 → uses single-worker decryption
/// - **Parallel**: Multiple workers → uses parallel decryption with proper ordering
/// 
/// # Process Flow
/// 
/// 1. **Detect input type** (file vs directory)
/// 2. **Create lazy iterator** (metadata only, no data loaded)
/// 3. **Detect encryption mode** (single vs parallel workers)
/// 4. **Pass iterator to decrypt function** (streaming, no collection)
/// 5. **Decrypt function loads chunks on-demand** (one at a time)
/// 6. **Stream output to writer** (no accumulation in memory)
/// 
/// # Examples
/// 
/// ```ignore
/// use std::fs::File;
/// use std::io::BufWriter;
/// 
/// let input = Path::new("/tmp/encrypted_chunks/");
/// let output = File::create("/tmp/decrypted.bin")?;
/// let mut writer = BufWriter::new(output);
/// 
/// let bytes = decrypt_provider_streaming(
///     input,
///     &master_key,
///     &mut writer,
///     &config
/// )?;
/// 
/// println!("Decrypted {} bytes", bytes);
/// ```
/// 
/// # Performance
/// 
/// - **I/O bound**: Disk read/write typically the bottleneck
/// - **CPU efficient**: XChaCha20 decrypts at GB/s, LZ4 decompresses at GB/s
/// - **Memory efficient**: Peak usage ~200-600MB regardless of file size
/// - **Scalable**: Can handle files larger than available RAM
/// 
/// # See Also
/// 
/// - [`decrypt::decrypt_file_to_writer`] - Single-worker streaming decryption
/// - [`decrypt::decrypt_parallel_file_to_writer`] - Parallel streaming decryption
fn decrypt_provider_streaming<W: std::io::Write>(
    input: &Path,
    master_key: &[u8; 32],
    writer: &mut W,
    config: &decrypt::DecryptConfig,
) -> Result<(usize, decrypt::UploadMetadata)> {
    let input_type = detect_input_type(input)?;
    
    match input_type {
        InputType::SingleFile(path) => {
            info!("Processing as single file");
            let chunk_iter = create_single_file_iterator(&path)?;
            
            info!("Starting streaming single-worker decryption (iterator-based)");
            
            // Pass iterator directly with input_path
            let (bytes_written, metadata) = decrypt::decrypt_file_to_writer(
                master_key,
                chunk_iter,  // Iterator, not Vec!
                &path,       // input_path for uploadId extraction
                writer,
                config
            )?;
            
            info!("Successfully streamed {} bytes to output", bytes_written);
            Ok((bytes_written, metadata))
        }
        
        InputType::ChunkedDirectory(dir) => {
            info!("Processing as chunked directory");
            let chunk_iter = scan_chunk_metadata(&dir)?;
            let worker_count = chunk_iter.worker_count();
            let chunk_count = chunk_iter.len();
            
            info!("Detected {} worker(s), {} chunk(s)", worker_count, chunk_count);
            
            if worker_count > 1 {
                info!("Starting streaming parallel decryption (iterator-based, {} workers)", worker_count);
                
                // Pass iterator directly with input_path
                let (bytes_written, metadata) = decrypt::decrypt_parallel_file_to_writer(
                    master_key,
                    chunk_iter,  // Iterator, not Vec!
                    worker_count,
                    &dir,        // input_path for uploadId extraction
                    writer,
                    config
                )?;
                
                info!("Successfully streamed {} bytes to output", bytes_written);
                Ok((bytes_written, metadata))
            } else {
                info!("Starting streaming single-worker decryption (iterator-based)");
                
                // Pass iterator directly with input_path
                let (bytes_written, metadata) = decrypt::decrypt_file_to_writer(
                    master_key,
                    chunk_iter,  // Iterator, not Vec!
                    &dir,        // input_path for uploadId extraction
                    writer,
                    config
                )?;
                
                info!("Successfully streamed {} bytes to output", bytes_written);
                Ok((bytes_written, metadata))
            }
        }
    }
}

/// Generates a sensible output path when user doesn't specify one.
/// 
/// This function creates an output filename based on the input path,
/// adding `.decrypted` extension while handling both files and directories
/// intelligently.
/// 
/// # Arguments
/// 
/// * `input` - Path to the encrypted input (file or directory)
/// 
/// # Returns
/// 
/// A `PathBuf` pointing to where the decrypted output should be written.
/// 
/// # Naming Logic
/// 
/// **For Files**:
/// - Removes the existing extension
/// - Adds `.decrypted` extension
/// - Example: `/path/file.enc` → `/path/file.decrypted`
/// 
/// **For Directories**:
/// - Uses directory name as base
/// - Places in parent directory
/// - Adds `.decrypted` extension
/// - Example: `/path/chunks/` → `/path/chunks.decrypted`
/// 
/// # Special Cases
/// 
/// - File with no extension: Just adds `.decrypted`
/// - Directory with no parent: Places in same directory
/// - Non-UTF8 names: Falls back to `"output.decrypted"`
/// 
/// # Examples
/// 
/// ```ignore
/// // File input
/// let input = Path::new("/tmp/encrypted_data.bin");
/// let output = generate_output_path(input);
/// assert_eq!(output, Path::new("/tmp/encrypted_data.decrypted"));
/// 
/// // Directory input
/// let input = Path::new("/tmp/chunks/");
/// let output = generate_output_path(input);
/// assert_eq!(output, Path::new("/tmp/chunks.decrypted"));
/// 
/// // File without extension
/// let input = Path::new("/tmp/encrypted");
/// let output = generate_output_path(input);
/// assert_eq!(output, Path::new("/tmp/encrypted.decrypted"));
/// ```
/// 
/// # Why Not Just Use Input Name?
/// 
/// We can't overwrite the input (destructive), and we want a clear indicator
/// that the file has been decrypted. The `.decrypted` extension makes this
/// obvious and prevents confusion.
fn generate_output_path_from_metadata(input: &Path, metadata: &decrypt::UploadMetadata) -> PathBuf {
    // Use original filename from metadata if available
    if !metadata.file_name.is_empty() {
        // Place the file in the same directory as the input
        if input.is_file() {
            input.parent()
                .unwrap_or_else(|| Path::new("."))
                .join(&metadata.file_name)
        } else {
            // For directories, place in the parent directory
            input.parent()
                .unwrap_or_else(|| Path::new("."))
                .join(&metadata.file_name)
        }
    } else {
        // Fallback to old behavior if no filename in metadata
        if input.is_file() {
            let mut output = input.to_path_buf();
            if let Some(stem) = input.file_stem() {
                output.set_file_name(stem);
                output.set_extension("decrypted");
            } else {
                output.set_extension("decrypted");
            }
            output
        } else {
            let dir_name = input.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("output");
            input.parent()
                .unwrap_or(input)
                .join(format!("{}.decrypted", dir_name))
        }
    }
}

/// Handles the `unbox` command; decrypts encrypted files or directories.
/// 
/// This is the main entry point for the decryption operation, coordinating
/// all the steps from key validation to final output. It implements streaming 
/// decryption with minimal memory usage.
/// 
/// # Arguments
/// 
/// * `input` - Path to encrypted file or directory of chunks
/// * `output` - Optional output path (auto-generated if None)
/// * `key` - Hex-encoded master key (64 hex chars = 32 bytes)
/// * `memory_limit_mb` - Maximum memory budget in megabytes
/// * `max_workers` - Maximum number of parallel workers the frontend may use
/// * `max_chunk_size_mb` - Maximum chunk size in megabytes
/// 
/// # Returns
/// 
/// `Ok(())` on successful decryption, `Err(CliError)` on any failure.
/// 
/// # Errors
/// 
/// Can return various `CliError` types:
/// - `InvalidKey` - Malformed hex key
/// - `InvalidConfig` - Zero/invalid config parameters
/// - `PathNotFound` - Input doesn't exist
/// - `DecryptionFailed` - Wrong key, corrupted data, etc.
/// - `IoError` - Cannot write output file
/// 
/// # Process Flow
/// 
/// 1. **Parse and validate key** - Convert hex string to bytes
/// 2. **Validate config parameters** - Ensure sensible limits
/// 3. **Build decrypt config** - Set memory limits, worker limits, etc.
/// 4. **Determine output path** - Use provided or auto-generate
/// 5. **Open output file** - Create BufWriter for efficient I/O
/// 6. **Stream decrypt** - Process input, write output on-the-fly
/// 7. **Flush and close** - Ensure all data written
/// 
/// # Memory Efficiency
/// 
/// Uses `BufWriter` around the output file handle to batch writes efficiently,
/// reducing system call overhead. Combined with streaming decryption, this
/// achieves:
/// - **Input**: O(chunk_size) - Chunks loaded on-demand
/// - **Output**: O(buffer_size) - Writes batched by BufWriter (~8KB buffer)
/// - **Total**: O(chunk_size) - Dominated by chunk processing
/// 
/// # Configuration Parameters
/// 
/// **memory_limit_mb**: 
/// - Controls buffer pool size and memory allocation limits
/// - Recommended: 512MB for typical use, 256MB for constrained environments
/// 
/// **max_workers**:
/// - Validation limit for parallel encryption worker count
/// - NOT a threading parameter (decryption is single-threaded)
/// - Should match frontend's MAX_WORKERS (typically 32)
/// 
/// **max_chunk_size_mb**:
/// - Maximum allowed size for individual chunks
/// - Protects against malformed/malicious oversized chunks
/// - Recommended: 100MB (matches typical encryption chunk size)
/// 
/// # Output File Handling
/// 
/// Opens output file with:
/// - `.write(true)` - Enable writing
/// - `.create(true)` - Create if doesn't exist
/// - `.truncate(true)` - Overwrite if exists
/// 
/// The file is wrapped in `BufWriter` for efficient buffered writes, then
/// explicitly flushed at the end to ensure all data is written before
/// returning success.
/// 
/// # Examples
/// 
/// ```ignore
/// // Decrypt with auto-generated output path
/// decrypt_unbox(
///     PathBuf::from("/tmp/encrypted.bin"),
///     None,  // Auto-generate: /tmp/encrypted.decrypted
///     "0123456789abcdef...".to_string(),  // 64 hex chars
///     512,   // 512MB memory limit
///     32,    // Support up to 32 workers
///     100,   // 100MB max chunk size
/// )?;
/// 
/// // Decrypt with explicit output path
/// decrypt_unbox(
///     PathBuf::from("/tmp/chunks/"),
///     Some(PathBuf::from("/tmp/output.bin")),
///     "0123456789abcdef...".to_string(),
///     256,   // 256MB memory limit (constrained)
///     16,    // Support up to 16 workers
///     50,    // 50MB max chunk size
/// )?;
/// ```
/// 
/// # Performance
/// 
/// For an 8GB file:
/// - **Time**: ~20-60 seconds (depends on disk speed)
/// - **Memory**: ~200-600MB peak (independent of file size!)
/// - **CPU**: Usually <20% (I/O bound, not CPU bound)
/// 
/// # See Also
/// 
/// - [`decrypt_provider_streaming`] - Core streaming decryption logic
/// - [`parse_master_key`] - Key validation and parsing
/// - [`generate_output_path`] - Output path generation
fn decrypt_unbox(
    input: PathBuf,
    output: Option<PathBuf>,
    key: String,
    memory_limit_mb: usize,
    max_workers: usize,
    max_chunk_size_mb: usize,
) -> Result<()> {    
    // Validate and parse key
    let master_key = parse_master_key(&key)?;
    
    // Validate configuration parameters
    if memory_limit_mb == 0 {
        return Err(CliError::InvalidConfig(
            "Memory limit must be greater than 0 MB".to_string()
        ));
    }
    if max_workers == 0 {
        return Err(CliError::InvalidConfig(
            "Max workers must be greater than 0".to_string()
        ));
    }
    if max_chunk_size_mb == 0 {
        return Err(CliError::InvalidConfig(
            "Max chunk size must be greater than 0 MB".to_string()
        ));
    }
    
    // Build configuration
    let config = decrypt::DecryptConfig::default()
        .with_memory_limit_mb(memory_limit_mb)
        .with_max_workers(max_workers)
        .with_max_chunk_size(max_chunk_size_mb * 1024 * 1024);
    
    debug!("Configuration: memory_limit={}MB, max_workers={}, max_chunk_size={}MB",
        memory_limit_mb, max_workers, max_chunk_size_mb);
    
    info!("Input: {}", input.display());
    
    // Use a temporary file, decrypt to it, then rename based on metadata
    let parent_dir = input.parent().unwrap_or_else(|| Path::new("."));
    let temp_output = parent_dir.join(format!(".decrypting_{}", std::process::id()));
    
    // Open temporary output file for streaming write
    let output_file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_output)?;
    
    // Use BufWriter for better I/O performance
    let mut writer = std::io::BufWriter::new(output_file);
    
    // Decrypt and stream directly to temporary file (gets metadata from chunk 0)
    let (bytes_written, metadata) = decrypt_provider_streaming(&input, &master_key, &mut writer, &config)?;
    
    // Ensure all data is written
    writer.flush()?;
    drop(writer);  // Close the file
    
    // Determine final output path
    let final_output = if let Some(explicit_output) = output {
        explicit_output
    } else {
        generate_output_path_from_metadata(&input, &metadata)
    };
    
    // Rename temporary file to final name
    std::fs::rename(&temp_output, &final_output)?;
    
    info!("Output: {}", final_output.display());
    info!("Successfully unboxed {} bytes to: {}", bytes_written, final_output.display());
    
    Ok(())
}

fn main() {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();
    
    // Initialize libsodium
    unsafe {
        if sodium::sodium_init() < 0 {
            error!("Failed to initialize libsodium");
            std::process::exit(1);
        }
    }
    debug!("Libsodium initialized successfully");
    
    // Parse CLI arguments
    let cli = Cli::parse();
    
    // Execute command
    let result = match cli.command {
        Commands::Unbox {
            input,
            output,
            key,
            memory_limit_mb,
            max_workers,
            max_chunk_size_mb,
        } => decrypt_unbox(
            input,
            output,
            key,
            memory_limit_mb,
            max_workers,
            max_chunk_size_mb,
        ),
    };
    
    // Handle result
    match result {
        Ok(()) => {
            info!("Operation completed successfully");
            std::process::exit(0);
        }
        Err(e) => {
            error!("Operation failed: {}", e);
            std::process::exit(1);
        }
    }
}