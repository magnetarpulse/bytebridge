import { initializeSodium } from '../encryption/sodiumEncryption';
import * as sodium from 'libsodium-wrappers';
import UploadWebWorker from './upload-web-worker?worker';
import type { WorkerConfig } from './upload-web-worker';
import { validateConfig } from '../utils/configValidator';
import { getDeviceCapabilities } from '../utils/deviceCapabilities';
import { Logger, LogLevel } from '../logger/logger';
import { 
  getCheckpointDB, 
  initializeCheckpointDB,
  type UploadCheckpoint
} from './upload-database'

export interface WorkerManagerConfig {
  masterKey: Uint8Array;
  keyFingerprint: string;
  useWebTransport: boolean;
  httpEndpoint: string;
  workerConfig: WorkerConfig;
  workerCount?: number;
  initTimeoutMs?: number;
  progressThrottleMs?: number;
  minWorkerCount?: number;
  maxWorkerCount?: number;
  enableCheckpoints?: boolean;
  checkpointBatchSize?: number;
  formFieldNames?: {
    uploadId: string;
    chunkIndex: string;
    fileChunk: string;
  };
}

interface WorkerState {
  worker: Worker;
  id: number;
  range: { start: number; end: number };
  subKey: Uint8Array;
  header?: Uint8Array;
  status: 'initializing' | 'idle' | 'uploading' | 'completed' | 'failed';
  isReady: boolean;
  uploadId: string | null;
  lastReportedBytes: number;
  totalChunksExpected: number;
  chunksCompleted: number;
  uploadResolve?: () => void;
  uploadReject?: (error: Error) => void;
  error?: Error;
}

interface UploadTask {
  chunk: Uint8Array;
  chunkIndex: number;
  uploadId: string;
  workerId: number;
  timestamp: number;
  processedWorkerId: number;
}

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  windowStart: number;
}

export interface ProgressUpdate {
  processedBytes: number;
  totalBytes: number;
  workersActive: number;
  workersCompleted: number;
  chunksCompleted?: number;
  totalChunks?: number;
  canResume?: boolean;
}

const MASTER_KEY_LENGTH = 32;
const SUBKEY_LENGTH = 32;
const SUBKEY_ID = 0;
const DEFAULT_INIT_TIMEOUT_MS = 5000;
const DEFAULT_PROGRESS_THROTTLE_MS = 100;
const DEFAULT_MIN_WORKERS = 1;
const DEFAULT_MAX_WORKERS = 8;
const CLEANUP_GRACE_PERIOD_MS = 100;
const CB_THRESHOLD = 5;
const CB_TIMEOUT = 60_000;
const CB_WINDOW = 30_000;
const QUEUE_CLEANUP_THRESHOLD = 50;
const QUEUE_AGGRESSIVE_CLEANUP_THRESHOLD = 10;
const STALE_PROMISE_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_CHECKPOINT_BATCH_SIZE = 10;
const DEFAULT_FORM_FIELDS = {
  uploadId: 'uploadId',
  chunkIndex: 'chunkIndex',
  fileChunk: 'fileChunk',
};

export class WorkerManager {
  private readonly masterKey: Uint8Array;
  private readonly keyFingerprint: string;
  private readonly useWebTransport: boolean;
  private readonly httpEndpoint: string;
  private readonly workerConfig: WorkerConfig;
  private readonly workerCount: number;
  private readonly initTimeoutMs: number;
  private readonly progressThrottleMs: number;
  private readonly formFieldNames: typeof DEFAULT_FORM_FIELDS;
  private readonly enableCheckpoints: boolean;
  private readonly checkpointBatchSize: number;
  private workers: WorkerState[] = [];
  private isInitialized = false;
  private uploadQueue: UploadTask[] = [];
  private queueHead = 0;
  private activeUploads = new Set<number>();
  private queueProcessing = false;
  private chunkPromises = new Map<number, {
    resolve: () => void;
    reject: (error: Error) => void;
    createdAt: number;
    workerId: number;
  }>();
  private circuit: CircuitBreakerState = {
    state: 'closed',
    consecutiveFailures: 0,
    lastFailureTime: 0,
    nextAttemptTime: 0,
    windowStart: Date.now(),
  };
  private stats = { completed: 0, failed: 0 };
  public onUploadQueued?: (depth: number) => void;
  public onUploadStarted?: (active: number) => void;
  public onUploadCompleted?: (ok: number, failed: number) => void;
  private uploadId: string | null = null;
  private progressCallback?: (progress: ProgressUpdate) => void;
  private lastProgressReport = 0;
  private aborted = false;
  private paused = false;
  private staleCleanupInterval: number | null = null;
  private totalFileSize: number = 0;
  private currentFile: File | null = null;
  private completedChunks = new Set<number>();
  private checkpointCounter = 0;
  private logger: Logger;
  
