/**
 * @file metrics.ts
 * @description Data access layer for dashboard metrics.
 * Provides a hook for fetching dashboard statistics and metrics.
 * Currently uses mock data but designed to be easily replaced with real API calls.
 */

import { useState, useEffect } from 'react';
import metricsData from '../mocks/metrics.json';

/**
 * Represents a single metric displayed on the dashboard.
 */
export interface Metric {
  /** Display title of the metric */
  title: string;
  /** Current value of the metric */
  value: string;
  /** Change description or comparison text */
  change: string;
  /** Trend direction indicator */
  trend: 'up' | 'down' | 'neutral';
}

/**
 * Hook for fetching dashboard metrics data.
 * Currently loads from mock JSON file but structured to easily integrate with real API.
 * 
 * Future Implementation:
 * - Replace mock data import with API call
 * - Add caching/refetching logic
 * - Implement React Query or SWR for data fetching
 * 
 * @returns Object containing metrics data, loading state, and any errors
 * 
 * @example
 * ```tsx
 * const { data, loading, error } = useMetrics();
 * 
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 * return <MetricsDisplay metrics={data} />;
 * ```
 */
export const useMetrics = (): { data: Metric[] | null; loading: boolean; error: Error | null } => {
  /** Current metrics data, null until loaded */
  const [data, setData] = useState<Metric[] | null>(null);
  
  /** Loading state indicator */
  const [loading, setLoading] = useState<boolean>(true);
  
  /** Any error that occurred during fetch */
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    /**
     * Fetches metrics data asynchronously.
     * Simulates network delay for realistic behavior.
     */
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        setData(metricsData as Metric[]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch metrics'));
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  return { data, loading, error };
};
