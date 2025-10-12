/**
 * Config Validator for WorkerConfig
 *
 * This module provides strict runtime validation for WorkerConfig objects used in
 * streaming encryption/upload workers. It ensures that all configuration parameters
 * are within safe, expected, and meaningful bounds before the worker is started.
 *
 * The validator is designed to catch misconfigurations early, prevent subtle bugs,
 * and provide clear error messages for developers and users. Each section of the
 * configuration is checked for logical consistency and safe operating ranges.
 *
 * Usage Example:
 *   import { validateConfig, ConfigValidationError } from './config-validator';
 *   try {
 *     validateConfig(config);
 *   } catch (e) {
 *     if (e instanceof ConfigValidationError) {
 *       // Handle config error
 *     }
 *   }
 */
import type { WorkerConfig } from '../workers/upload-web-worker';

/**
 * Error thrown when configuration validation fails.
 * Provides a clear message for the specific validation error.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate a WorkerConfig object, throwing ConfigValidationError on any invalid field.
 *
 * This function checks all major configuration sections:
 *   - Chunk size (min, max, initial)
 *   - Concurrency
 *   - Compression
 *   - Retry/backoff
 *   - Backpressure
 *   - Adaptive chunk sizing
 *   - Batch notification
 *
 * Throws early and with a clear message on the first invalid field encountered.
 *
 * @param config The WorkerConfig object to validate
 * @throws {ConfigValidationError} if any field is invalid
 */
