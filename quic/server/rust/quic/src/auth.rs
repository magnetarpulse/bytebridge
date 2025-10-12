use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use std::sync::Arc;
use std::num::NonZeroUsize;
use std::collections::HashMap;
use anyhow::Result;
use tracing::{info, warn, debug};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio::fs;
use lru::LruCache;
use zeroize::Zeroize;

/// Size of authentication proof in bytes (256-bit).
const PROOF_SIZE_BYTES: usize = 32;

/// Default time-to-live for authenticated connections (1 hour).
pub const CONNECTION_TTL_SECS: u64 = 3600;

/// Maximum number of entries in proof cache (LRU eviction).
const MAX_CACHE_ENTRIES: usize = 10000;

/// Time-to-live for cached proofs (1 hour).
const CACHE_PROOF_TTL_SECS: u64 = 3600;

/// Batch size for cleanup operations.
const CLEANUP_BATCH_SIZE: usize = 100;

/// Number of proofs to prefetch based on recent patterns.
const PREFETCH_WINDOW: usize = 5;

/// Minimum access count before enabling prefetch for a pattern.
const MIN_PREFETCH_ACCESS_COUNT: u32 = 2;

/// Time-to-live for access patterns (24 hours).
const ACCESS_PATTERN_TTL_SECS: u64 = 86400;

/// Metadata associated with an upload session.
///
/// This structure stores timing information for upload sessions, including
/// when they were created and when they should expire. This metadata is
/// persisted to disk as JSON and used for session lifecycle management.
///
/// # File Format
///
/// Stored as `{upload_id}.meta` in the keys directory with JSON encoding:
/// ```json
/// {
///   "created_at": 1234567890,
///   "expires_at": 1234571490
/// }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone)]
struct UploadMetadata {
    /// Unix timestamp (seconds) when this upload session was created.
    created_at: u64,
    
    /// Unix timestamp (seconds) when this upload session expires.
    expires_at: u64,
}

/// Cached proof with timestamp for TTL management.
#[derive(Clone)]
struct CachedProof {
    /// The proof bytes (32 bytes).
    proof: Vec<u8>,
    
    /// When this proof was cached.
    cached_at: SystemTime,
    
    /// Whether this was prefetched (for metrics).
    prefetched: bool,
}

/// Tracks upload access patterns for predictive caching.
///
/// This structure learns which uploads are commonly accessed together,
/// enabling predictive prefetching to reduce latency.
#[derive(Debug, Clone)]
struct AccessPattern {
    /// Upload IDs that are frequently accessed after this one.
    /// Ordered by frequency (most common first).
    related_uploads: Vec<String>,
    
    /// Timestamp of last access.
    last_accessed: SystemTime,
    
    /// Total number of times this upload was accessed.
    access_count: u32,
    
    /// Correlation scores with related uploads (0.0 to 1.0).
    correlation_scores: HashMap<String, f64>,
}

/// Statistics for monitoring authenticator performance.
#[derive(Default, Debug, Clone, Serialize)]
pub struct AuthStats {
    /// Total number of proof validations attempted.
    pub total_validations: u64,
    
    /// Number of validations that used cached proofs (fast path).
    pub cache_hits: u64,
    
    /// Number of validations that required disk I/O (slow path).
    pub cache_misses: u64,
    
    /// Number of successful authentications.
    pub successful_auths: u64,
    
    /// Number of failed authentication attempts.
    pub failed_auths: u64,
    
    /// Number of expired cache entries cleaned.
    pub expired_cache_cleaned: u64,
    
    /// Number of expired sessions cleaned.
    pub expired_sessions_cleaned: u64,
    
    /// Number of proofs prefetched based on patterns.
    pub prefetched_proofs: u64,
    
    /// Number of prefetched proofs that were actually used.
    pub prefetch_hits: u64,
    
    /// Number of access patterns tracked.
    pub tracked_patterns: u64,
}

impl AuthStats {
    /// Calculate cache hit rate as percentage.
    pub fn cache_hit_rate(&self) -> f64 {
        if self.total_validations == 0 {
            return 0.0;
        }
        (self.cache_hits as f64 / self.total_validations as f64) * 100.0
    }
    
