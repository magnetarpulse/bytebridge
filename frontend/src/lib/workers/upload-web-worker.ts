import { initializeSodium } from '../encryption/sodiumEncryption.ts';
import sodium from 'libsodium-wrappers';
import { GrowingBuffer } from '../functions/growingBuffer.ts';
import { validateConfig, ConfigValidationError } from '../utils/configValidator.ts';
import { MetricsCollector } from '../metrics/index.ts';
import { Logger, LogLevel } from '../logger/logger.ts';
import type { LZ4Module } from '../../types/lz4';

/**
 * Configuration for the worker and upload sessions
 */
export interface WorkerConfig {
  useWebTransport: boolean;
  maxConcurrentUploads: number;
  chunkSize: {
    min: number;
    max: number;
    initial: number;
  };
  uploadTimeout?: number; 
  promiseStaleTimeout?: number;
  retryConfig: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
  };
  backpressure: {
    threshold: number;
    delayMultiplier: number;
  };
  adaptiveChunkSizing: {
    enabled: boolean;
    historySize: number;
    increaseThreshold: number;
    decreaseThreshold: number;
    adjustmentFactor: number;
  };
  batchNotification: {
    timeoutMs: number;
    minChunksForFlush: number;
    largeChunkThreshold: number;
  };
  enableDetailedLogging: boolean;
  logLevel: LogLevel;
}

const DEFAULT_CONFIG: WorkerConfig = {
  useWebTransport: true,
  maxConcurrentUploads: 4,
  chunkSize: {
    min: 1 * 1024 * 1024,
    max: 8 * 1024 * 1024,
    initial: 2 * 1024 * 1024,
  },
  uploadTimeout: 120_000,
  promiseStaleTimeout: 300_000,
  retryConfig: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
  },
  backpressure: {
    threshold: 5,
    delayMultiplier: 100,
  },
  adaptiveChunkSizing: {
    enabled: true,
    historySize: 5,              
    increaseThreshold: 1.3,      
    decreaseThreshold: 0.7, 
    adjustmentFactor: 1.5,
  },
  batchNotification: {
    timeoutMs: 5,
    minChunksForFlush: 10,
    largeChunkThreshold: 100 * 1024,
  },
  enableDetailedLogging: false,
  logLevel: LogLevel.INFO,
};

/**
 * Metadata prepended to each encrypted chunk
 * Format: [4 bytes workerId (big-endian)][4 bytes chunkIndex (big-endian)]
 */
const CHUNK_METADATA_SIZE = 8;

/**
 * Generate HMAC-based authentication proof for PSK authentication
 * Proves possession of encryption key for specific uploadId
 */
function generateAuthProof(uploadId: string, encryptionKey: Uint8Array): Uint8Array {
  // HMAC-BLAKE2b: crypto_auth(message=uploadId, key=encryptionKey)
  const message = new TextEncoder().encode(uploadId);
  const proof = sodium.crypto_auth(message, encryptionKey);
  return proof; // 32 bytes
}

/**
 * Encapsulates all state for a single upload session
 * Uses stateless encryption, which means each chunk is 
 * independently encrypted.
 */
class UploadSession {
  private readonly encryptionKey: Uint8Array;
  private readonly uploadMetadata: Uint8Array;
  private readonly authProof: Uint8Array;
  private chunkBuffer: Map<number, Uint8Array>;
  private chunkPromises: Map<number, { resolve: () => void; reject: (error: Error) => void }>;
  private consumerWorker: Worker | null = null;
  private pendingNotifications: Array<{
    chunkIndex: number;
    uploadId: string;
    encryptionSequence: number;
    workerId: number;
  }> = [];
  private batchTimeout: number | null = null;
  private performanceHistory: number[] = [];
  private currentChunkSize: number;
  private metrics: MetricsCollector;
  private logger: Logger;
  
  private failedChunks = new Map<number, { attempts: number; lastError: Error; chunk: Uint8Array }>();
  private cancelled: boolean = false;
  private lastProgressUpdate: number = 0;
  private startTime: number = Date.now();
  private progressThrottleMs: number = 100;
  private completedChunks: Set<number> = new Set();
  private readonly shouldCompressFile: boolean;