export function validateConfig(config: WorkerConfig): void {
  /**
   * Chunk Size Validation
   *
   * Ensures that chunk size parameters (min, max, initial) are positive, logically consistent,
   * and that the initial value falls within the allowed range. Prevents misconfiguration that
   * could cause buffer overflows, underflows, or inefficient chunking.
   */
  // Ensure minimum chunk size is positive to avoid zero-length or negative buffers
  if (config.chunkSize.min <= 0) {
    throw new ConfigValidationError('chunkSize.min must be positive');
  }
  // Ensure maximum chunk size is positive to prevent invalid buffer allocation
  if (config.chunkSize.max <= 0) {
    throw new ConfigValidationError('chunkSize.max must be positive');
  }
  // Ensure minimum chunk size does not exceed maximum
  if (config.chunkSize.min > config.chunkSize.max) {
    throw new ConfigValidationError(
      `chunkSize.min (${config.chunkSize.min}) must be <= chunkSize.max (${config.chunkSize.max})`
    );
  }
  // Ensure initial chunk size is within allowed range
  if (config.chunkSize.initial < config.chunkSize.min || 
      config.chunkSize.initial > config.chunkSize.max) {
    throw new ConfigValidationError(
      `chunkSize.initial (${config.chunkSize.initial}) must be between min and max`
    );
  }
  
  /**
   * Concurrency Validation
   *
   * Validates that the maximum number of concurrent uploads is within a safe and supported range.
   * Prevents resource exhaustion or underutilization by enforcing reasonable concurrency limits.
   */
  // Ensure concurrency is within safe operational limits (1-16 workers)
  if (config.maxConcurrentUploads < 1 || config.maxConcurrentUploads > 16) {
    throw new ConfigValidationError(
      'maxConcurrentUploads must be between 1 and 16'
    );
  }
  
  /**
   * Retry/Backoff Validation
   *
   * Checks that retry and backoff parameters are within safe and effective bounds. Prevents
   * excessive retries, too-short or too-long delays, and ensures logical relationships between
   * base and maximum delay values.
   */
  // Ensure retry count is within a reasonable range to avoid infinite or no retries
  if (config.retryConfig.maxRetries < 0 || config.retryConfig.maxRetries > 10) {
    throw new ConfigValidationError(
      'maxRetries must be between 0 and 10'
    );
  }
  // Ensure base delay is not too short to prevent rapid retry storms
  if (config.retryConfig.baseDelay < 100) {
    throw new ConfigValidationError(
      'baseDelay must be at least 100ms'
    );
  }
  // Ensure max delay is not less than base delay for logical backoff
  if (config.retryConfig.maxDelay < config.retryConfig.baseDelay) {
    throw new ConfigValidationError(
      'maxDelay must be >= baseDelay'
    );
  }
  
  /**
   * Backpressure Validation
   *
   * Validates backpressure configuration to ensure thresholds and delay multipliers are
   * within safe, non-negative ranges. Prevents runaway delays or ineffective backpressure handling.
   */
  // Ensure backpressure threshold is at least 1 to avoid disabling backpressure
  if (config.backpressure.threshold < 1) {
    throw new ConfigValidationError(
      'backpressure.threshold must be at least 1'
    );
  }
  // Ensure delay multiplier is non-negative to prevent negative delays
  if (config.backpressure.delayMultiplier < 0) {
    throw new ConfigValidationError(
      'backpressure.delayMultiplier must be non-negative'
    );
  }
  
  /**
   * Adaptive Chunk Sizing Validation
   *
   * Checks that adaptive chunk sizing parameters are logically consistent and within
   * safe bounds when enabled. Ensures thresholds and adjustment factors are set for
   * effective and stable adaptation.
   */
  if (config.adaptiveChunkSizing.enabled) {
    // Ensure increase threshold is > 1.0 for meaningful adaptation
    if (config.adaptiveChunkSizing.increaseThreshold <= 1.0) {
      throw new ConfigValidationError(
        'increaseThreshold must be > 1.0'
      );
    }
    // Ensure decrease threshold is < 1.0 for meaningful adaptation
    if (config.adaptiveChunkSizing.decreaseThreshold >= 1.0) {
      throw new ConfigValidationError(
        'decreaseThreshold must be < 1.0'
      );
    }
    // Ensure adjustment factor is > 1.0 to allow chunk size changes
    if (config.adaptiveChunkSizing.adjustmentFactor <= 1.0) {
      throw new ConfigValidationError(
        'adjustmentFactor must be > 1.0'
      );
    }
    // Ensure history size is at least 2 for adaptation to work
    if (config.adaptiveChunkSizing.historySize < 2) {
      throw new ConfigValidationError(
        'historySize must be at least 2'
      );
    }
  }
  
  /**
   * Batch Notification Validation
   *
   * Ensures batch notification parameters (timeout and minimum chunks) are within
   * safe and effective ranges. Prevents notification storms or excessive delays.
   */
  // Ensure batch notification timeout is within a safe range to avoid excessive or delayed notifications
  if (config.batchNotification.timeoutMs < 1 || config.batchNotification.timeoutMs > 1000) {
    throw new ConfigValidationError(
      'batchNotification.timeoutMs must be between 1 and 1000'
    );
  }
  // Ensure minimum chunks for flush is at least 1 to avoid no flushing
  if (config.batchNotification.minChunksForFlush < 1) {
    throw new ConfigValidationError(
      'minChunksForFlush must be at least 1'
    );
  }
  
  /**
   * Upload Timeout Validation
   *
   * Ensures that the overall upload timeout (if specified) is reasonable and not too short.
   * Prevents premature upload cancellations that could occur with overly aggressive timeout values.
   */
  // Ensure upload timeout is at least 1 second to prevent premature cancellations
  if (config.uploadTimeout && config.uploadTimeout < 1000) {
    throw new ConfigValidationError(
      'uploadTimeout must be at least 1000ms'
    );
  }
  
  /**
   * Promise Stale Timeout Validation
   *
   * Validates the timeout for stale promise cleanup to ensure it's reasonable.
   * Prevents memory leaks from promises that never resolve while avoiding premature cleanup.
   */
  // Ensure stale promise timeout is at least 1 second to prevent premature cleanup
  if (config.promiseStaleTimeout && config.promiseStaleTimeout < 1000) {
    throw new ConfigValidationError(
      'promiseStaleTimeout must be at least 1000ms'
    );
  }
}