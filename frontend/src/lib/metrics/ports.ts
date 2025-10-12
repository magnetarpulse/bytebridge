import { SessionMetrics } from './models';

/**
 * MetricsRepository: Interface for persisting and updating upload session metrics.
 *
 * All metrics backends must implement this contract. Used by the business layer, not infrastructure.
 */
export interface MetricsRepository {
  /**
   * Initialize metrics for a new upload session.
   * 
   * @param metrics Initial SessionMetrics object
   */
  init(metrics: SessionMetrics): Promise<void>;
  /**
   * Update metrics for an existing session.
   * 
   * @param partial Partial update to SessionMetrics (must include uploadId)
   */
  update(partial: Partial<SessionMetrics>): Promise<void>;
  /**
   * Finalize and persist metrics for a completed session.
   * 
   * @param final Final SessionMetrics object
   */
  close(final: SessionMetrics): Promise<void>;
}