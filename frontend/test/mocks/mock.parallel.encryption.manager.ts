/**
 * Mock implementation of the parallel encryption manager for testing
 */

/**
 * Represents a single producer worker and its assigned range.
 */
interface ProducerWorker {
  worker: any;
  range: { start: number; end: number };
  id: number;
  isReady: boolean;
  uploadId: string | null;
  header?: Uint8Array;
  subKey?: Uint8Array;
  lastReportedBytes?: number;
}

/**
 * Configuration options for the parallel encryption manager.
 */
interface ParallelEncryptionConfig {
  compressionLevel: number;
  keyFingerprint: string;
  masterKey: Uint8Array;
  useWebTransport: boolean;
  workerCount?: number;
}

/**
 * Mock implementation of ParallelEncryptionManager for testing
 */
export class ParallelEncryptionManager {
  private producers: ProducerWorker[] = [];
  private masterKey: Uint8Array;
  private keyFingerprint: string;
  private useWebTransport: boolean;
  private compressionLevel: number;
  private totalChunks = 0;
  private completedChunks = 0;
  private aborted = false;
  private uploadId: string | null = null;
  private progressCallback?: (progress: { processedBytes: number; totalBytes: number; }) => void;
  
  /**
   * Creates a new parallel encryption manager.
   * 
   * @param {ParallelEncryptionConfig} config Configuration options
   */
  constructor(config: ParallelEncryptionConfig) {
    this.masterKey = config.masterKey;
    this.keyFingerprint = config.keyFingerprint;
    this.useWebTransport = config.useWebTransport;
    this.compressionLevel = config.compressionLevel;
    const workerCount = config.workerCount || 4;
    this.producers = Array(workerCount).fill(null);
    console.debug(`[Parallel Encryption] Initializing with ${workerCount} producer workers`);
  }

  /**
   * Initializes the producer workers and prepares them for a file upload.
   */
  async initialize(): Promise<void> {
    // Create and initialize workers with mock implementations
    for (let i = 0; i < this.producers.length; i++) {
      await this.initializeWorker(i);
    }
    console.debug(`[Parallel Encryption] All ${this.producers.length} workers initialized`);
  }
  
  /**
   * Initializes a single worker with its configuration.
   */
  private async initializeWorker(index: number): Promise<void> {
    // Create a mock worker object
    const worker = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    };
    
    const producerInfo: ProducerWorker = {
      worker,
      range: { start: 0, end: 0 },
      id: index,
      isReady: true,
      uploadId: null,
      // Generate deterministic mock values for testing
      header: new Uint8Array([0, 1, 2, 3, 4]),
      // Each worker gets a unique subkey
      subKey: new Uint8Array(32).fill(index + 1)
    };
    
    this.producers[index] = producerInfo;
    return Promise.resolve();
  }
  
  /**
   * Starts uploading a file using all producer workers in parallel.
   * 
   * @param {File} file The file to upload
   * @param {string} uploadId Unique ID for this upload session
   * @param {function} progressCallback Optional callback for progress updates
   * @returns {Promise<void>} Resolves when upload is complete
   */
  async startUpload(
    file: File, 
    uploadId: string, 
    progressCallback?: (progress: { processedBytes: number; totalBytes: number; }) => void
  ): Promise<void> {
    this.uploadId = uploadId;
    this.progressCallback = progressCallback;
    this.totalChunks = 0;
    this.completedChunks = 0;
    this.aborted = false;
    
    // Calculate ranges for each worker
    const workerCount = this.producers.length;
    const rangeSize = Math.floor(file.size / workerCount);
    let bytesAssigned = 0;
    
    // Assign ranges
    for (let i = 0; i < workerCount; i++) {
      const start = bytesAssigned;
      let end = start + rangeSize;
      // Last worker gets any remaining bytes
      if (i === workerCount - 1) {
        end = file.size;
      }
      this.producers[i].range = { start, end };
      this.producers[i].uploadId = uploadId;
      bytesAssigned = end;
    }
    
    // Report progress
    if (this.progressCallback) {
      this.progressCallback({
        processedBytes: file.size, // Report complete immediately for tests
        totalBytes: file.size
      });
    }
    
    // In tests, we just resolve immediately
    return Promise.resolve();
  }
  
  /**
   * Aborts all worker uploads and cleans up resources.
   */
  async abort(): Promise<void> {
    this.aborted = true;
    for (const producer of this.producers) {
      producer.worker.terminated = true;
    }
    await this.cleanup();
  }
  
  /**
   * Cleans up resources when uploads are complete or aborted.
   */
  private async cleanup(): Promise<void> {
    this.producers = [];
    return Promise.resolve();
  }
}
