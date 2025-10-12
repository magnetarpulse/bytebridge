/**
 * SessionMetrics: Aggregated metrics for a single upload session.
 *
 * Tracks progress, throughput, compression, errors, and other events for analytics and monitoring.
 */
export interface SessionMetrics {
  /** Unique identifier for the upload session */
  uploadId: string;
  /** Timestamp when the upload started (ms since epoch) */
  startTime: number;
  /** Timestamp when the upload ended (ms since epoch, optional) */
  endTime?: number;
  /** Total bytes expected to be uploaded */
  totalBytes: number;
  /** Total bytes processed so far */
  processedBytes: number;
  /** Number of chunks processed */
  chunksProcessed: number;
  /** Number of chunks successfully uploaded */
  chunksUploaded: number;
  /** Number of chunks that failed to upload */
  chunksFailed: number;
  /** Compression ratio (1 - output/input) */
  compressionRatio: number;
  /** Average upload throughput (bytes/sec) */
  avgThroughput: number;
  /** Peak upload throughput (bytes/sec) */
  peakThroughput: number;
  /** Number of times chunk size was adjusted */
  chunkSizeAdjustments: number;
  /** Number of backpressure events encountered */
  backpressureEvents: number;
  /** List of error events with timestamps */
  errors: Array<{ timestamp: number; error: string }>;
}