  constructor(
    public readonly uploadId: string,
    public readonly workerId: number,
    encryptionKey: Uint8Array,
    private readonly config: WorkerConfig,
    private readonly lz4: LZ4Module | null,
    totalBytes: number = 0,
    completedChunks: number[] = [],
    fileName: string = '' 
  ) {
    if (!Number.isInteger(workerId) || workerId < 0) {
      throw new Error(`Invalid workerId: ${workerId} (must be non-negative integer)`);
    }
    this.encryptionKey = encryptionKey;
    this.completedChunks = new Set(completedChunks);
    // Generate authentication proof for PSK authentication
    this.authProof = generateAuthProof(uploadId, encryptionKey);
    this.shouldCompressFile = this.shouldCompress(fileName);

    // Create upload metadata (chunk 0)
    const metadata = {
      version: 1, 
      algorithm: 'XChaCha20-Poly1305-IETF',
      fileName: fileName,
      originalSize: totalBytes,
      compressionEnabled: this.shouldCompressFile,
      timestamp: Date.now(),
    };
    this.uploadMetadata = new TextEncoder().encode(JSON.stringify(metadata));
    
    this.chunkBuffer = new Map();
    this.chunkPromises = new Map();
    this.currentChunkSize = config.chunkSize.initial;
    this.metrics = new MetricsCollector(uploadId, totalBytes);
    this.logger = new Logger(
      `Worker-${workerId}`,
      config.enableDetailedLogging ? LogLevel.DEBUG : config.logLevel
    );
    
    this.logger.info('Session initialized', {
      version: 1,
      workerId: this.workerId,
      resumingWithChunks: this.completedChunks.size,
      compressionEnabled: this.shouldCompressFile,
    });
  }
  
  /**
   * Returns the upload metadata (must be sent as chunk 0)
   * This is NOT encrypted, it's needed by the server to identify the upload
   */
  getHeader(): Uint8Array {
    return this.uploadMetadata;
  }
  
  /**
   * Get authentication proof for this upload
   */
  getAuthProof(): Uint8Array {
    return this.authProof;
  }
  
  /**
   * Check if a chunk has already been completed
   */
  isChunkCompleted(chunkIndex: number): boolean {
    return this.completedChunks.has(chunkIndex);
  }
  
  /**
   * Mark a chunk as completed
   */
  markChunkCompleted(chunkIndex: number): void {
    this.completedChunks.add(chunkIndex);
  }
  
  /**
   * Derives a unique, deterministic nonce for each chunk
   * Security: Combines uploadId (unique per upload) with chunkIndex (unique per chunk)
   */
  private deriveNonce(chunkIndex: number): Uint8Array {
    const nonce = new Uint8Array(24); // XChaCha20-Poly1305 requires 192-bit nonce
    
    // Use BLAKE2b to hash uploadId + chunkIndex
    const input = new TextEncoder().encode(`${this.uploadId}:${chunkIndex}`);
    const hash = sodium.crypto_generichash(24, input);
    nonce.set(hash);
    
    return nonce;
  }
  
  /**
   * Encrypts a chunk using stateless AEAD
   * Each chunk is independently encrypted with a unique nonce
   * 
   * Format: [24 bytes nonce][4 bytes workerId + 4 bytes chunkIndex][N bytes ciphertext + 16 bytes MAC]
   */
  encryptChunk(chunk: Uint8Array, chunkIndex: number): Uint8Array {
    const nonce = this.deriveNonce(chunkIndex);
    
    // Prepend metadata for server validation: [4 bytes workerId][4 bytes chunkIndex]
    const metadata = new Uint8Array(CHUNK_METADATA_SIZE);
    const view = new DataView(metadata.buffer);
    view.setUint32(0, this.workerId, false); // Big-endian worker ID
    view.setUint32(4, chunkIndex, false);    // Big-endian chunk index
    
    // Concatenate: metadata || chunk
    const plaintext = new Uint8Array(metadata.length + chunk.length);
    plaintext.set(metadata);
    plaintext.set(chunk, metadata.length);
    
    // Encrypt with authenticated encryption
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      null, // No additional data
      null, // Secret nonce (unused, we derive deterministically)
      nonce,
      this.encryptionKey
    );
    
