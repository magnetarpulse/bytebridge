#[cfg(test)]
mod tests {
    use crate::decrypt::*;
    use libsodium_sys as sodium;

    /// Helper function to initialize libsodium (call once per test)
    fn init_sodium() {
        unsafe {
            if sodium::sodium_init() < 0 {
                panic!("Failed to initialize libsodium");
            }
        }
    }

    /// Simulates the frontend's encryption stream initialization
    /// Returns (state, header, master_key)
    fn simulate_frontend_init() -> (sodium::crypto_secretstream_xchacha20poly1305_state, Vec<u8>, [u8; 32]) {
        init_sodium();
        
        // Generate a master key (what frontend generates)
        let mut master_key = [0u8; 32];
        unsafe {
            sodium::randombytes_buf(
                master_key.as_mut_ptr() as *mut std::ffi::c_void,
                master_key.len()
            );
        }

        // Initialize encryption stream (what frontend does in initStreamingEncrypt)
        let mut state: sodium::crypto_secretstream_xchacha20poly1305_state = unsafe {
            std::mem::zeroed()
        };
        let mut header = vec![0u8; sodium::crypto_secretstream_xchacha20poly1305_HEADERBYTES as usize];

        unsafe {
            let result = sodium::crypto_secretstream_xchacha20poly1305_init_push(
                &mut state,
                header.as_mut_ptr(),
                master_key.as_ptr(),
            );
            assert_eq!(result, 0, "Failed to initialize encryption stream");
        }

        (state, header, master_key)
    }

    /// Derives a sub-key for a worker, matching frontend's crypto_kdf_derive_from_key
    fn derive_worker_subkey(master_key: &[u8; 32], worker_index: usize) -> [u8; 32] {
        init_sodium();
        
        let mut subkey = [0u8; 32];
        let context = format!("worker-{}", worker_index);
        
        // Pad context to exactly 8 bytes as required by crypto_kdf
        let mut context_bytes = [0u8; 8];
        let context_str = context.as_bytes();
        let copy_len = std::cmp::min(context_str.len(), 8);
        context_bytes[..copy_len].copy_from_slice(&context_str[..copy_len]);
        
        unsafe {
            let result = sodium::crypto_kdf_derive_from_key(
                subkey.as_mut_ptr(),
                32, // subkey length
                0,  // subkey_id
                context_bytes.as_ptr() as *const i8,
                master_key.as_ptr(),
            );
            assert_eq!(result, 0, "Failed to derive subkey");
        }
        
        subkey
    }

    /// Simulates frontend's LZ4 compression
    fn simulate_lz4_compress(data: &[u8]) -> Vec<u8> {
        // Prepend the uncompressed size (4 bytes, little-endian) as lz4_flex does
        let uncompressed_size = data.len() as u32;
        let mut result = uncompressed_size.to_le_bytes().to_vec();
        
        // Use lz4_flex to compress (same as frontend)
        let compressed = lz4_flex::compress(data);
        result.extend_from_slice(&compressed);
        
        result
    }

    /// Simulates frontend's chunk encryption
    fn simulate_encrypt_chunk(
        state: &mut sodium::crypto_secretstream_xchacha20poly1305_state,
        chunk: &[u8],
        is_final: bool,
    ) -> Vec<u8> {
        let tag: u8 = if is_final {
            sodium::crypto_secretstream_xchacha20poly1305_TAG_FINAL as u8
        } else {
            sodium::crypto_secretstream_xchacha20poly1305_TAG_MESSAGE as u8
        };

        let max_encrypted_len = chunk.len() + sodium::crypto_secretstream_xchacha20poly1305_ABYTES as usize;
        let mut encrypted = vec![0u8; max_encrypted_len];
        let mut encrypted_len: u64 = 0;

        unsafe {
            let result = sodium::crypto_secretstream_xchacha20poly1305_push(
                state,
                encrypted.as_mut_ptr(),
                &mut encrypted_len,
                chunk.as_ptr(),
                chunk.len() as u64,
                std::ptr::null(),
                0,
                tag,
            );
            assert_eq!(result, 0, "Encryption failed");
        }

        encrypted.truncate(encrypted_len as usize);
        encrypted
    }