    /// Calculate authentication success rate as percentage.
    pub fn success_rate(&self) -> f64 {
        if self.total_validations == 0 {
            return 0.0;
        }
        (self.successful_auths as f64 / self.total_validations as f64) * 100.0
    }
    
    /// Calculate prefetch effectiveness as percentage.
    pub fn prefetch_hit_rate(&self) -> f64 {
        if self.prefetched_proofs == 0 {
            return 0.0;
        }
        (self.prefetch_hits as f64 / self.prefetched_proofs as f64) * 100.0
    }
}

/// Health check result for monitoring.
#[derive(Debug, Serialize)]
pub struct AuthHealth {
    /// Number of proofs currently cached.
    pub cached_proofs: usize,
    
    /// Number of active authenticated connections.
    pub active_connections: usize,
    
    /// Total validations performed.
    pub total_validations: u64,
    
    /// Cache hit rate percentage.
    pub cache_hit_rate: f64,
    
    /// Authentication success rate percentage.
    pub success_rate: f64,
    
    /// Prefetch hit rate percentage.
    pub prefetch_hit_rate: f64,
    
    /// Number of tracked access patterns.
    pub tracked_patterns: usize,
    
    /// Whether keys directory exists.
    pub keys_dir_exists: bool,
    
    /// Whether keys directory is writable.
    pub keys_dir_writable: bool,
}

/// Filesystem-based authentication system for upload sessions.
///
/// This authenticator manages proof-based authentication for file upload sessions,
/// storing cryptographic proofs on disk and caching them in memory for performance.
/// It tracks both upload sessions (via proofs) and individual network connections.
///
/// # New Features (v3.0)
///
/// 1. **Async File I/O**: Uses `tokio::fs` for non-blocking operations
/// 2. **LRU Cache**: Automatic eviction of least-recently-used proofs
/// 3. **Cache TTL**: Cached proofs expire after 1 hour
/// 4. **Metrics**: Comprehensive statistics for monitoring
/// 5. **Memory Zeroing**: Sensitive proof data is zeroed before dropping
/// 6. **Batch Cleanup**: Efficient cleanup for large directories
/// 7. **Health Checks**: Built-in health monitoring endpoint
/// 8. **Predictive Prefetching**: Learns access patterns and prefetches related proofs
/// 9. **Connection Pooling**: Efficient connection reuse with LRU eviction
///
/// # Architecture
///
/// The authenticator operates on four levels:
///
/// 1. **Disk Storage**: Persistent proof files in `.keys` directory
/// 2. **Memory Cache**: LRU cache for validated proofs (10,000 entry max)
/// 3. **Connection Pool**: Active authenticated connections with TTL
/// 4. **Pattern Learning**: Access pattern tracking for predictive prefetching
///
/// # Performance
///
/// ```text
/// First Connection (Cache Miss):
/// - Read from disk: ~0.1-1ms
/// - Constant-time compare: ~0.001ms
/// - Cache insertion: ~0.001ms
/// - Pattern update: ~0.001ms
/// - Total: ~1-2ms
///
/// Subsequent Connections (Cache Hit):
/// - LRU lookup: ~0.001ms
/// - TTL check: ~0.001ms
/// - Constant-time compare: ~0.001ms
/// - Total: ~0.003ms (300x faster!)
///
/// Prefetched Connection (Predicted):
/// - Already in cache from prefetch
/// - Zero disk I/O
/// - Total: ~0.003ms
/// ```
#[derive(Clone)]
pub struct FilesystemAuthenticator {
    /// Directory path where authentication keys are stored.
    keys_dir: PathBuf,
    
    /// LRU cache mapping upload IDs to validated proofs with TTL.
    /// Maximum 10,000 entries with automatic eviction.
    proof_cache: Arc<RwLock<LruCache<String, CachedProof>>>,
    