    // Return: nonce || ciphertext (nonce needed for decryption)
    const encrypted = new Uint8Array(nonce.length + ciphertext.length);
    encrypted.set(nonce);
    encrypted.set(ciphertext, nonce.length);
    
    return encrypted;
  }

  /**
   * Determines if a file should be compressed based on its extension/type
   */
  private shouldCompress(fileName: string): boolean {
    // Early exit for empty filename
    if (!fileName) return true;
    
    const noCompressExtensions = [
      '.zip', '.ipa', '.apk', '.7z', '.rar',     // Archives
      '.jpg', '.jpeg', '.png', '.gif', '.webp',  // Images
      '.mp4', '.mov', '.avi', '.mkv',            // Videos
      '.mp3', '.m4a', '.aac', '.flac',           // Audio
      '.pdf', '.docx', '.xlsx',                  // Documents
    ];
    
    const lowerName = fileName.toLowerCase();
    return !noCompressExtensions.some(ext => lowerName.endsWith(ext));
  }
  
  /**
   * Compresses a chunk using LZ4 (only if beneficial)
   */
  compressChunk(chunk: Uint8Array): Uint8Array {
    if (!this.lz4) {
      throw new Error('LZ4 module not available');
    }
    
    if (!this.shouldCompressFile) {
      this.metrics.recordChunkProcessed(chunk.length, chunk.length);
      return chunk;  // Return uncompressed
    }
    
    const compressed = this.lz4.compress(chunk);
    
    // Only use compressed version if it's actually smaller
    if (compressed.length < chunk.length) {
      this.metrics.recordChunkProcessed(chunk.length, compressed.length);
      return compressed;
    } else {
      // Compression made it bigger, return original
      this.metrics.recordChunkProcessed(chunk.length, chunk.length);
      return chunk;
    }
  }
  
  /**
   * Sends chunk back to main thread for upload via manager
   */
  async addChunk(chunk: Uint8Array, chunkIndex: number): Promise<void> {
    // Check if chunk is already completed (for resume support)
    if (this.isChunkCompleted(chunkIndex)) {
      return Promise.resolve();
    }

    if (this.config.useWebTransport) {
      return this.addChunkForWebTransport(chunk, chunkIndex);
    } else {
      // Send chunk to main thread for HTTP upload via manager
      return new Promise<void>((resolve, reject) => {
        this.chunkPromises.set(chunkIndex, { resolve, reject });
        
        self.postMessage({
          type: 'chunk-ready',
          payload: {
            chunk,
            chunkIndex,
            uploadId: this.uploadId,
            workerId: this.workerId,
          }
        }, { transfer: [chunk.buffer] });
      });
    }
  }
  
  async addChunkWithRetry(
    chunk: Uint8Array,
    chunkIndex: number
  ): Promise<void> {
    if (this.cancelled) {
      throw new Error('Upload cancelled');
    }

    const maxAttempts = this.config.retryConfig.maxRetries + 1;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.addChunk(chunk, chunkIndex);
        
        if (this.failedChunks.has(chunkIndex)) {
          this.logger.info(`Chunk ${chunkIndex} recovered after ${attempt} attempts`);
          this.failedChunks.delete(chunkIndex);
        }
        
        this.markChunkCompleted(chunkIndex);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (this.cancelled) {
          throw new Error('Upload cancelled');
        }
        
        this.logger.warn(
          `Chunk ${chunkIndex} upload attempt ${attempt}/${maxAttempts} failed`,
          { error: lastError.message }
        );
        
        if (attempt < maxAttempts) {
          const delay = Math.min(
            this.config.retryConfig.baseDelay * (2 ** (attempt - 1)) + Math.random() * 1000,
            this.config.retryConfig.maxDelay
          );
          
          this.logger.info(`Retrying chunk ${chunkIndex} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.failedChunks.set(chunkIndex, {
      attempts: maxAttempts,
      lastError: lastError!,
      chunk: chunk,
    });
    
    this.metrics.recordChunkFailed(lastError!.message);
    
    throw new Error(
      `Chunk ${chunkIndex} failed after ${maxAttempts} attempts: ${lastError!.message}`
    );
  }

  getFailedChunks(): Map<number, { attempts: number; lastError: Error; chunk: Uint8Array }> {
    return new Map(this.failedChunks);
  }
  
  hasFailures(): boolean {
    return this.failedChunks.size > 0;
  }

  private async addChunkForWebTransport(
    chunk: Uint8Array,
    chunkIndex: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.chunkPromises.set(chunkIndex, { resolve, reject });
      
      // Only add to buffer if not already present (prevents duplicates on retry)
      if (!this.chunkBuffer.has(chunkIndex)) {
        this.chunkBuffer.set(chunkIndex, chunk);
      }
      
      this.pendingNotifications.push({
        chunkIndex,
        uploadId: this.uploadId,
        encryptionSequence: chunkIndex,
        workerId: this.workerId,
      });
      
      const shouldFlushImmediately = 
        chunk.length > this.config.batchNotification.largeChunkThreshold ||
        this.pendingNotifications.length >= this.config.batchNotification.minChunksForFlush;
      
      if (shouldFlushImmediately) {
        this.flushChunkNotifications();
      } else if (this.batchTimeout === null) {
        this.batchTimeout = self.setTimeout(() => {
          this.flushChunkNotifications();
        }, this.config.batchNotification.timeoutMs);
      }
    });
  }
  
  private flushChunkNotifications(): void {
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    if (this.pendingNotifications.length === 0 || !this.consumerWorker) {
      return;
    }
    
    if (this.pendingNotifications.length === 1) {
      const notification = this.pendingNotifications[0];
      this.consumerWorker.postMessage({
        type: 'chunk-ready',
        payload: notification,
      });
    } else {
      this.consumerWorker.postMessage({
        type: 'chunks-ready-batch',
        payload: { chunks: this.pendingNotifications },
      });
    }
    
    this.pendingNotifications = [];
  }
  
  trackPerformance(chunkSize: number, duration: number): void {
    const throughput = chunkSize / duration;
    this.metrics.recordChunkUploaded(throughput);
    
    if (!this.config.adaptiveChunkSizing.enabled || duration === 0) {
      return;
    }
    
    this.performanceHistory.push(throughput);
    
    if (this.performanceHistory.length > this.config.adaptiveChunkSizing.historySize) {
      this.performanceHistory = this.performanceHistory.slice(
        -this.config.adaptiveChunkSizing.historySize
      );
    }
    
    const previousSize = this.currentChunkSize;
    this.adjustChunkSize();
    if (previousSize !== this.currentChunkSize) {
      this.metrics.recordChunkSizeAdjustment();
    }
  }
  
  /**
   * Math.floor is ~3-5x slower than bitwise operations for positive numbers
   */
  private adjustChunkSize(): void {
    if (this.performanceHistory.length < 3) return;
    
    const avg = this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length;
    const recent = this.performanceHistory[this.performanceHistory.length - 1];
    
    const { increaseThreshold, decreaseThreshold, adjustmentFactor } = 
      this.config.adaptiveChunkSizing;
    const { min, max } = this.config.chunkSize;
    
    if (recent > avg * increaseThreshold && this.currentChunkSize < max) {
      const previousSize = this.currentChunkSize;
      this.currentChunkSize = Math.min(this.currentChunkSize * adjustmentFactor, max) | 0;
      this.logger.info(
        `Increased chunk size to ${(this.currentChunkSize / 1024 / 1024).toFixed(2)}MB`,
        { previous: previousSize, current: this.currentChunkSize }
      );
    } else if (recent < avg * decreaseThreshold && this.currentChunkSize > min) {
      const previousSize = this.currentChunkSize;
      this.currentChunkSize = Math.max(this.currentChunkSize / adjustmentFactor, min) | 0;
      this.logger.info(
        `Decreased chunk size to ${(this.currentChunkSize / 1024 / 1024).toFixed(2)}MB`,
        { previous: previousSize, current: this.currentChunkSize }
      );
    }
  }
  
  getCurrentChunkSize(): number {
    return this.currentChunkSize;
  }
  
  shouldApplyBackpressure(): boolean {
    return this.chunkBuffer.size > this.config.backpressure.threshold;
  }
  
  async waitForBackpressure(): Promise<void> {
    this.metrics.recordBackpressure();
    const queuedChunks = this.chunkBuffer.size;
    const delay = this.config.backpressure.delayMultiplier * queuedChunks;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  /**
   * Handle chunk upload completion from main thread
   */
  handleChunkComplete(chunkIndex: number): void {
    const handlers = this.chunkPromises.get(chunkIndex);
    if (handlers) {
      handlers.resolve();
      this.chunkPromises.delete(chunkIndex);
      this.markChunkCompleted(chunkIndex);
    }
  }
  
  /**
   * Handle chunk upload error from main thread
   */
  handleChunkError(chunkIndex: number, error: string): void {
    const handlers = this.chunkPromises.get(chunkIndex);
    if (handlers) {
      handlers.reject(new Error(error));
      this.chunkPromises.delete(chunkIndex);
    }
  }
  
  cancel(reason?: string): void {
    if (this.cancelled) return;
    
    this.cancelled = true;
    this.logger.info(`Session cancelled`, { reason: reason || 'User requested' });
    
    for (const [chunkIndex, handlers] of this.chunkPromises) {
      handlers.reject(new Error(`Upload cancelled: ${reason || 'User requested'}`));
    }
    this.chunkPromises.clear();
  }
  
  isCancelled(): boolean {
    return this.cancelled;
  }
  
  shouldReportProgress(): boolean {
    const now = Date.now();
    if (now - this.lastProgressUpdate >= this.progressThrottleMs) {
      this.lastProgressUpdate = now;
      return true;
    }
    return false;
  }
  
  calculateETA(processedBytes: number, totalBytes: number): number | null {
    if (processedBytes === 0) return null;
    
    const elapsed = Date.now() - this.startTime;
    const bytesPerMs = processedBytes / elapsed;
    const remainingBytes = totalBytes - processedBytes;
    
    return Math.round(remainingBytes / bytesPerMs);
  }
  
  async initializeConsumerWorker(): Promise<void> {
    if (!this.config.useWebTransport) {
      throw new Error('WebTransport not enabled');
    }
    
    try {
      this.consumerWorker = new Worker(
        new URL('./upload-webtransport.ts', import.meta.url),
        { type: 'module' }
      );
      
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.consumerWorker?.terminate();
          reject(new Error('Consumer worker init timeout'));
        }, 5000);
        
        const messageHandler = (event: MessageEvent) => {
          const { type } = event.data;
          if (type === 'consumer-ready') {
            clearTimeout(timeoutId);
            this.consumerWorker?.removeEventListener('message', messageHandler);
            resolve();
          } else if (type === 'consumer-error') {
            clearTimeout(timeoutId);
            this.consumerWorker?.removeEventListener('message', messageHandler);
            this.consumerWorker?.terminate();
            reject(new Error(`Consumer init error: ${event.data.payload}`));
          }
        };
        
        this.consumerWorker?.addEventListener('message', messageHandler);
        this.consumerWorker?.postMessage({
          type: 'consumer-init',
          payload: { 
            uploadId: this.uploadId,
            authProof: Array.from(this.authProof),
          },
        });
      });
      
      this.consumerWorker.onmessage = this.handleConsumerMessage.bind(this);
      this.logger.info('WebTransport consumer initialized');
    } catch (error) {
      // Clean up failed worker
      if (this.consumerWorker) {
        this.consumerWorker.terminate();
        this.consumerWorker = null;
      }
      
      // Re-throw error instead of falling back to HTTP
      throw new Error(`WebTransport initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private handleConsumerMessage(event: MessageEvent): void {
    const { type, payload } = event.data;
    
    if (type === 'pull-chunk') {
      const { chunkIndex } = payload;
      const chunk = this.chunkBuffer.get(chunkIndex);
      
      if (chunk) {
        // Check if buffer is already detached (safety check)
        if (chunk.buffer.byteLength === 0) {
          this.logger.error(`Chunk ${chunkIndex} buffer is detached, cannot send`);
          const handlers = this.chunkPromises.get(chunkIndex);
          if (handlers) {
            handlers.reject(new Error(`Chunk ${chunkIndex} buffer detached`));
            this.chunkPromises.delete(chunkIndex);
          }
          return;
        }
        
        // Transfer optimization based on chunk size
        const TRANSFER_THRESHOLD = 512 * 1024; // 512KB
        
        if (chunk.byteLength > TRANSFER_THRESHOLD) {
          // Large chunks: Create independent copy with separate ArrayBuffer
          const newBuffer = new ArrayBuffer(chunk.byteLength);
          const chunkCopy = new Uint8Array(newBuffer);
          chunkCopy.set(chunk);  // Actually copy bytes into new buffer
          
          this.consumerWorker?.postMessage(
            {
              type: 'chunk-data',
              payload: { chunk: chunkCopy, chunkIndex, uploadId: this.uploadId },
            },
            [newBuffer]  // Transfer the new buffer (original stays valid)
          );
        } else {
          // Small chunks: Use structured clone (no transfer)
          this.consumerWorker?.postMessage({
            type: 'chunk-data',
            payload: { chunk, chunkIndex, uploadId: this.uploadId },
          });
        }
      } else {
        // Chunk not in buffer, most likely already cleaned up after success
        this.logger.error(`Chunk ${chunkIndex} not found in buffer`);
        const handlers = this.chunkPromises.get(chunkIndex);
        if (handlers) {
          handlers.reject(new Error(`Chunk ${chunkIndex} not found in buffer`));
          this.chunkPromises.delete(chunkIndex);
        }
      }
    } else if (type === 'chunk-upload-complete') {
      const { chunkIndex } = payload;
      
      // Delete chunk from buffer ONLY after confirmed upload
      this.chunkBuffer.delete(chunkIndex);
      this.handleChunkComplete(chunkIndex);
      
      this.logger.info(`Chunk ${chunkIndex} confirmed uploaded, removed from buffer`, {
        bufferSize: this.chunkBuffer.size,
        pendingPromises: this.chunkPromises.size
      });
    } else if (type === 'chunks-upload-complete-batch') {
      const { chunkIndices } = payload;
      
      // Delete chunks from buffer ONLY after confirmed upload
      for (const chunkIndex of chunkIndices) {
        this.chunkBuffer.delete(chunkIndex);
        this.handleChunkComplete(chunkIndex);
      }
      
      this.logger.info(`Batch of ${chunkIndices.length} chunks confirmed uploaded`, {
        bufferSize: this.chunkBuffer.size,
        pendingPromises: this.chunkPromises.size
      });
    } else if (type === 'chunk-upload-error') {
      const { chunkIndex, error } = payload;
      
      // Chunk stays in buffer for retry
      this.logger.warn(`Chunk ${chunkIndex} upload failed, keeping in buffer for retry`, {
        error,
        bufferHasChunk: this.chunkBuffer.has(chunkIndex),
        bufferSize: this.chunkBuffer.size
      });
      
      this.handleChunkError(chunkIndex, error);
    }
  }
  
  async cleanup(): Promise<void> {
    const finalMetrics = await this.metrics.complete();
    
    self.postMessage({
      type: 'upload-metrics',
      payload: finalMetrics,
    });
    
    this.logger.info('Session cleanup complete', {
      chunksProcessed: finalMetrics.chunksProcessed,
      compressionRatio: (finalMetrics.compressionRatio * 100).toFixed(1) + '%',
      avgThroughput: (finalMetrics.avgThroughput / 1024 / 1024).toFixed(2) + 'MB/s',
    });
    
    this.flushChunkNotifications();
    
    if (this.consumerWorker) {
      this.consumerWorker.terminate();
      this.consumerWorker = null;
    }
    
    this.chunkBuffer.clear();
    this.chunkPromises.clear();
    this.pendingNotifications = [];
    
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }
  
  getMetrics() {
    return this.metrics.getSnapshot();
  }
}

class UploadSessionManager {
  private sessions: Map<string, UploadSession> = new Map();
  
  constructor(
    private readonly config: WorkerConfig,
    private readonly lz4: LZ4Module | null
  ) {}
  
  async createSession(
    uploadId: string,
    workerId: number,
    keyFingerprint: string,
    totalBytes: number,
    subKey?: Uint8Array,
    completedChunks: number[] = [],
    fileName: string = '' 
  ): Promise<UploadSession> {
    if (this.sessions.has(uploadId)) {
      throw new Error(`Session ${uploadId} already exists`);
    }
    
    let encryptionKey: Uint8Array;
    
    if (subKey) {
      encryptionKey = subKey;
    } else {
      // Derive key from fingerprint (fallback, the manager should provide subKey)
      const keyData = new TextEncoder().encode(keyFingerprint);
      encryptionKey = sodium.crypto_generichash(32, keyData);
    }
    
    const session = new UploadSession(
      uploadId,
      workerId,
      encryptionKey,
      this.config,
      this.lz4,
      totalBytes,
      completedChunks,
      fileName
    );
    
    if (this.config.useWebTransport) {
      await session.initializeConsumerWorker();
    }
    
    this.sessions.set(uploadId, session);
    return session;
  }
  
  getSession(uploadId: string): UploadSession | undefined {
    return this.sessions.get(uploadId);
  }
  
  async removeSession(uploadId: string): Promise<void> {
    const session = this.sessions.get(uploadId);
    if (session) {
      await session.cleanup();
      this.sessions.delete(uploadId);
    }
  }
  
  async cleanupAll(): Promise<void> {
    for (const [, session] of this.sessions) {
      await session.cleanup();
    }
    this.sessions.clear();
  }
}

let sessionManager: UploadSessionManager | null = null;
let lz4Module: LZ4Module | null = null;
const logger = new Logger('Setup', LogLevel.INFO);

async function setupWorker(): Promise<void> {
  try {
    await initializeSodium();
    
    try {
      const module = await import('../../pkg/lz4_wasm_nodejs.js');
      await module.default();
      lz4Module = module;
    } catch (error) {
      logger.warn('[Worker] Failed to load LZ4:', error);
    }
    
    self.onmessage = async (event) => {
      const { type, payload } = event.data;
      
      try {
        if (type === 'init') {
          const userConfig = payload.config || {};
          const config = { ...DEFAULT_CONFIG, ...userConfig };
          
          try {
            validateConfig(config);
          } catch (error) {
            if (error instanceof ConfigValidationError) {
              self.postMessage({
                type: 'error',
                payload: `Invalid configuration: ${error.message}`
              });
              return;
            }
            throw error;
          }
          
          sessionManager = new UploadSessionManager(config, lz4Module);
          
          self.postMessage({
            type: 'init-success',
            payload: {
              config,
              capabilities: {
                webTransportSupported: typeof WebTransport !== 'undefined',
                lz4Available: !!lz4Module,
                encryptionVersion: 2, // Stateless encryption
              },
            },
          });
        } else if (type === 'start-streaming-upload') {
          if (!sessionManager) {
            throw new Error('Worker not initialized');
          }
          
          const { file, uploadId, workerId, subKey, keyFingerprint, completedChunks, fileName } = payload;
          
          // Use explicit fileName from payload, fallback to file.name
          const actualFileName = fileName || file?.name || '';
          
          const session = await sessionManager.createSession(
            uploadId,
            workerId,
            keyFingerprint,
            file.size,
            subKey,
            completedChunks || [],
            actualFileName
          );
          
          await processFileWithSession(file, session);
          
          // Report total chunks sent (for manager tracking)
          const totalChunks = await getTotalChunksProcessed(session);
          
          await sessionManager.removeSession(uploadId);
          
          self.postMessage({ 
            type: 'all-chunks-sent',
            payload: { totalChunks }
          });
        } else if (type === 'chunk-upload-complete') {
          // Handle chunk completion notification from main thread
          const { uploadId, chunkIndex } = payload;
          if (sessionManager) {
            const session = sessionManager.getSession(uploadId);
            if (session) {
              session.handleChunkComplete(chunkIndex);
            }
          }
        } else if (type === 'chunk-upload-error') {
          // Handle chunk error notification from main thread
          const { uploadId, chunkIndex, error } = payload;
          if (sessionManager) {
            const session = sessionManager.getSession(uploadId);
            if (session) {
              session.handleChunkError(chunkIndex, error);
            }
          }
        } else if (type === 'cancel-upload') {
          const { uploadId, reason } = payload;
          
          if (sessionManager) {
            const session = sessionManager.getSession(uploadId);
            if (session) {
              session.cancel(reason);
              await sessionManager.removeSession(uploadId);
              
              self.postMessage({
                type: 'upload-cancelled',
                payload: { uploadId, reason: reason || 'User requested' }
              });
            }
          }
        } else if (type === 'pause') {
          // Pause handled by manager in main thread
          self.postMessage({ type: 'paused' });
        } else if (type === 'abort') {
          if (sessionManager) {
            await sessionManager.cleanupAll();
          }
        } else if (type === 'close') {
          if (sessionManager) {
            await sessionManager.cleanupAll();
          }
        }
      } catch (error) {
        console.error('[Worker] Error in message handler:', error);
        const errorPayload = error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          type: 'error-object'
        } : {
          message: String(error),
          type: 'error-string'
        };
        self.postMessage({ type: 'error', payload: errorPayload });
      }
    };
    
    self.postMessage({ type: 'ready' });
  } catch (err) {
    console.error('[Worker] Fatal initialization error:', err);
    logger.error('[Worker] Fatal initialization error:', err);
    const errorPayload = err instanceof Error ? {
      message: err.message,
      stack: err.stack,
      name: err.name,
      type: 'initialization-error'
    } : {
      message: String(err),
      type: 'initialization-error-string'
    };
    self.postMessage({ type: 'error', payload: errorPayload });
  }
}

async function processFileWithSession(
  file: File,
  session: UploadSession
): Promise<void> {
  const stream = file.stream();
  const reader = stream.getReader();
  
  const growingBuffer = new GrowingBuffer();
  let chunkIndex = 0;
  let totalBytesRead = 0;
  
  // Send metadata as chunk 0 (NOT encrypted), skip if already completed
  if (!session.isChunkCompleted(0)) {
    const metadata = session.getHeader();
    await session.addChunkWithRetry(metadata, 0);
  }
  chunkIndex = 1; // Start data chunks from index 1
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (value) {
        growingBuffer.append(value);
        totalBytesRead += value.length;
      }
      
      const effectiveChunkSize = session.getCurrentChunkSize();
    
      let chunk: Uint8Array | null;
      while ((chunk = growingBuffer.takeChunk(effectiveChunkSize)) !== null) {
        if (session.isCancelled()) {
          throw new Error('Upload cancelled by user');
        }
        
        // Skip if chunk already completed (for resume support)
        if (session.isChunkCompleted(chunkIndex)) {
          chunkIndex++;
          continue;
        }
        
        const startTime = Date.now();
        
        // Compress chunk
        const compressedChunk = session.compressChunk(chunk);
        
        // Encrypt chunk (Stateless encryption)
        const encryptedChunk = session.encryptChunk(compressedChunk, chunkIndex);
        
        const duration = Date.now() - startTime;
        
        await session.addChunkWithRetry(encryptedChunk, chunkIndex);
        session.trackPerformance(chunk.length, duration);
        
        chunkIndex++;
        
        if (session.shouldApplyBackpressure()) {
          await session.waitForBackpressure();
        }
        
        if (session.shouldReportProgress()) {
          const processedBytes = totalBytesRead - growingBuffer.size();
          const eta = session.calculateETA(processedBytes, file.size);
          
          self.postMessage({
            type: 'chunk-upload-progress',
            payload: {
              processedBytes,
              totalBytes: file.size,
              currentChunkSize: effectiveChunkSize,
              eta: eta, 
              percentage: (processedBytes / file.size) * 100,
            },
          });
        }
      }
      
      if (done) {
        const remainder = growingBuffer.getRemainder();
        if (remainder.length > 0 && !session.isChunkCompleted(chunkIndex)) {
          const compressedChunk = session.compressChunk(remainder);
          const encryptedChunk = session.encryptChunk(compressedChunk, chunkIndex);
          await session.addChunkWithRetry(encryptedChunk, chunkIndex);
          chunkIndex++;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
    growingBuffer.clear();
  }
}

async function getTotalChunksProcessed(session: UploadSession): Promise<number> {
  const metrics = session.getMetrics();
  return metrics.chunksProcessed || 0;
}

// Initialize worker when imported
setupWorker();

// Export for proper worker instantiation
export default {} as typeof Worker;