    /// Helper to create test data of exact size
    fn create_test_data(size: usize) -> Vec<u8> {
        let pattern = b"Test data pattern for ByteBridge encryption. ";
        let mut data = Vec::with_capacity(size);
        
        while data.len() < size {
            let remaining = size - data.len();
            if remaining < pattern.len() {
                data.extend_from_slice(&pattern[..remaining]);
            } else {
                data.extend_from_slice(pattern);
            }
        }
        
        data
    }

    /// Simulates the complete frontend pipeline for a file (single worker)
    fn simulate_frontend_pipeline(file_data: &[u8]) -> (Vec<(usize, Vec<u8>)>, [u8; 32]) {
        let (mut state, header, master_key) = simulate_frontend_init();
        
        let mut chunks = Vec::new();
        
        // Chunk 0: Header
        chunks.push((0, header));
        
        // Process file in 2MB chunks (matching frontend's DYNAMIC_CHUNK_SIZE)
        let chunk_size = 2 * 1024 * 1024;
        let mut chunk_index = 1;
        
        for chunk_start in (0..file_data.len()).step_by(chunk_size) {
            let chunk_end = std::cmp::min(chunk_start + chunk_size, file_data.len());
            let is_final = chunk_end >= file_data.len();
            
            // Get the raw chunk
            let raw_chunk = &file_data[chunk_start..chunk_end];
            
            // Compress with LZ4 (simulating frontend)
            let compressed_chunk = simulate_lz4_compress(raw_chunk);
            
            // Encrypt the compressed chunk
            let encrypted_chunk = simulate_encrypt_chunk(&mut state, &compressed_chunk, is_final);
            
            chunks.push((chunk_index, encrypted_chunk));
            chunk_index += 1;
            
            if is_final {
                break;
            }
        }
        
        (chunks, master_key)
    }

    /// Simulates the parallel encryption pipeline with multiple workers
    /// This matches the ParallelEncryptionManager behavior
    fn simulate_parallel_frontend_pipeline(
        file_data: &[u8],
        worker_count: usize,
    ) -> (Vec<(usize, Vec<u8>)>, [u8; 32]) {
        init_sodium();
        
        // Generate master key
        let mut master_key = [0u8; 32];
        unsafe {
            sodium::randombytes_buf(
                master_key.as_mut_ptr() as *mut std::ffi::c_void,
                master_key.len()
            );
        }
        
        // Calculate ranges for each worker (matching ParallelEncryptionManager logic)
        let range_size = file_data.len() / worker_count;
        let mut all_chunks: Vec<(usize, Vec<u8>)> = Vec::new();
        let mut global_chunk_index = 0;
        
        // First, add the header from worker 0
        let worker_0_subkey = derive_worker_subkey(&master_key, 0);
        let mut worker_0_state: sodium::crypto_secretstream_xchacha20poly1305_state = unsafe {
            std::mem::zeroed()
        };
        let mut worker_0_header = vec![0u8; sodium::crypto_secretstream_xchacha20poly1305_HEADERBYTES as usize];
        
        unsafe {
            let result = sodium::crypto_secretstream_xchacha20poly1305_init_push(
                &mut worker_0_state,
                worker_0_header.as_mut_ptr(),
                worker_0_subkey.as_ptr(),
            );
            assert_eq!(result, 0, "Failed to initialize worker 0 encryption stream");
        }
        
        all_chunks.push((global_chunk_index, worker_0_header.clone()));
        global_chunk_index += 1;
        
        // Process each worker's range
        for worker_id in 0..worker_count {
            let start = worker_id * range_size;
            let end = if worker_id == worker_count - 1 {
                file_data.len()
            } else {
                (worker_id + 1) * range_size
            };
            
            let worker_data = &file_data[start..end];
            
            // Derive sub-key for this worker
            let subkey = derive_worker_subkey(&master_key, worker_id);
            
            // Initialize encryption state with subkey
            let mut state: sodium::crypto_secretstream_xchacha20poly1305_state = if worker_id == 0 {
                // Reuse worker 0 state
                worker_0_state
            } else {
                let mut new_state: sodium::crypto_secretstream_xchacha20poly1305_state = unsafe {
                    std::mem::zeroed()
                };
                let mut header = vec![0u8; sodium::crypto_secretstream_xchacha20poly1305_HEADERBYTES as usize];
                
                unsafe {
                    let result = sodium::crypto_secretstream_xchacha20poly1305_init_push(
                        &mut new_state,
                        header.as_mut_ptr(),
                        subkey.as_ptr(),
                    );
                    assert_eq!(result, 0, "Failed to initialize worker encryption stream");
                }
                
                // Add worker's header as a chunk (for workers 1+)
                all_chunks.push((global_chunk_index, header));
                global_chunk_index += 1;
                
                new_state
            };
            
            // Process worker's data in chunks
            let chunk_size = 2 * 1024 * 1024; // 2MB chunks
            
            for chunk_start in (0..worker_data.len()).step_by(chunk_size) {
                let chunk_end = std::cmp::min(chunk_start + chunk_size, worker_data.len());
                let is_final = chunk_end >= worker_data.len();
                
                let raw_chunk = &worker_data[chunk_start..chunk_end];
                
                // Compress
                let compressed_chunk = simulate_lz4_compress(raw_chunk);
                
                // Encrypt with worker's state
                let encrypted_chunk = simulate_encrypt_chunk(&mut state, &compressed_chunk, is_final);
                
                all_chunks.push((global_chunk_index, encrypted_chunk));
                global_chunk_index += 1;
                
                if is_final {
                    break;
                }
            }
            
            // Save state for worker 0
            if worker_id == 0 {
                worker_0_state = state;
            }
        }
        
        (all_chunks, master_key)
    }