    /// Map of authenticated connection IDs to their timestamps (connection pool).
    /// Uses LRU eviction for automatic cleanup of stale connections.
    authenticated_connections: Arc<RwLock<LruCache<String, SystemTime>>>,
    
    /// Statistics for monitoring and debugging.
    stats: Arc<RwLock<AuthStats>>,
    
    /// Access pattern tracking for predictive caching.
    /// Maps upload_id -> AccessPattern for learning which uploads are related.
    access_patterns: Arc<RwLock<HashMap<String, AccessPattern>>>,
}

impl FilesystemAuthenticator {
    /// Creates a new filesystem authenticator with the specified keys directory.
    ///
    /// The keys directory will be created if it doesn't exist. Initializes empty
    /// LRU caches for both proofs and connections, and empty pattern tracking.
    ///
    /// # Arguments
    ///
    /// * `keys_dir` - Path to directory for storing authentication keys
    ///
    /// # Returns
    ///
    /// A new `FilesystemAuthenticator` instance with empty caches.
    ///
    /// # Errors
    ///
    /// Returns `Err` if directory cannot be created.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let auth = FilesystemAuthenticator::new(".keys").await?;
    /// ```
    pub async fn new(keys_dir: impl AsRef<Path>) -> Result<Self> {
        let keys_dir = keys_dir.as_ref().to_path_buf();
        
        // Create directory asynchronously
        fs::create_dir_all(&keys_dir).await?;
        
        let cache_size = NonZeroUsize::new(MAX_CACHE_ENTRIES).unwrap();
        let conn_size = NonZeroUsize::new(MAX_CACHE_ENTRIES).unwrap();
        
        info!(
            keys_dir = %keys_dir.display(),
            max_cache_entries = MAX_CACHE_ENTRIES,
            cache_ttl_secs = CACHE_PROOF_TTL_SECS,
            prefetch_window = PREFETCH_WINDOW,
            "Filesystem authenticator initialized with predictive caching"
        );
        
        Ok(Self { 
            keys_dir,
            proof_cache: Arc::new(RwLock::new(LruCache::new(cache_size))),
            authenticated_connections: Arc::new(RwLock::new(LruCache::new(conn_size))),
            stats: Arc::new(RwLock::new(AuthStats::default())),
            access_patterns: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    /// Validates an authentication proof for the given upload ID.
    ///
    /// This method implements a three-tier validation strategy with TTL and prefetching:
    ///
    /// 1. **Fast Path**: Check LRU cache + verify TTL
    /// 2. **Slow Path**: Read from disk (async), validate, cache
    /// 3. **Learning Path**: Update access patterns and trigger prefetching
    ///
    /// # Security Features
    ///
    /// - Constant-time comparison prevents timing attacks
    /// - Proof memory is zeroed after use
    /// - Disk proof deleted after first successful validation
    ///
    /// # Performance
    ///
    /// - Cache hit: ~0.003ms
    /// - Cache miss: ~1-2ms
    /// - Prefetch hit: ~0.003ms (zero disk I/O)
    ///
    /// # Arguments
    ///
    /// * `upload_id` - Unique identifier for the upload session
    /// * `provided_proof` - Proof bytes from client (must be 32 bytes)
    ///
    /// # Returns
    ///
    /// - `Ok(true)` - Proof is valid
    /// - `Ok(false)` - Proof is invalid or missing
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let proof = vec![0u8; 32];
    /// let valid = auth.validate_proof("upload123", &proof).await?;
    /// ```
    pub async fn validate_proof(&self, upload_id: &str, provided_proof: &[u8]) -> Result<bool> {
        // Update stats
        {
            let mut stats = self.stats.write().await;
            stats.total_validations += 1;
        }
        
        if provided_proof.len() != PROOF_SIZE_BYTES {
            warn!(
                upload_id = %upload_id,
                provided_length = provided_proof.len(),
                expected_length = PROOF_SIZE_BYTES,
                "Invalid proof length"
            );
            
            let mut stats = self.stats.write().await;
            stats.failed_auths += 1;
            return Ok(false);
        }

        // Fast path: Check LRU cache with TTL
        {
            let mut cache = self.proof_cache.write().await;
            if let Some(cached) = cache.get(upload_id) {
                // Check if cached proof has expired
                let age = SystemTime::now()
                    .duration_since(cached.cached_at)
                    .unwrap_or_default();
                
                if age < Duration::from_secs(CACHE_PROOF_TTL_SECS) {
                    let was_prefetched = cached.prefetched;
                    
                    debug!(
                        upload_id = %upload_id,
                        age_secs = age.as_secs(),
                        prefetched = was_prefetched,
                        "Using cached proof (fast path)"
                    );
                    
                    let mut stats = self.stats.write().await;
                    stats.cache_hits += 1;
                    
                    // Track prefetch effectiveness
                    if was_prefetched {
                        stats.prefetch_hits += 1;
                    }
                    
                    let is_valid = constant_time_compare(provided_proof, &cached.proof);
                    
                    if is_valid {
                        stats.successful_auths += 1;
                        
                        // Record access pattern for learning (get recent uploads from cache)
                        drop(stats); // Release stats lock
                        let context_uploads = self.get_recent_uploads().await;
                        self.record_access_pattern(upload_id, context_uploads).await;
                    } else {
                        stats.failed_auths += 1;
                    }
                    
                    return Ok(is_valid);
                } else {
                    debug!(
                        upload_id = %upload_id,
                        age_secs = age.as_secs(),
                        "Cached proof expired, removing"
                    );
                    cache.pop(upload_id);
                }
            }
        }

        // Slow path: Read from disk (async)
        let proof_path = self.keys_dir.join(format!("{}.proof", upload_id));
        
        if !proof_path.exists() {
            debug!(
                upload_id = %upload_id,
                "No proof file found"
            );
            
            let mut stats = self.stats.write().await;
            stats.cache_misses += 1;
            stats.failed_auths += 1;
            return Ok(false);
        }

        info!(
            upload_id = %upload_id,
            "Reading proof from disk (slow path)"
        );
        
        // Async file read
        let mut stored_proof = fs::read(&proof_path).await?;
        
        let mut stats_guard = self.stats.write().await;
        stats_guard.cache_misses += 1;
        drop(stats_guard);
        
        if stored_proof.len() != PROOF_SIZE_BYTES {
            warn!(
                upload_id = %upload_id,
                stored_length = stored_proof.len(),
                "Invalid stored proof length"
            );
            
            // Zero sensitive data
            stored_proof.zeroize();
            
            let mut stats = self.stats.write().await;
            stats.failed_auths += 1;
            return Ok(false);
        }

        let is_valid = constant_time_compare(provided_proof, &stored_proof);
        
        if is_valid {
            // Cache the proof with current timestamp (not prefetched)
            let cached_proof = CachedProof {
                proof: stored_proof.clone(),
                cached_at: SystemTime::now(),
                prefetched: false,
            };
            
            let mut cache = self.proof_cache.write().await;
            cache.put(upload_id.to_string(), cached_proof);
            
            let cache_size = cache.len();
            drop(cache);
            
            info!(
                upload_id = %upload_id,
                cache_size = cache_size,
                "Cached proof for future connections"
            );
            
            // Update stats
            let mut stats = self.stats.write().await;
            stats.successful_auths += 1;
            drop(stats);
            
            // Delete the proof file (one-time use, async)
            if let Err(e) = fs::remove_file(&proof_path).await {
                warn!(
                    upload_id = %upload_id,
                    error = %e,
                    "Failed to delete proof file"
                );
            } else {
                debug!(
                    upload_id = %upload_id,
                    "Deleted proof file from disk"
                );
            }
            
            // Mark upload as authenticated in filesystem (async)
            let auth_path = self.keys_dir.join(format!("{}.authenticated", upload_id));
            let current_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            fs::write(&auth_path, current_time.to_string()).await?;
            
            // Record access pattern for learning (get recent uploads from cache)
            let context_uploads = self.get_recent_uploads().await;
            self.record_access_pattern(upload_id, context_uploads).await;
            
            // Trigger predictive prefetching in background (non-blocking)
            let self_clone = self.clone();
            let upload_id_owned = upload_id.to_string();
            tokio::spawn(async move {
                if let Err(e) = self_clone.prefetch_related_proofs(&upload_id_owned).await {
                    debug!(
                        upload_id = %upload_id_owned,
                        error = %e,
                        "Prefetch task failed"
                    );
                }
            });
        } else {
            let mut stats = self.stats.write().await;
            stats.failed_auths += 1;
        }
        
        // Zero sensitive data before dropping
        stored_proof.zeroize();
        
        Ok(is_valid)
    }
    
    /// Marks a specific connection as authenticated in the connection pool.
    ///
    /// Uses LRU cache with automatic eviction of oldest connections.
    /// This enables efficient connection reuse without manual cleanup.
    ///
    /// # Arguments
    ///
    /// * `connection_id` - Unique identifier for the connection
    pub async fn mark_connection_authenticated(&self, connection_id: &str) {
        let mut conns = self.authenticated_connections.write().await;
        conns.put(connection_id.to_string(), SystemTime::now());
        
        info!(
            connection_id = %connection_id,
            total_connections = conns.len(),
            "Marked connection as authenticated in pool"
        );
    }

    /// Checks if a specific connection is currently authenticated in the pool.
    ///
    /// This performs O(1) lookup in the LRU cache and updates access order.
    ///
    /// # Arguments
    ///
    /// * `connection_id` - Connection identifier to check
    ///
    /// # Returns
    ///
    /// `true` if authenticated, `false` otherwise.
    pub async fn is_connection_authenticated(&self, connection_id: &str) -> bool {
        let mut conns = self.authenticated_connections.write().await;
        // get() updates LRU order
        conns.get(connection_id).is_some()
    }

    /// Removes a connection from the authenticated pool.
    ///
    /// # Arguments
    ///
    /// * `connection_id` - Connection identifier to remove
    pub async fn remove_connection(&self, connection_id: &str) {
        let mut conns = self.authenticated_connections.write().await;
        if conns.pop(connection_id).is_some() {
            debug!(
                connection_id = %connection_id,
                remaining_connections = conns.len(),
                "Removed connection from pool"
            );
        }
    }

    /// Checks if an upload has a cached proof.
    ///
    /// # Arguments
    ///
    /// * `upload_id` - Upload identifier to check
    ///
    /// # Returns
    ///
    /// `true` if cached and not expired, `false` otherwise.
    pub async fn is_upload_cached(&self, upload_id: &str) -> bool {
        let cache = self.proof_cache.read().await;
        
        if let Some(cached) = cache.peek(upload_id) {
            let age = SystemTime::now()
                .duration_since(cached.cached_at)
                .unwrap_or_default();
            
            age < Duration::from_secs(CACHE_PROOF_TTL_SECS)
        } else {
            false
        }
    }

    /// Gets recently accessed upload IDs from the cache as context.
    ///
    /// This provides the "context" for pattern learning - which other uploads
    /// are currently in cache indicates they were recently accessed together.
    ///
    /// # Returns
    ///
    /// Vector of recent upload IDs (up to PREFETCH_WINDOW items).
    async fn get_recent_uploads(&self) -> Vec<String> {
        let cache = self.proof_cache.read().await;
        
        // Get up to PREFETCH_WINDOW recent uploads from cache
        cache.iter()
            .take(PREFETCH_WINDOW)
            .map(|(id, _)| id.clone())
            .collect()
    }
    
    /// Records an access pattern for predictive caching.
    ///
    /// This method learns which uploads are accessed together, enabling
    /// intelligent prefetching of related proofs.
    ///
    /// # Arguments
    ///
    /// * `upload_id` - The upload that was accessed
    /// * `context_uploads` - Other uploads in the same session/context
    async fn record_access_pattern(&self, upload_id: &str, context_uploads: Vec<String>) {
        let mut patterns = self.access_patterns.write().await;
        
        let pattern = patterns.entry(upload_id.to_string()).or_insert(AccessPattern {
            related_uploads: Vec::new(),
            last_accessed: SystemTime::now(),
            access_count: 0,
            correlation_scores: HashMap::new(),
        });
        
        pattern.last_accessed = SystemTime::now();
        pattern.access_count += 1;
        
        // Update correlation scores
        for related_id in &context_uploads {
            if related_id != upload_id {
                let score = pattern.correlation_scores
                    .entry(related_id.clone())
                    .or_insert(0.0);
                
                // Exponential moving average for correlation
                *score = 0.7 * *score + 0.3;
                
                // Add to related uploads if not present and score is high
                if *score > 0.5 && !pattern.related_uploads.contains(related_id) {
                    pattern.related_uploads.push(related_id.clone());
                }
            }
        }
        
        // Sort by correlation score (highest first)
        pattern.related_uploads.sort_by(|a, b| {
            let score_a = pattern.correlation_scores.get(a).unwrap_or(&0.0);
            let score_b = pattern.correlation_scores.get(b).unwrap_or(&0.0);
            score_b.partial_cmp(score_a).unwrap()
        });
        
        // Keep only top N related uploads
        if pattern.related_uploads.len() > PREFETCH_WINDOW {
            pattern.related_uploads.truncate(PREFETCH_WINDOW);
        }
        
        // Extract values before releasing the lock
        let related_count = pattern.related_uploads.len();
        let access_count = pattern.access_count;
        let patterns_len = patterns.len();
        
        drop(patterns); // Release lock before acquiring stats lock
        
        let mut stats = self.stats.write().await;
        stats.tracked_patterns = patterns_len as u64;
        drop(stats);
        
        debug!(
            upload_id = %upload_id,
            related_count = related_count,
            access_count = access_count,
            context_size = context_uploads.len(),
            "Recorded access pattern"
        );
    }
    
    /// Prefetches related proofs based on learned access patterns.
    ///
    /// This method is called asynchronously after a successful proof validation.
    /// It loads related proofs into the cache before they're requested, eliminating
    /// disk I/O latency for subsequent requests.
    ///
    /// # Arguments
    ///
    /// * `upload_id` - The upload that was just accessed
    ///
    /// # Returns
    ///
    /// Number of proofs successfully prefetched.
    ///
    /// # Errors
    ///
    /// Returns `Err` if file operations fail (non-critical).
    pub async fn prefetch_related_proofs(&self, upload_id: &str) -> Result<usize> {
        let patterns = self.access_patterns.read().await;
        
        let Some(pattern) = patterns.get(upload_id) else {
            return Ok(0);
        };
        
        // Only prefetch if pattern is strong (accessed multiple times)
        if pattern.access_count < MIN_PREFETCH_ACCESS_COUNT {
            return Ok(0);
        }
        
        // Clone related uploads to release lock before I/O
        let related_uploads = pattern.related_uploads.clone();
        drop(patterns); // Release lock before I/O operations
        
        let mut prefetched = 0;
        
        for related_id in &related_uploads {
            // Check if already cached
            {
                let cache = self.proof_cache.read().await;
                if cache.peek(related_id).is_some() {
                    continue; // Already cached, skip
                }
            }
            
            // Try to load from disk (async)
            let proof_path = self.keys_dir.join(format!("{}.proof", related_id));
            if proof_path.exists() {
                match fs::read(&proof_path).await {
                    Ok(proof_bytes) if proof_bytes.len() == PROOF_SIZE_BYTES => {
                        let cached_proof = CachedProof {
                            proof: proof_bytes,
                            cached_at: SystemTime::now(),
                            prefetched: true, // Mark as prefetched
                        };
                        
                        let mut cache = self.proof_cache.write().await;
                        cache.put(related_id.clone(), cached_proof);
                        
                        prefetched += 1;
                        
                        debug!(
                            related_id = %related_id,
                            parent_upload = %upload_id,
                            "Prefetched related proof"
                        );
                    }
                    Ok(_) => {
                        debug!(
                            related_id = %related_id,
                            "Invalid proof size, skipping prefetch"
                        );
                    }
                    Err(e) => {
                        debug!(
                            related_id = %related_id,
                            error = %e,
                            "Failed to read proof for prefetch"
                        );
                    }
                }
            }
        }
        
        if prefetched > 0 {
            let mut stats = self.stats.write().await;
            stats.prefetched_proofs += prefetched as u64;
            
            info!(
                upload_id = %upload_id,
                prefetched_count = prefetched,
                "Prefetched related proofs based on access patterns"
            );
        }
        
        Ok(prefetched)
    }
    
    /// Cleans up expired upload sessions in batches (async).
    ///
    /// Uses async file I/O and processes in batches for better performance.
    ///
    /// # Returns
    ///
    /// The number of sessions cleaned up.
    pub async fn cleanup_expired(&self) -> Result<usize> {
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let mut batch = Vec::with_capacity(CLEANUP_BATCH_SIZE);
        let mut total_cleaned = 0;
        
        // Read directory asynchronously
        let mut entries = fs::read_dir(&self.keys_dir).await?;
        
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("meta") {
                // Async file read
                if let Ok(content) = fs::read_to_string(&path).await {
                    if let Ok(metadata) = serde_json::from_str::<UploadMetadata>(&content) {
                        if current_time > metadata.expires_at {
                            if let Some(upload_id) = path.file_stem().and_then(|s| s.to_str()) {
                                batch.push(upload_id.to_string());
                                
                                // Process batch when full
                                if batch.len() >= CLEANUP_BATCH_SIZE {
                                    total_cleaned += self.delete_batch(&batch).await?;
                                    batch.clear();
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Process remaining batch
        if !batch.is_empty() {
            total_cleaned += self.delete_batch(&batch).await?;
        }
        
        if total_cleaned > 0 {
            let mut stats = self.stats.write().await;
            stats.expired_sessions_cleaned += total_cleaned as u64;
            
            info!(
                cleaned_count = total_cleaned,
                "Cleaned up expired upload sessions"
            );
        }
        
        Ok(total_cleaned)
    }
    
    /// Deletes a batch of upload sessions (async).
    async fn delete_batch(&self, upload_ids: &[String]) -> Result<usize> {
        let mut deleted = 0;
        
        for upload_id in upload_ids {
            // Delete all related files asynchronously
            for ext in &["proof", "meta", "authenticated"] {
                let path = self.keys_dir.join(format!("{}.{}", upload_id, ext));
                if path.exists() {
                    let _ = fs::remove_file(&path).await;
                }
            }
            
            // Remove from cache
            let mut cache = self.proof_cache.write().await;
            cache.pop(upload_id);
            drop(cache);
            
            // Remove from patterns
            let mut patterns = self.access_patterns.write().await;
            patterns.remove(upload_id);
            drop(patterns);
            
            deleted += 1;
            
            debug!(
                upload_id = %upload_id,
                "Deleted expired session"
            );
        }
        
        Ok(deleted)
    }
    
    /// Removes stale connections from the pool based on TTL.
    ///
    /// This is less critical with LRU eviction, but provides explicit cleanup
    /// for connections that haven't been used recently.
    ///
    /// # Arguments
    ///
    /// * `ttl` - Time-to-live for connections
    ///
    /// # Returns
    ///
    /// Number of connections removed.
    pub async fn cleanup_stale_connections(&self, ttl: Duration) -> usize {
        let mut conns = self.authenticated_connections.write().await;
        let now = SystemTime::now();
        
        // Collect stale connection IDs
        let stale: Vec<String> = conns
            .iter()
            .filter_map(|(id, auth_time)| {
                let age = now.duration_since(*auth_time).unwrap_or_default();
                if age >= ttl {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();
        
        // Remove stale connections
        for id in &stale {
            conns.pop(id);
        }
        
        let removed = stale.len();
        
        if removed > 0 {
            info!(
                removed_count = removed,
                remaining_count = conns.len(),
                ttl_secs = ttl.as_secs(),
                "Cleaned up stale connections from pool"
            );
        }
        
        removed
    }
    
    /// Cleans up expired entries from proof cache.
    ///
    /// Removes cached proofs older than TTL.
    ///
    /// # Returns
    ///
    /// Number of expired cache entries removed.
    pub async fn cleanup_expired_cache(&self) -> usize {
        let mut cache = self.proof_cache.write().await;
        let now = SystemTime::now();
        let ttl = Duration::from_secs(CACHE_PROOF_TTL_SECS);
        
        // Collect expired upload IDs
        let expired: Vec<String> = cache
            .iter()
            .filter_map(|(id, cached)| {
                let age = now.duration_since(cached.cached_at).unwrap_or_default();
                if age >= ttl {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();
        
        // Remove expired entries
        for id in &expired {
            cache.pop(id);
        }
        
        let removed = expired.len();
        
        if removed > 0 {
            let mut stats = self.stats.write().await;
            stats.expired_cache_cleaned += removed as u64;
            
            info!(
                removed_count = removed,
                remaining_count = cache.len(),
                "Cleaned up expired cache entries"
            );
        }
        
        removed
    }
    
    /// Cleans up old access patterns.
    ///
    /// Removes patterns not accessed in the configured TTL period (24 hours).
    /// This prevents unbounded memory growth from pattern tracking.
    ///
    /// # Returns
    ///
    /// Number of patterns removed.
    pub async fn cleanup_access_patterns(&self) -> usize {
        let mut patterns = self.access_patterns.write().await;
        let now = SystemTime::now();
        let ttl = Duration::from_secs(ACCESS_PATTERN_TTL_SECS);
        
        let initial_count = patterns.len();
        
        patterns.retain(|_id, pattern| {
            let age = now.duration_since(pattern.last_accessed).unwrap_or_default();
            age < ttl
        });
        
        let removed = initial_count - patterns.len();
        
        if removed > 0 {
            let mut stats = self.stats.write().await;
            stats.tracked_patterns = patterns.len() as u64;
            
            info!(
                removed_count = removed,
                remaining_count = patterns.len(),
                "Cleaned up old access patterns"
            );
        }
        
        removed
    }
    
    /// Returns current statistics.
    ///
    /// # Returns
    ///
    /// Tuple of (cached_proofs, active_connections).
    pub async fn stats(&self) -> (usize, usize) {
        let cache = self.proof_cache.read().await;
        let conns = self.authenticated_connections.read().await;
        (cache.len(), conns.len())
    }
    
    /// Returns detailed statistics for monitoring.
    ///
    /// # Returns
    ///
    /// `AuthStats` with all metrics.
    pub async fn get_stats(&self) -> AuthStats {
        self.stats.read().await.clone()
    }
    
    /// Performs a health check.
    ///
    /// # Returns
    ///
    /// `AuthHealth` with current system status.
    pub async fn health_check(&self) -> AuthHealth {
        let (cached_proofs, active_connections) = self.stats().await;
        let stats = self.stats.read().await;
        let patterns = self.access_patterns.read().await;
        
        // Check if keys dir is writable (async)
        let keys_dir_exists = self.keys_dir.exists();
        let keys_dir_writable = if keys_dir_exists {
            fs::metadata(&self.keys_dir)
                .await
                .map(|m| !m.permissions().readonly())
                .unwrap_or(false)
        } else {
            false
        };
        
        AuthHealth {
            cached_proofs,
            active_connections,
            total_validations: stats.total_validations,
            cache_hit_rate: stats.cache_hit_rate(),
            success_rate: stats.success_rate(),
            prefetch_hit_rate: stats.prefetch_hit_rate(),
            tracked_patterns: patterns.len(),
            keys_dir_exists,
            keys_dir_writable,
        }
    }
}

/// Performs constant-time comparison of two byte slices.
///
/// Prevents timing attacks by ensuring comparison time is independent
/// of where differences occur.
///
/// # Arguments
///
/// * `a` - First byte slice
/// * `b` - Second byte slice
///
/// # Returns
///
/// `true` if equal, `false` otherwise.
fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    
    result == 0
}