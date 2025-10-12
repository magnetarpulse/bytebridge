/**
 * Metrics system barrel export
 * 
 * Re-exports all metrics components for convenient importing:
 * - MetricsCollector: Main metrics collection facade
 * - MetricsRepository: Storage port interface
 * - InMemoryMetricsRepo: In-memory adapter implementation
 * - SessionMetrics: Domain model for session-level metrics
 */

export { MetricsCollector } from './metrics-collector';
export type { MetricsRepository } from './ports';
export { InMemoryMetricsRepo } from './adapters/in-memory-metrics-repo';
export type { SessionMetrics } from './models';