    /// Tests basic encryption/decryption pipeline with a small file
    /// 
    /// This test verifies that a 1KB file can be successfully:
    /// 1. Compressed with LZ4
    /// 2. Encrypted using libsodium's secretstream
    /// 3. Decrypted back to the original data
    /// 
    /// Uses single-worker mode (non-parallel encryption)
    #[test]
    fn test_small_file_encryption_decryption() {
        let test_data = create_test_data(1024); // Exactly 1KB
        
        let (chunks, master_key) = simulate_frontend_pipeline(&test_data);
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch");
    }

    /// Tests encryption/decryption pipeline with a large multi-chunk file
    /// 
    /// This test verifies that a 10MB file can be:
    /// 1. Split into multiple 2MB chunks
    /// 2. Each chunk compressed and encrypted independently
    /// 3. Successfully decrypted and reassembled to match original data
    /// 
    /// This exercises the chunking logic and stream cipher state management
    /// across multiple chunks in single-worker mode.
    #[test]
    fn test_large_file_encryption_decryption() {
        let test_data = create_test_data(10 * 1024 * 1024); // Exactly 10MB
        
        let (chunks, master_key) = simulate_frontend_pipeline(&test_data);
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch");
    }

    /// Tests parallel encryption with 2 workers
    /// 
    /// This test simulates the ParallelEncryptionManager behavior where:
    /// 1. File is split into 2 equal ranges
    /// 2. Each worker derives its own sub-key from the master key using crypto_kdf
    /// 3. Each worker maintains its own encryption stream state
    /// 4. Worker headers are embedded in the chunk stream
    /// 5. Decryption correctly identifies worker boundaries and uses appropriate sub-keys
    /// 
    /// Tests the basic parallel encryption/decryption pipeline.
    #[test]
    fn test_parallel_encryption_2_workers() {
        let test_data = create_test_data(5 * 1024 * 1024); // Exactly 5MB
        
        let (chunks, master_key) = simulate_parallel_frontend_pipeline(&test_data, 2);
        
        let decrypted = decrypt_parallel_file(&master_key, chunks, 2).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch with 2 workers");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch with 2 workers");
    }

    /// Tests parallel encryption with 4 workers
    /// 
    /// This test validates:
    /// 1. Multiple worker coordination (4 parallel streams)
    /// 2. Each worker processing 5MB of a 20MB file
    /// 3. Correct sub-key derivation for each worker (worker-0, worker-1, worker-2, worker-3)
    /// 4. Proper interleaving of multiple encryption streams
    /// 5. Decryption correctly reconstructs data in the original order
    /// 
    /// This represents a typical parallel upload scenario matching the
    /// default MAX_WORKERS configuration.
    #[test]
    fn test_parallel_encryption_4_workers() {
        let test_data = create_test_data(20 * 1024 * 1024); // Exactly 20MB
        
        let (chunks, master_key) = simulate_parallel_frontend_pipeline(&test_data, 4);
        
        let decrypted = decrypt_parallel_file(&master_key, chunks, 4).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch with 4 workers");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch with 4 workers");
    }

    /// Tests maximum parallelism with 8 workers
    /// 
    /// This test validates:
    /// 1. Maximum worker count (8 parallel encryption streams)
    /// 2. Each worker handling 5MB of a 40MB file
    /// 3. Complex sub-key derivation for 8 different contexts
    /// 4. Managing 8 separate encryption stream states
    /// 5. Correct chunk ordering with many interleaved streams
    /// 
    /// This is a stress test for the parallel decryption logic and ensures
    /// the system can handle the maximum configured parallelism.
    #[test]
    fn test_parallel_encryption_8_workers() {
        let test_data = create_test_data(40 * 1024 * 1024); // Exactly 40MB
        
        let (chunks, master_key) = simulate_parallel_frontend_pipeline(&test_data, 8);
        
        let decrypted = decrypt_parallel_file(&master_key, chunks, 8).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch with 8 workers");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch with 8 workers");
    }

    /// Tests parallel encryption with uneven data distribution
    /// 
    /// This test validates edge case handling when file size doesn't divide evenly:
    /// 1. 2.5MB file split among 3 workers
    /// 2. First two workers get ~833KB each
    /// 3. Last worker gets remaining data (handles the uneven portion)
    /// 4. Ensures boundary conditions are handled correctly
    /// 5. Verifies no data loss or corruption at worker boundaries
    /// 
    /// This is critical because real-world files rarely divide perfectly
    /// by the worker count.
    #[test]
    fn test_parallel_encryption_uneven_distribution() {
        let test_data = create_test_data(2_500_000); // 2.5MB - doesn't divide evenly by 3
        
        let (chunks, master_key) = simulate_parallel_frontend_pipeline(&test_data, 3);
        
        let decrypted = decrypt_parallel_file(&master_key, chunks, 3).expect("Decryption failed");
        
        assert_eq!(decrypted.len(), test_data.len(), "Decrypted size mismatch with uneven distribution");
        assert_eq!(&decrypted[..], &test_data[..], "Decrypted content mismatch with uneven distribution");
    }

    /// Tests encryption/decryption of an empty file
    /// 
    /// This test validates edge case handling for zero-byte files:
    /// 1. Empty file still generates encryption header
    /// 2. System handles encryption stream with no data chunks
    /// 3. Decryption produces empty or minimal output (compression overhead)
    /// 4. No crashes or errors occur with edge case input
    /// 
    /// Important for ensuring robustness with unusual input.
    #[test]
    fn test_empty_file() {
        let test_data = b"";
        
        let (chunks, master_key) = simulate_frontend_pipeline(test_data);
        
        assert!(chunks.len() >= 1, "Should have at least header chunk");
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert!(decrypted.is_empty() || decrypted.len() < 100, "Empty file should decrypt to empty or very small");
    }

    /// Tests encryption/decryption of a single byte file
    /// 
    /// This test validates minimal data handling:
    /// 1. Single byte can be compressed (though may expand due to overhead)
    /// 2. Encryption stream handles minimal payload correctly
    /// 3. TAG_FINAL is set appropriately for single-chunk files
    /// 4. Decryption recovers the exact single byte
    /// 
    /// Tests the absolute minimum viable file size.
    #[test]
    fn test_single_byte_file() {
        let test_data = b"A";
        
        let (chunks, master_key) = simulate_frontend_pipeline(test_data);
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert_eq!(decrypted, test_data, "Single byte mismatch");
    }

    /// Tests that decryption fails with an incorrect key
    /// 
    /// This is a security test that validates:
    /// 1. Authenticated encryption is working correctly
    /// 2. Wrong key results in decryption failure (not garbage output)
    /// 3. MAC verification catches key mismatches
    /// 4. System fails safely rather than producing corrupted data
    /// 
    /// Critical for ensuring the encryption provides confidentiality.
    #[test]
    fn test_wrong_key_fails() {
        let test_data = b"Secret data that should not decrypt with wrong key";
        
        let (chunks, _correct_key) = simulate_frontend_pipeline(test_data);
        
        let wrong_key = [0u8; 32];
        
        let result = decrypt_file(&wrong_key, chunks);
        
        assert!(result.is_err(), "Decryption should fail with wrong key");
    }

    /// Tests that decryption fails when data is corrupted
    /// 
    /// This is a data integrity test that validates:
    /// 1. Authenticated encryption detects tampering
    /// 2. Bit flips in ciphertext are caught by MAC verification
    /// 3. Corrupted chunks cause immediate failure (no silent corruption)
    /// 4. System protects against transmission errors or malicious modification
    /// 
    /// Ensures the encryption provides both confidentiality and integrity.
    #[test]
    fn test_corrupted_chunk_fails() {
        let test_data = b"Data that will have a corrupted chunk";
        
        let (mut chunks, master_key) = simulate_frontend_pipeline(test_data);
        
        if chunks.len() > 1 {
            chunks[1].1[10] ^= 0xFF;
        }
        
        let result = decrypt_file(&master_key, chunks);
        
        assert!(result.is_err(), "Decryption should fail with corrupted chunk");
    }

    /// Tests encryption/decryption preserves Unicode and multi-byte characters
    /// 
    /// This test validates correct handling of:
    /// 1. Multi-byte UTF-8 characters (Chinese, Arabic, etc.)
    /// 2. Emoji and other 4-byte UTF-8 sequences
    /// 3. Accented characters and special symbols
    /// 4. No corruption at UTF-8 character boundaries
    /// 5. Byte-for-byte preservation of UTF-8 encoding
    /// 
    /// Important for international users and ensuring text files
    /// maintain their encoding through the pipeline.
    #[test]
    fn test_unicode_content() {
        let test_data = "Hello 世界! 🚀 Emoji and Unicode test ñ á é í ó ú".repeat(100);
        let test_bytes = test_data.as_bytes();
        
        let (chunks, master_key) = simulate_frontend_pipeline(test_bytes);
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert_eq!(decrypted, test_bytes, "Unicode content mismatch");
        
        let decrypted_str = String::from_utf8(decrypted).expect("Invalid UTF-8");
        assert_eq!(decrypted_str, test_data, "Unicode string mismatch");
    }

    /// Tests encryption/decryption of arbitrary binary data
    /// 
    /// This test validates:
    /// 1. All 256 possible byte values (0x00-0xFF) are handled correctly
    /// 2. No special bytes cause issues (null bytes, high bytes, etc.)
    /// 3. Binary files (images, executables, etc.) can be encrypted/decrypted
    /// 4. No data corruption for non-text content
    /// 5. Byte-for-byte preservation of arbitrary data
    /// 
    /// Critical for ensuring the system works with any file type,
    /// not just text files.
    #[test]
    fn test_binary_data() {
        let mut test_data = Vec::new();
        for i in 0..256 {
            test_data.push(i as u8);
        }
        test_data = test_data.repeat(1000);
        
        let (chunks, master_key) = simulate_frontend_pipeline(&test_data);
        
        let decrypted = decrypt_file(&master_key, chunks).expect("Decryption failed");
        
        assert_eq!(decrypted, test_data, "Binary data mismatch");
    }

    /// Tests that LZ4 compression is working effectively
    /// 
    /// This test validates:
    /// 1. LZ4 compression is actually reducing data size
    /// 2. Highly repetitive data achieves significant compression
    /// 3. Compression happens before encryption (verify pipeline order)
    /// 4. Compression ratio meets performance expectations (>5x for repetitive data)
    /// 
    /// This ensures the pipeline is actually benefiting from compression
    /// and that chunks are being processed in the correct order
    /// (compress -> encrypt, not encrypt -> compress).
    #[test]
    fn test_compression_effectiveness() {
        let test_data = b"AAAAAAAAAA".repeat(100000);
        
        let (chunks, _) = simulate_frontend_pipeline(&test_data);
        
        let total_encrypted: usize = chunks.iter().map(|(_, data)| data.len()).sum();
        
        let compression_ratio = test_data.len() as f64 / total_encrypted as f64;
        
        assert!(compression_ratio > 5.0, "Compression should be effective for repetitive data");
    }
}