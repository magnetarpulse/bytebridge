/**
 * Mock implementation of ParallelEncryptionManager for testing
 * This avoids all the Web Worker initialization issues that are causing test failures
 */
export class MockParallelEncryptionManager {
  producers = [];
  activeUploads = new Map();
  uploadProgress = new Map();
  progressCallbacks = [];
  
  constructor(config) {
    console.log('Creating MockParallelEncryptionManager with config:', config);
    this.config = config;
    
    // Create mock producers based on worker count
    const workerCount = config.workerCount || 4;
    for (let i = 0; i < workerCount; i++) {
      // Create a mock producer with a derived key
      const encryptionKey = this._deriveSubKey(config.masterKey, `${config.keyFingerprint}-worker-${i}`);
      this.producers.push({
        id: `producer-${i}`,
        active: false,
        range: { start: 0, end: 0 }, // Will be set during upload
        encryptionKey
      });
    }
    
    console.log(`Created ${this.producers.length} mock producers`);
    
    // Expose the mock instance for debugging
    if (typeof window !== 'undefined') {
      window.mockManager = this;
    }
  }
  
  /**
   * Simple mock implementation to derive different keys for each worker
   */
  _deriveSubKey(masterKey, salt) {
    // For testing, we just need different keys for each worker
    // Real implementation would use proper key derivation
    const result = new Uint8Array(masterKey.length);
    for (let i = 0; i < masterKey.length; i++) {
      // Mix the salt into the key - just for testing purposes
      result[i] = masterKey[i] ^ (salt.charCodeAt(i % salt.length) & 0xFF);
    }
    return result;
  }
  
  /**
   * Initialize the manager - mock implementation
   */
  async initialize() {
    console.log('Initializing MockParallelEncryptionManager');
    // Nothing to initialize in the mock version
    return true;
  }
  
  /**
   * Register a progress callback
   */
  onProgress(callback) {
    this.progressCallbacks.push(callback);
  }
  
  /**
   * Start an upload
   */
  async startUpload(file, uploadName) {
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`Starting mock upload ${uploadId} for file ${file.name || 'unnamed'} (${file.size} bytes)`);
    
    // Make sure we assign ranges properly for the property tests
    // Each producer gets a contiguous chunk of the file with no overlaps or gaps
    
    // Reset all producers first
    for (const producer of this.producers) {
      producer.range = { start: 0, end: 0 };
      producer.active = false;
    }
    
    // Handle special case for empty file
    if (file.size === 0) {
      console.log('Empty file, setting all producers to inactive');
      // Already done in reset above
    } else {
      // Calculate chunk size - divide file evenly among producers
      const fileSize = file.size;
      const producerCount = this.producers.length;
      const baseChunkSize = Math.floor(fileSize / producerCount);
      let remainder = fileSize % producerCount;
      
      let position = 0;
      
      console.log(`Assigning ranges for file size ${fileSize} to ${producerCount} producers`);
      console.log(`Base chunk size: ${baseChunkSize}, remainder: ${remainder}`);
      
      // Assign ranges to producers
      for (let i = 0; i < producerCount; i++) {
        const producer = this.producers[i];
        const start = position;
        // Give one extra byte to some producers if file size doesn't divide evenly
        const extraByte = remainder > 0 ? 1 : 0;
        if (extraByte) remainder--;
        
        const chunkSize = baseChunkSize + extraByte;
        const end = start + chunkSize;
        
        producer.range = { start, end };
        producer.active = true;
        position = end;
        
        console.log(`Producer ${i}: range ${start}-${end} (${end-start} bytes)`);
      }
      
      // Verify that we've assigned the entire file
      if (position !== file.size) {
        console.error(`Range assignment error: assigned ${position} bytes but file size is ${file.size}`);
      } else {
        console.log(`Successfully assigned all ${fileSize} bytes`);
      }
    }
    
    // For debugging in browser console
    if (typeof window !== 'undefined') {
      window.mockManagerRanges = this.producers.map(p => ({ start: p.range.start, end: p.range.end }));
    }
    
    this.activeUploads.set(uploadId, {
      file,
      name: uploadName,
      progress: 0,
      completed: false
    });
    
    this.uploadProgress.set(uploadId, 0);
    
    // Simulate immediate progress and completion for tests
    this._simulateProgress(uploadId, 100);
    
    return uploadId;
  }
  
  /**
   * Abort an upload
   */
  async abortUpload(uploadId) {
    console.log(`Aborting mock upload ${uploadId}`);
    if (this.activeUploads.has(uploadId)) {
      this.activeUploads.delete(uploadId);
      this.uploadProgress.delete(uploadId);
      
      // Mark all producers as inactive
      for (const producer of this.producers) {
        producer.active = false;
      }
    }
  }
  
  /**
   * Simulate progress updates
   */
  _simulateProgress(uploadId, progressPercent) {
    const normalizedProgress = progressPercent / 100;
    this.uploadProgress.set(uploadId, normalizedProgress);
    
    // Notify listeners
    for (const callback of this.progressCallbacks) {
      try {
        callback(normalizedProgress);
      } catch (e) {
        console.error('Error in progress callback:', e);
      }
    }
    
    if (progressPercent >= 100) {
      const upload = this.activeUploads.get(uploadId);
      if (upload) {
        upload.completed = true;
      }
    }
  }
}
