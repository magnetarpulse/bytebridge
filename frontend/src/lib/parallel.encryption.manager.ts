/**
 * @file Parallel encryption producer manager that coordinates multiple encryption workers.
 * @module ParallelEncryptionManager
 * 
 * @description
 * This module implements range-sharded, parallel producer workers for encrypting and uploading
 * large files. Each worker operates on a specific range of the file, using sub-keys derived
 * from a single master key for independent encryption streams.
 */

import { initializeSodium } from './encryption';
import * as sodium from 'libsodium-wrappers';

/**
 * Represents a single producer worker and its assigned range.
 */
interface ProducerWorker {
  worker: Worker;
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
 * Manages multiple encryption producer workers, each handling a specific range of the file.
 * This class coordinates the workers, derives sub-keys, and ensures proper chunk sequencing.
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
    // Determine optimal worker count (default to 4 or available cores - 1)
    const optimalCount = navigator.hardwareConcurrency 
      ? Math.max(2, Math.min(4, navigator.hardwareConcurrency - 1)) 
      : 4;
    const workerCount = config.workerCount || optimalCount;
    // Initialize producer array
    this.producers = Array(workerCount).fill(null);
    console.debug(`[Parallel Encryption] Initializing with ${workerCount} producer workers`);
  }

  /**
   * Initializes the producer workers and prepares them for a file upload.
   */
  async initialize(): Promise<void> {
    // Ensure sodium is initialized first
    await initializeSodium();
    
    // Create and initialize workers
    for (let i = 0; i < this.producers.length; i++) {
      await this.initializeWorker(i);
    }
    
    console.debug(`[Parallel Encryption] All ${this.producers.length} workers initialized`);
  }
  
  /**
   * Initializes a single worker with its configuration.
   */
  private async initializeWorker(index: number): Promise<void> {
    const worker = new Worker(new URL('./encryption.streaming.worker.ts', import.meta.url));
    const producerInfo: ProducerWorker = {
      worker,
      range: { start: 0, end: 0 }, // Will be set during startUpload
      id: index,
      isReady: false,
      uploadId: null
    };
    this.producers[index] = producerInfo;
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Worker ${index} initialization timed out`));
      }, 5000);
      worker.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'ready') {
          clearTimeout(timeoutId);
          console.debug(`[Parallel Encryption] Worker ${index} is ready`);
          // Initialize the worker with our configuration
          worker.postMessage({
            type: 'init',
            payload: {
              compressionLevel: this.compressionLevel,
              keyFingerprint: this.keyFingerprint, // Use original fingerprint
              useWebTransport: this.useWebTransport
            }
          });
        } else if (type === 'init-success') {
          // Store the worker's header and mark as ready
          producerInfo.header = payload.header;
          producerInfo.isReady = true;
          // Derive and store sub-key for this worker
          const context = `worker-${index}`;
          producerInfo.subKey = sodium.crypto_kdf_derive_from_key(
            32, // length
            0,  // subkey id
            context, // unique per worker
            this.masterKey // the main key
          );
          resolve();
        } else if (type === 'error') {
          clearTimeout(timeoutId);
          reject(new Error(`Worker ${index} initialization failed: ${payload}`));
        } else {
          // Handle other message types during normal operation
          this.handleWorkerMessage(index, event);
        }
      };
      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Worker ${index} script error: ${error.message}`));
      };
    });
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
    const workerPromises: Promise<void>[] = [];
    let bytesAssigned = 0;
    // Assign ranges and start workers
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
      // Pass workerIndex instead of chunk offset
      workerPromises.push(this.startWorkerUpload(i, file, uploadId));
    }
    // Wait for all workers to complete
    await Promise.all(workerPromises);
    console.debug(`[Parallel Encryption] All workers have completed their uploads`);
  }
  
  /**
   * Starts a single worker's upload process for its assigned range.
   */
  private async startWorkerUpload(
    index: number, 
    file: File, 
    uploadId: string,
  ): Promise<void> {
    const producer = this.producers[index];
    if (!producer.isReady) {
      throw new Error(`Worker ${index} is not ready`);
    }
    
    // Extract just the portion of the file for this worker
    const { start, end } = producer.range;
    const rangeFile = file.slice(start, end);
    return new Promise<void>((resolve, reject) => {
      const worker = producer.worker;
      // Set up message handler specifically for this upload operation
      const originalHandler = worker.onmessage;
      worker.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'all-chunks-sent') {
          console.debug(`[Parallel Encryption] Worker ${index} has completed all chunks`);
          worker.onmessage = originalHandler as any; // Restore original handler
          resolve();
        } else if (type === 'error') {
          console.error(`[Parallel Encryption] Worker ${index} error:`, payload);
          reject(new Error(`Worker ${index} error: ${payload}`));
        } else {
          this.handleWorkerMessage(index, event);
        }
      };
      // Start the streaming upload
      worker.postMessage({
        type: 'start-streaming-upload',
        payload: {
          file: rangeFile,
          uploadId,
          header: producer.header
        }
      });
    });
  }
  
  /**
   * Handles messages from workers during normal operation.
   */
  private handleWorkerMessage(workerIndex: number, event: MessageEvent): void {
    const { type, payload } = event.data;
    
    if (type === 'chunk-upload-progress') {
      // Aggregate progress from all workers
      this.updateProgress(workerIndex, payload);
    } else if (type === 'chunk-upload-complete') {
      this.completedChunks++;
      // Could add additional tracking here if needed
    }
  }
  
  /**
   * Updates the overall progress based on individual worker progress.
   */
  private updateProgress(workerIndex: number, workerProgress: any): void {
    if (this.aborted || !this.progressCallback) return;
    
    // Maintain a running total of processed bytes across all workers
    const totalProcessedBytes = this.producers.reduce((sum, producer, i) => {
      if (i === workerIndex) {
        return sum + workerProgress.processedBytes;
      }
      // Use last reported progress for other workers
      return sum + (producer.lastReportedBytes || 0);
    }, 0);
    
    // Update last reported bytes for this worker
    this.producers[workerIndex].lastReportedBytes = workerProgress.processedBytes;
    
    // Calculate total bytes from file size
    const totalBytes = this.producers.reduce((sum, producer) => {
      return sum + (producer.range.end - producer.range.start);
    }, 0);
    
    // Report aggregated progress
    this.progressCallback({
      processedBytes: totalProcessedBytes,
      totalBytes
    });
  }
  
  /**
   * Aborts all worker uploads and cleans up resources.
   */
  async abort(): Promise<void> {
    this.aborted = true;
    
    // Signal abort to all workers
    for (const producer of this.producers) {
      producer.worker.postMessage({ type: 'abort' });
    }
    
    // Clean up workers
    await this.cleanup();
  }
  
  /**
   * Cleans up resources when uploads are complete or aborted.
   */
  private async cleanup(): Promise<void> {
    // Gracefully close all workers
    for (const producer of this.producers) {
      producer.worker.postMessage({ type: 'close' });
    }
    // Wait 100ms for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const producer of this.producers) {
      producer.worker.terminate();
    }
    this.producers = [];
    console.debug(`[Parallel Encryption] Cleanup complete, all workers terminated`);
  }
}