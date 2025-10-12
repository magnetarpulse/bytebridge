/**
 * InMemoryMetricsRepo: Simple in-memory implementation of MetricsRepository for testing and development.
 *
 * Provides a fast, ephemeral metrics backend for upload session statistics. Not suitable for production use.
 *
 * Key Features:
 * - Zero-dependency, in-memory storage for rapid prototyping and testing
 * - Implements the MetricsRepository interface
 * - Supports all core metrics operations: init, update, close, get, getAll, clear
 * - Deep copies returned metrics to prevent accidental mutation
 *
 * Usage Example:
 *   const repo = new InMemoryMetricsRepo();
 *   await repo.init({ uploadId: 'abc', ... });
 *   await repo.update({ uploadId: 'abc', processedBytes: 1024 });
 *   const metrics = repo.get('abc');
 */

import { MetricsRepository } from '../ports';
import { SessionMetrics } from '../models';

/**
 * InMemoryMetricsRepo: Simple in-memory implementation of MetricsRepository for testing and development.
 *
 * Stores session metrics in a local Map. Not suitable for production use.
 */
export class InMemoryMetricsRepo implements MetricsRepository {
  private cache = new Map<string, SessionMetrics>();

  /**
   * Initialize metrics for a new upload session.
   *
   * @param m Initial SessionMetrics object
   */
  async init(m: SessionMetrics): Promise<void> {
    this.cache.set(m.uploadId, { ...m });
  }

  /**
   * Update metrics for an existing session.
   *
   * @param partial Partial update to SessionMetrics (must include uploadId)
   * @throws Error if uploadId is missing
   */
  async update(partial: Partial<SessionMetrics>): Promise<void> {
    if (!partial.uploadId) {
      throw new Error('uploadId is required for update');
    }
    
    const current = this.cache.get(partial.uploadId);
    if (current) {
      // Create a new object to maintain immutability
      const updated = { ...current, ...partial };
      this.cache.set(partial.uploadId, updated);
    }
  }

  /**
   * Finalize and persist metrics for a completed session.
   * 
   * @param final Final SessionMetrics object
   */
  async close(final: SessionMetrics): Promise<void> {
    this.cache.set(final.uploadId, { ...final });
  }

  /**
   * Retrieve a deep copy of metrics for a given uploadId.
   * 
   * @param uploadId Upload session identifier
   * @returns SessionMetrics object or undefined if not found
   */
  get(uploadId: string): SessionMetrics | undefined {
    const metrics = this.cache.get(uploadId);
    return metrics ? { ...metrics } : undefined;
  }

  /**
   * Get a copy of all metrics in the repository (for testing/debugging).
   *
   * @returns Map of uploadId to SessionMetrics
   */
  getAll(): Map<string, SessionMetrics> {
    return new Map(this.cache);
  }

  /**
   * Clear all metrics from the repository (for testing).
   */
  clear(): void {
    this.cache.clear();
  }
}