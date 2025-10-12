/**
 * MetricsCollector: High-performance, extensible metrics aggregation for upload sessions.
 *
 * This module provides a robust, pluggable metrics collection system for tracking upload session statistics
 * such as throughput, compression, errors, chunk processing, and backpressure events. Designed for both
 * production and testing environments, it supports custom metrics repositories, configurable error handling,
 * and efficient, low-overhead aggregation.
 *
 * Key Features:
 * - Pluggable repository: Swap in-memory, persistent, or remote metrics backends.
 * - Fine-grained tracking: Monitors chunk processing, upload throughput, compression ratio, errors, and more.
 * - Batching and flush control: Efficiently batches updates to minimize performance impact.
 * - Configurable error handling: Customizable error limits and hooks for robust operation.
 * - Designed for streaming: Suitable for high-throughput, real-time upload scenarios.
 *
 * Usage Example:
 *   const collector = new MetricsCollector('upload-123', 10_000_000);
 *   collector.recordChunkProcessed(4096, 2048);
 *   collector.recordChunkUploaded(1_000_000);
 *   ...
 *   const finalMetrics = await collector.complete();
 */

import { MetricsRepository } from './ports';
import { SessionMetrics } from './models';
import { InMemoryMetricsRepo } from './adapters/in-memory-metrics-repo';

/**
 * Configuration options for MetricsCollector.
 *
 * @property maxErrors - Maximum number of errors to retain in the metrics (default: 100)
 * @property onError - Optional callback for handling errors (default: logs to console)
 * @property flushDelay - Delay in milliseconds before metrics are flushed to the repository (default: 100)
 */
export interface MetricsCollectorConfig {
  maxErrors?: number;
  onError?: (error: Error) => void;
  flushDelay?: number;
}

/**
 * MetricsCollector: Collects, aggregates, and persists upload session metrics.
 *
 * Tracks chunk processing, upload throughput, compression, errors, and backpressure events.
 * Supports pluggable metrics repositories and configurable error handling.
 * Designed for both production and testing environments.
 */
export class MetricsCollector {
  private repo: MetricsRepository;
  private metrics: SessionMetrics;
  private compressionInput = 0;
  private compressionOutput = 0;
  private throughputSum = 0;
  private throughputCount = 0;
  private _flushTimer?: NodeJS.Timeout;
  private maxErrors: number;
  private onError?: (error: Error) => void;
  private flushDelay: number;
  private isCompleting = false;

  /**
   * Create a new MetricsCollector.
   *
   * @param uploadId Unique identifier for the upload session
   * @param totalBytes Total bytes expected to be uploaded
   * @param repo Optional custom metrics repository (defaults to in-memory)
   * @param config Optional collector configuration
   */
  constructor(
    uploadId: string,
    totalBytes: number,
    repo?: MetricsRepository,
    config: MetricsCollectorConfig = {}
  ) {
    this.repo = repo ?? new InMemoryMetricsRepo();
    this.maxErrors = config.maxErrors ?? 100;
    this.onError = config.onError;
    this.flushDelay = config.flushDelay ?? 100;
    
    this.metrics = {
      uploadId,
      startTime: Date.now(),
      totalBytes,
      processedBytes: 0,
      chunksProcessed: 0,
      chunksUploaded: 0,
      chunksFailed: 0,
      compressionRatio: 0,
      avgThroughput: 0,
      peakThroughput: 0,
      chunkSizeAdjustments: 0,
      backpressureEvents: 0,
      errors: [],
    };
    
    this.initializeRepo().catch(error => this.handleError(error));
  }

  /* ---------- Public Methods ---------- */

  /**
   * Record a processed chunk, updating compression and processed byte stats.
   *
   * @param originalSize Size of the chunk before compression
   * @param compressedSize Size of the chunk after compression
   */
  recordChunkProcessed(originalSize: number, compressedSize: number): void {
    if (this.isCompleting) return;
    
    this.metrics.chunksProcessed++;
    this.metrics.processedBytes += originalSize;
    this.compressionInput += originalSize;
    this.compressionOutput += compressedSize;
    this.metrics.compressionRatio =
      this.compressionInput === 0
        ? 0
        : 1 - this.compressionOutput / this.compressionInput;
    this.flush();
  }

  /**
   * Record a successfully uploaded chunk and update throughput statistics.
   *
   * @param throughput Throughput in bytes/sec for this chunk
   */
  recordChunkUploaded(throughput: number): void {
    if (this.isCompleting) return;
    
    this.metrics.chunksUploaded++;
    this.throughputSum += throughput;
    this.throughputCount++;
    this.metrics.avgThroughput = this.throughputSum / this.throughputCount;
    this.metrics.peakThroughput = Math.max(this.metrics.peakThroughput, throughput);
    this.flush();
  }

  /**
   * Record a failed chunk upload and log the error.
   *
   * @param error Error message or description
   */
  recordChunkFailed(error: string): void {
    if (this.isCompleting) return;
    
    this.metrics.chunksFailed++;
    this.addError(error);
    this.flush();
  }

  /**
   * Record a chunk size adjustment event.
   */
  recordChunkSizeAdjustment(): void {
    if (this.isCompleting) return;
    
    this.metrics.chunkSizeAdjustments++;
    this.flush();
  }

  /**
   * Record a backpressure event.
   */
  recordBackpressure(): void {
    if (this.isCompleting) return;
    
    this.metrics.backpressureEvents++;
    this.flush();
  }

  /**
   * Complete the metrics collection, flush all data, and return the final metrics snapshot.
   *
   * @returns Final SessionMetrics object
   */
  async complete(): Promise<SessionMetrics> {
    if (this.isCompleting) {
      return this.getSnapshot();
    }
    
    this.isCompleting = true;
    
    // Clear any pending flush
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    
    // Perform final flush
    this.metrics.endTime = Date.now();
    try {
      await this.repo.close(this.metrics);
    } catch (error) {
      this.handleError(error as Error);
    }
    
    return this.getSnapshot();
  }

  /**
   * Get a deep copy of the current metrics snapshot.
   *
   * @returns Current SessionMetrics object
   */
  getSnapshot(): SessionMetrics {
    return { 
      ...this.metrics,
      errors: [...this.metrics.errors] // Deep copy errors array
    };
  }

  /* ---------- Private Methods ---------- */

  /**
   * Initialize the metrics repository with the initial metrics object.
   */
  private async initializeRepo(): Promise<void> {
    try {
      await this.repo.init(this.metrics);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Add an error to the metrics, enforcing the max error count.
   *
   * @param error Error message or description
   */
  private addError(error: string): void {
    this.metrics.errors.push({ timestamp: Date.now(), error });
    
    // Limit errors array size
    if (this.metrics.errors.length > this.maxErrors) {
      this.metrics.errors = this.metrics.errors.slice(-this.maxErrors);
    }
  }

  /**
   * Schedule a flush of metrics to the repository after a short delay.
   */
  private flush(): void {
    if (this.isCompleting) return;
    
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = undefined;
        this.performFlush().catch(error => this.handleError(error));
      }, this.flushDelay);
    }
  }

  /**
   * Perform the actual flush to the repository.
   */
  private async performFlush(): Promise<void> {
    try {
      await this.repo.update(this.metrics);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Handle errors using the configured error handler or default logging.
   *
   * @param error Error object
   */
  private handleError(error: Error): void {
    if (this.onError) {
      this.onError(error);
    } else {
      // Default error logging - can be customized via config
      console.error('MetricsCollector error:', error);
    }
  }
}