  constructor(config: WorkerManagerConfig) {
    validateConfig(config.workerConfig);
    this.logger = new Logger('Manager', config.workerConfig.logLevel || LogLevel.INFO);
    if (!config.masterKey || !(config.masterKey instanceof Uint8Array)) {
      throw new Error('masterKey must be a Uint8Array');
    }
    if (config.masterKey.length !== MASTER_KEY_LENGTH) {
      throw new Error(`masterKey must be ${MASTER_KEY_LENGTH} bytes, got ${config.masterKey.length}`);
    }
    if (!config.keyFingerprint || typeof config.keyFingerprint !== 'string') {
      throw new Error('keyFingerprint must be a non-empty string');
    }
    if (!config.httpEndpoint || typeof config.httpEndpoint !== 'string') {
      throw new Error('httpEndpoint must be a non-empty string');
    }
    if (typeof config.useWebTransport !== 'boolean') {
      throw new Error('useWebTransport must be a boolean');
    }
    this.masterKey = config.masterKey;
    this.keyFingerprint = config.keyFingerprint;
    this.useWebTransport = config.useWebTransport;
    this.httpEndpoint = config.httpEndpoint;
    this.workerConfig = config.workerConfig;
    this.initTimeoutMs = config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.progressThrottleMs = config.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
    this.formFieldNames = { ...DEFAULT_FORM_FIELDS, ...config.formFieldNames };
    this.enableCheckpoints = config.enableCheckpoints ?? true;
    this.checkpointBatchSize = config.checkpointBatchSize ?? DEFAULT_CHECKPOINT_BATCH_SIZE;
    this.workerCount = this.determineOptimalWorkerCount(
      config.workerCount,
      config.minWorkerCount ?? DEFAULT_MIN_WORKERS,
      config.maxWorkerCount ?? DEFAULT_MAX_WORKERS
    );
  }
  private determineOptimalWorkerCount(
    requested?: number,
    min: number = DEFAULT_MIN_WORKERS,
    max: number = DEFAULT_MAX_WORKERS
  ): number {
    if (requested !== undefined) {
      return Math.max(min, Math.min(max, requested));
    }
    const deviceCaps = getDeviceCapabilities();
    const optimal = deviceCaps.maxWorkers;
    return Math.max(min, Math.min(max, optimal));
  }
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    await initializeSodium();
    if (this.enableCheckpoints) {
      try {
        await initializeCheckpointDB();
      } catch (error) {
        this.logger.warn('Failed to initialize checkpoint DB:', error);
      }
    }
    const initPromises = Array.from({ length: this.workerCount }, (_, i) => 
      this.initializeWorker(i)
    );
    try {
      await Promise.all(initPromises);
      this.isInitialized = true;
      this.staleCleanupInterval = self.setInterval(() => {
        this.cleanupStalePromises();
      }, STALE_PROMISE_CHECK_INTERVAL_MS);
    } catch (error) {
      await this.emergencyCleanup();
      throw new Error(
        `Worker initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  private async initializeWorker(index: number): Promise<void> {
    const worker = new UploadWebWorker();
    const context = `worker-${index}`;
    const subKey = sodium.crypto_kdf_derive_from_key(
      SUBKEY_LENGTH,
      SUBKEY_ID,
      context,
      this.masterKey
    );
    const workerState: WorkerState = {
      worker,
      range: { start: 0, end: 0 },
      id: index,
      isReady: false,
      uploadId: null,
      subKey,
      lastReportedBytes: 0,
      totalChunksExpected: 0,
      chunksCompleted: 0,
      status: 'initializing'
    };
    this.workers[index] = workerState;
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        workerState.status = 'failed';
        reject(new Error(`Worker ${index} initialization timeout after ${this.initTimeoutMs}ms`));
      }, this.initTimeoutMs);
      const messageHandler = (event: MessageEvent) => {
        const { type, payload } = event.data;
        if (type === 'ready') {
          worker.postMessage({
            type: 'init',
            payload: {
              keyFingerprint: this.keyFingerprint,
              useWebTransport: this.useWebTransport,
              config: this.workerConfig
            }
          });
        } else if (type === 'init-success') {
          clearTimeout(timeoutId);
          worker.removeEventListener('message', messageHandler);
          workerState.header = payload.header;
          workerState.isReady = true;
          workerState.status = 'idle';
          worker.onmessage = (e: MessageEvent) => this.handleWorkerMessage(index, e);
          resolve();
        } else if (type === 'error') {
          clearTimeout(timeoutId);
          workerState.status = 'failed';
          reject(new Error(`Worker ${index} initialization failed: ${payload}`));
        }
      };
      worker.addEventListener('message', messageHandler);
      worker.onerror = (error: ErrorEvent) => {
        clearTimeout(timeoutId);
        workerState.status = 'failed';
        reject(new Error(`Worker ${index} error: ${error.message || String(error)}`));
      };
    });
  }
  async canResumeUpload(uploadId: string): Promise<boolean> {
    if (!this.enableCheckpoints) return false;
    try {
      const db = getCheckpointDB();
      const checkpoint = await db.getUpload(uploadId);
      return checkpoint !== null && checkpoint.status === 'in-progress';
    } catch (error) {
      this.logger.warn('Failed to check resume status:', error);
      return false;
    }
  }
  async getResumableUploads(): Promise<UploadCheckpoint[]> {
    if (!this.enableCheckpoints) return [];
    try {
      const db = getCheckpointDB();
      return await db.getInProgressUploads();
    } catch (error) {
      this.logger.warn('Failed to get resumable uploads:', error);
      return [];
    }
  }
  async startUpload(
    file: File,
    uploadId: string,
    progressCallback?: (progress: ProgressUpdate) => void,
    resume: boolean = false
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    if (this.uploadId !== null) {
      throw new Error(`Upload already in progress: ${this.uploadId}`);
    }
    if (!file || !(file instanceof File)) {
      throw new Error('Invalid file parameter');
    }
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('uploadId must be a non-empty string');
    }
    this.uploadId = uploadId;
    this.currentFile = file;
    this.progressCallback = progressCallback;
    this.aborted = false;
    this.paused = false;
    this.lastProgressReport = 0;
    this.totalFileSize = file.size;
    this.resetWorkerStates();
    this.resetUploadState();
    if (resume && this.enableCheckpoints) {
      try {
        const db = getCheckpointDB();
        const checkpoint = await db.getUpload(uploadId);
        if (checkpoint) {
          this.completedChunks = await db.getCompletedChunks(uploadId);
          this.logger.info(` Resuming upload with ${this.completedChunks.size} completed chunks`);
          checkpoint.status = 'in-progress';
          checkpoint.lastUpdated = Date.now();
          await db.saveUpload(checkpoint);
        }
      } catch (error) {
        this.logger.warn('[Manager] Failed to load checkpoint, starting fresh:', error);
        this.completedChunks.clear();
      }
    } else if (this.enableCheckpoints) {
      try {
        const db = getCheckpointDB();
        const checkpoint: UploadCheckpoint = {
          uploadId,
          fileName: file.name,
          fileSize: file.size,
          fileMimeType: file.type,
          totalChunks: 0,
          completedChunks: 0,
          workerCount: this.workerCount,
          startedAt: Date.now(),
          lastUpdated: Date.now(),
          status: 'in-progress',
        };
        await db.saveUpload(checkpoint);
      } catch (error) {
        this.logger.warn('[Manager] Failed to create checkpoint:', error);
      }
    }
    const ranges = this.calculateWorkerRanges(file.size);
    const workerPromises = ranges.map((range, i) => {
      this.workers[i].range = range;
      this.workers[i].uploadId = uploadId;
      this.workers[i].status = 'uploading';
      return this.startWorkerUpload(i, file, uploadId);
    });
    try {
      await Promise.all(workerPromises);
      this.reportFinalProgress();
      if (this.enableCheckpoints) {
        try {
          const db = getCheckpointDB();
          const checkpoint = await db.getUpload(uploadId);
          if (checkpoint) {
            checkpoint.status = 'completed';
            checkpoint.lastUpdated = Date.now();
            await db.saveUpload(checkpoint);
          }
        } catch (error) {
          this.logger.warn('[Manager] Failed to update checkpoint on completion:', error);
        }
      }
    } catch (error) {
      if (this.enableCheckpoints && !this.paused) {
        try {
          const db = getCheckpointDB();
          const checkpoint = await db.getUpload(uploadId);
          if (checkpoint) {
            checkpoint.status = 'failed';
            checkpoint.error = error instanceof Error ? error.message : String(error);
            checkpoint.lastUpdated = Date.now();
            await db.saveUpload(checkpoint);
          }
        } catch (err) {
          this.logger.warn('[Manager] Failed to update checkpoint on error:', err);
        }
      }
      throw error;
    } finally {
      this.uploadId = null;
      this.currentFile = null;
      this.totalFileSize = 0;
      this.completedChunks.clear();
    }
  }
  async pauseUpload(): Promise<void> {
    if (!this.uploadId) {
      throw new Error('No upload in progress');
    }
    this.paused = true;
    if (this.enableCheckpoints) {
      try {
        const db = getCheckpointDB();
        const checkpoint = await db.getUpload(this.uploadId);
        if (checkpoint) {
          checkpoint.status = 'paused';
          checkpoint.lastUpdated = Date.now();
          checkpoint.completedChunks = this.completedChunks.size;
          await db.saveUpload(checkpoint);
        }
      } catch (error) {
        this.logger.warn('[Manager] Failed to save pause state:', error);
      }
    }
    for (const worker of this.workers) {
      if (worker?.worker && worker.status === 'uploading') {
        try {
          worker.worker.postMessage({ type: 'pause' });
          worker.status = 'idle';
        } catch (error) {
          this.logger.warn(` Failed to pause worker ${worker.id}:`, error);
        }
      }
    }
  }
  private isChunkCompleted(chunkIndex: number): boolean {
    return this.completedChunks.has(chunkIndex);
  }
  private resetWorkerStates(): void {
    for (const worker of this.workers) {
      worker.lastReportedBytes = 0;
      worker.totalChunksExpected = 0;
      worker.chunksCompleted = 0;
      worker.status = 'idle';
      worker.error = undefined;
    }
  }
  private resetUploadState(): void {
    this.uploadQueue = [];
    this.queueHead = 0;
    this.activeUploads.clear();
    this.chunkPromises.clear();
    this.stats = { completed: 0, failed: 0 };
    this.checkpointCounter = 0;
  }
  private calculateWorkerRanges(fileSize: number): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const rangeSize = Math.floor(fileSize / this.workerCount);
    let bytesAssigned = 0;
    for (let i = 0; i < this.workerCount; i++) {
      const start = bytesAssigned;
      const end = (i === this.workerCount - 1) ? fileSize : start + rangeSize;
      ranges.push({ start, end });
      bytesAssigned = end;
    }
    return ranges;
  }
  private async startWorkerUpload(
    index: number,
    file: File,
    uploadId: string
  ): Promise<void> {
    const worker = this.workers[index];
    if (!worker.isReady) {
      throw new Error(`Worker ${index} is not ready`);
    }
    const { start, end } = worker.range;
    const rangeFile = file.slice(start, end);
    return new Promise<void>((resolve, reject) => {
      worker.worker.postMessage({
        type: 'start-streaming-upload',
        payload: {
          file: rangeFile,
          uploadId,
          header: worker.header,
          subKey: worker.subKey,
          workerId: index,
          completedChunks: Array.from(this.completedChunks),
          fileName: file.name  // Add filename explicitly
        }
      });
      worker.uploadResolve = resolve;
      worker.uploadReject = reject;
    });
  }
  private checkWorkerCompletion(workerId: number): void {
    const worker = this.workers[workerId];
    if (worker.chunksCompleted >= worker.totalChunksExpected && 
        worker.totalChunksExpected > 0 &&
        worker.status !== 'completed') {
      worker.status = 'completed';
      if (worker.uploadResolve) {
        worker.uploadResolve();
        worker.uploadResolve = undefined;
        worker.uploadReject = undefined;
      }
    }
  }
  private addChunkToQueue(
    chunk: Uint8Array,
    chunkIndex: number,
    uploadId: string,
    workerId: number
  ): void {
  if (this.isChunkCompleted(chunkIndex)) {
    this.logger.info(` Skipping already completed chunk ${chunkIndex}`);
    
    const handlers = this.chunkPromises.get(chunkIndex);
    if (handlers) {
      try {
        handlers.resolve();
        this.chunkPromises.delete(chunkIndex);
      } catch (err) {
        this.logger.error(` Error resolving skipped chunk ${chunkIndex}:`, err);
        this.chunkPromises.delete(chunkIndex);
      }
    }
    
    const worker = this.workers[workerId];
    worker.chunksCompleted++;
    this.checkWorkerCompletion(workerId);
    return;
  }
    
    if (!Number.isInteger(workerId) || workerId < 0) {
      throw new Error(`workerId must be a non-negative integer, got: ${workerId}`);
    }

    const task: UploadTask = {
      chunk,
      chunkIndex,
      uploadId,
      workerId,
      timestamp: Date.now(),
      processedWorkerId: workerId,
    };

  this.chunkPromises.set(chunkIndex, {
    resolve: () => {
      const worker = this.workers[workerId];
      worker.chunksCompleted++;
      
      this.completedChunks.add(chunkIndex);
      
      // Save checkpoint asynchronously without blocking
      if (this.enableCheckpoints) {
        this.checkpointCounter++;
        if (this.checkpointCounter >= this.checkpointBatchSize) {
          this.saveCheckpoint(chunkIndex, workerId, chunk.length).catch(error => {
            this.logger.error('[Manager] Checkpoint save failed:', error);
          });
          this.checkpointCounter = 0;
        }
      }
      
      this.checkWorkerCompletion(workerId);
    },
    reject: (error: Error) => {
      this.logger.error(` Chunk ${chunkIndex} failed:`, error.message);
    },
    createdAt: Date.now(),
    workerId
  });

    this.enqueue(task);
    this.onUploadQueued?.(this.depth());
    this.processQueue();
  }
  private async saveCheckpoint(
    chunkIndex: number, 
    workerId: number, 
    chunkSize: number
  ): Promise<void> {
    if (!this.uploadId) return;
    try {
      const db = getCheckpointDB();
      await db.markChunkCompleted(this.uploadId, chunkIndex, workerId, chunkSize);
      const checkpoint = await db.getUpload(this.uploadId);
      if (checkpoint) {
        checkpoint.completedChunks = this.completedChunks.size;
        checkpoint.lastUpdated = Date.now();
        await db.saveUpload(checkpoint);
      }
    } catch (error) {
      this.logger.warn('[Manager] Failed to save checkpoint:', error);
    }
  }
  private enqueue(task: UploadTask): void {
    this.uploadQueue.push(task);
  }
  private dequeue(): UploadTask | undefined {
    if (this.queueHead >= this.uploadQueue.length) {
      this.uploadQueue = [];
      this.queueHead = 0;
      return undefined;
    }
    const task = this.uploadQueue[this.queueHead++];
    if (this.queueHead > QUEUE_CLEANUP_THRESHOLD || 
        (this.queueHead > QUEUE_AGGRESSIVE_CLEANUP_THRESHOLD && this.depth() === 0)) {
      this.uploadQueue = this.uploadQueue.slice(this.queueHead);
      this.queueHead = 0;
    }
    return task;
  }
  private depth(): number {
    return this.uploadQueue.length - this.queueHead;
  }
  private async processQueue(): Promise<void> {
    if (this.queueProcessing || this.paused) return;
    this.queueProcessing = true;
    try {
      while (
        this.activeUploads.size < this.workerConfig.maxConcurrentUploads &&
        this.depth() > 0 &&
        !this.paused
      ) {
        const task = this.dequeue();
        if (!task) break;
        this.executeUpload(task);
      }
    } finally {
      this.queueProcessing = false;
    }
  }
  private async executeUpload(task: UploadTask): Promise<void> {
    this.activeUploads.add(task.chunkIndex);
    this.onUploadStarted?.(this.activeUploads.size);

    try {
      await this.uploadWithTimeout(task);
      this.stats.completed++;

      // Mark chunk as completed
      this.completedChunks.add(task.chunkIndex);

      // Notify worker that chunk upload is complete
      const worker = this.workers[task.workerId];
      if (worker?.worker) {
        worker.worker.postMessage({
          type: 'chunk-upload-complete',
          payload: {
            chunkIndex: task.chunkIndex,
            uploadId: task.uploadId
          }
        });
      }

      const handlers = this.chunkPromises.get(task.chunkIndex);
      if (handlers) {
        handlers.resolve();
        this.chunkPromises.delete(task.chunkIndex);
      }
      this.onUploadCompleted?.(this.stats.completed, this.stats.failed);
    } catch (error) {
      this.stats.failed++;
      this.logger.error('Chunk upload failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      const handlers = this.chunkPromises.get(task.chunkIndex);
      if (handlers) {
        handlers.reject(error instanceof Error ? error : new Error(String(error)));
        this.chunkPromises.delete(task.chunkIndex);
      }
      this.onUploadCompleted?.(this.stats.completed, this.stats.failed);
    } finally {
      this.activeUploads.delete(task.chunkIndex);
      if (!this.paused) {
        this.processQueue();
      }
    }
  }
  private async uploadWithTimeout(task: UploadTask): Promise<void> {
    const timeoutMs = this.workerConfig.uploadTimeout ?? 120_000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Upload timeout after ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([this.performHTTPUpload(task), timeout]);
  }
  private async performHTTPUpload(task: UploadTask): Promise<void> {
    this.circuitGuard();
    let retries = 0;
    const { maxRetries, baseDelay, maxDelay } = this.workerConfig.retryConfig;
    while (true) {
      try {
        const formData = new FormData();
        formData.append(this.formFieldNames.uploadId, task.uploadId);
        const filename = `w${task.processedWorkerId}_${String(
          task.chunkIndex
        ).padStart(6, '0')}.part`;
        formData.append(this.formFieldNames.chunkIndex, filename);
        formData.append(this.formFieldNames.fileChunk, new Blob([task.chunk]));
        const response = await fetch(this.httpEndpoint, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `Upload failed: ${
              errorData.error || `HTTP ${response.status}: ${response.statusText}`
            }. UploadId: ${task.uploadId}, Chunk: ${task.chunkIndex}, Worker: ${task.workerId}`
          );
        }
        this.onSuccess();
        return;
      } catch (error) {
        this.onFailure();
        retries++;
        if (retries > maxRetries) {
          this.logger.error('Upload retry limit exceeded', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            attempts: retries
          });
          throw new Error(
            `Failed after ${maxRetries} retries: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        const delay = Math.min(
          baseDelay * 2 ** retries + Math.random() * 1000,
          maxDelay
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  private circuitGuard(): void {
    const now = Date.now();
    if (now - this.circuit.windowStart > CB_WINDOW) {
      this.circuit.consecutiveFailures = 0;
      this.circuit.windowStart = now;
    }
    if (this.circuit.state === 'open') {
      if (now < this.circuit.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN – uploads paused');
      }
      this.circuit.state = 'half-open';
    }
  }
  private onSuccess(): void {
    if (this.circuit.state === 'half-open') {
      this.circuit.consecutiveFailures = 0;
      this.circuit.windowStart = Date.now();
    }
    this.circuit.state = 'closed';
  }
  private onFailure(): void {
    const now = Date.now();
    if (now - this.circuit.lastFailureTime < CB_WINDOW) {
      this.circuit.consecutiveFailures++;
    } else {
      this.circuit.consecutiveFailures = 1;
      this.circuit.windowStart = now;
    }
    this.circuit.lastFailureTime = now;
    if (this.circuit.consecutiveFailures >= CB_THRESHOLD) {
      this.circuit.state = 'open';
      this.circuit.nextAttemptTime = now + CB_TIMEOUT;
      this.logger.warn(` Circuit breaker OPEN after ${this.circuit.consecutiveFailures} failures`);
    }
  }
  private handleWorkerMessage(workerIndex: number, event: MessageEvent): void {
    const { type, payload } = event.data;
    switch (type) {
      case 'chunk-upload-progress':
        this.updateProgress(workerIndex, payload);
        break;
      case 'chunk-ready':
        this.addChunkToQueue(
          payload.chunk,
          payload.chunkIndex,
          payload.uploadId,
          workerIndex
        );
        break;
      case 'all-chunks-sent':
        const worker = this.workers[workerIndex];
        this.logger.info(`Worker ${workerIndex} finished sending chunks`, {
          totalChunks: payload.totalChunks,
          // chunksCompleted: worker.chunksCompleted
        });
        worker.totalChunksExpected = payload.totalChunks || worker.chunksCompleted;
        this.checkWorkerCompletion(workerIndex);
        break;
      case 'error':
        const workerState = this.workers[workerIndex];
        workerState.status = 'failed';
        
        // Extract detailed error information
        const errorMessage = typeof payload === 'string' ? payload : 
                           payload?.message || payload?.error || 
                           JSON.stringify(payload);
        
        const errorStack = typeof payload === 'object' && payload?.stack ? payload.stack : undefined;
        const errorName = typeof payload === 'object' && payload?.name ? payload.name : undefined;
        
        console.error(`[Manager] Worker ${workerIndex} error occurred:`, {
          errorMessage,
          errorStack,
          errorName,
          errorType: typeof payload,
          payloadKeys: typeof payload === 'object' ? Object.keys(payload) : [],
          chunkIndex: payload?.chunkIndex,
          uploadId: payload?.uploadId,
          workerStatus: workerState.status,
          chunksCompleted: workerState.chunksCompleted,
          totalChunksExpected: workerState.totalChunksExpected,
          fullPayload: payload
        });
        
        this.logger.error(`Worker ${workerIndex} error occurred`, {
          errorMessage,
          errorStack,
          errorName,
          errorType: typeof payload,
          payloadKeys: typeof payload === 'object' ? Object.keys(payload) : [],
          chunkIndex: payload?.chunkIndex,
          uploadId: payload?.uploadId,
          workerStatus: workerState.status,
          chunksCompleted: workerState.chunksCompleted,
          totalChunksExpected: workerState.totalChunksExpected
        });
        
        workerState.error = new Error(`Worker ${workerIndex} error: ${errorMessage}`);
        if (errorStack) {
          workerState.error.stack = `Worker ${workerIndex} stack:\n${errorStack}`;
        }
        
        if (workerState.uploadReject) {
          workerState.uploadReject(workerState.error);
          workerState.uploadResolve = undefined;
          workerState.uploadReject = undefined;
        }
        break;
      case 'upload-metrics':
        this.logger.info(` Worker ${workerIndex} completed: ${payload.chunksProcessed || 0} chunks`);
        break;
      case 'paused':
        break;
      case 'upload-cancelled':
        this.logger.info(` Worker ${workerIndex} cancelled: ${payload.reason || 'unknown'}`);
        break;
      default:
        this.logger.warn(` Unknown message type from worker ${workerIndex}:`, type);
    }
  }
  private updateProgress(workerIndex: number, workerProgress: any): void {
    if (this.aborted || !this.progressCallback) return;
    this.workers[workerIndex].lastReportedBytes = workerProgress.processedBytes;
    const now = Date.now();
    if (now - this.lastProgressReport < this.progressThrottleMs) {
      return;
    }
    this.lastProgressReport = now;
    const totalProcessedBytes = this.workers.reduce(
      (sum, worker) => sum + worker.lastReportedBytes,
      0
    );
    const workersActive = this.workers.filter(w => w.status === 'uploading').length;
    const workersCompleted = this.workers.filter(w => w.status === 'completed').length;
    this.progressCallback({
      processedBytes: totalProcessedBytes,
      totalBytes: this.totalFileSize,
      workersActive,
      workersCompleted,
      chunksCompleted: this.completedChunks.size,
      totalChunks: this.workers.reduce((sum, w) => sum + w.totalChunksExpected, 0),
      canResume: this.enableCheckpoints,
    });
  }
  private reportFinalProgress(): void {
    if (!this.progressCallback) return;
    const finalProcessedBytes = this.workers.reduce(
      (sum, worker) => sum + worker.lastReportedBytes,
      0
    );
    this.progressCallback({
      processedBytes: finalProcessedBytes,
      totalBytes: this.totalFileSize,
      workersActive: 0,
      workersCompleted: this.workerCount,
      chunksCompleted: this.completedChunks.size,
      totalChunks: this.completedChunks.size,
      canResume: false,
    });
  }
  async abort(): Promise<void> {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    for (const worker of this.workers) {
      if (worker?.worker) {
        try {
          worker.worker.postMessage({ type: 'abort' });
        } catch (error) {
        }
      }
    }
    await this.cleanup();
  }
  async cleanup(): Promise<void> {
    if (this.staleCleanupInterval !== null) {
      clearInterval(this.staleCleanupInterval);
      this.staleCleanupInterval = null;
    }
    const closePromises = this.workers.map(worker => {
      if (worker?.worker) {
        return new Promise<void>((resolve) => {
          try {
            worker.worker.postMessage({ type: 'close' });
            setTimeout(resolve, CLEANUP_GRACE_PERIOD_MS);
          } catch {
            resolve();
          }
        });
      }
      return Promise.resolve();
    });
    await Promise.allSettled(closePromises);
    for (const worker of this.workers) {
      if (worker?.worker) {
        try {
          worker.worker.terminate();
        } catch (error) {
        }
      }
    }
    this.workers = [];
    this.uploadQueue = [];
    this.queueHead = 0;
    this.activeUploads.clear();
    this.chunkPromises.clear();
    this.uploadId = null;
    this.currentFile = null;
    this.completedChunks.clear();
    this.isInitialized = false;
  }
  private async emergencyCleanup(): Promise<void> {
    if (this.staleCleanupInterval !== null) {
      clearInterval(this.staleCleanupInterval);
      this.staleCleanupInterval = null;
    }
    for (const worker of this.workers) {
      if (worker?.worker) {
        try {
          worker.worker.terminate();
        } catch (e) {
        }
      }
    }
    this.workers = [];
    this.isInitialized = false;
  }
  private cleanupStalePromises(): void {
    const now = Date.now();
    const timeout = this.workerConfig.promiseStaleTimeout ?? 300_000;
    for (const [idx, handlers] of this.chunkPromises.entries()) {
      if (now - handlers.createdAt > timeout) {
        handlers.reject(new Error('Promise cleaned up – stale'));
        this.chunkPromises.delete(idx);
      }
    }
  }
  async cleanupOldCheckpoints(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    if (!this.enableCheckpoints) return 0;
    try {
      const db = getCheckpointDB();
      return await db.cleanupOldUploads(maxAgeMs);
    } catch (error) {
      this.logger.warn('[Manager] Failed to cleanup old checkpoints:', error);
      return 0;
    }
  }
  async deleteCheckpoint(uploadId: string): Promise<void> {
    if (!this.enableCheckpoints) return;
    try {
      const db = getCheckpointDB();
      await db.deleteUpload(uploadId);
    } catch (error) {
      this.logger.warn('[Manager] Failed to delete checkpoint:', error);
    }
  }
  getWorkerStatuses(): Array<{
    id: number;
    status: string;
    range: { start: number; end: number };
    processedBytes: number;
    chunksCompleted: number;
    totalChunksExpected: number;
    error?: string;
  }> {
    return this.workers.map(w => ({
      id: w.id,
      status: w.status,
      range: w.range,
      processedBytes: w.lastReportedBytes,
      chunksCompleted: w.chunksCompleted,
      totalChunksExpected: w.totalChunksExpected,
      error: w.error?.message
    }));
  }
  isReady(): boolean {
    return this.isInitialized && this.workers.every(w => w.isReady);
  }
  getWorkerCount(): number {
    return this.workerCount;
  }
  isUploading(): boolean {
    return this.uploadId !== null;
  }
  isPaused(): boolean {
    return this.paused;
  }
  getConfiguration(): Readonly<{
    workerCount: number;
    useWebTransport: boolean;
    httpEndpoint: string;
    maxConcurrentUploads: number;
    checkpointsEnabled: boolean;
  }> {
    return {
      workerCount: this.workerCount,
      useWebTransport: this.useWebTransport,
      httpEndpoint: this.httpEndpoint,
      maxConcurrentUploads: this.workerConfig.maxConcurrentUploads,
      checkpointsEnabled: this.enableCheckpoints,
    };
  }
}