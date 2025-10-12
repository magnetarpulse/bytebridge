/**
 * API Configuration for ByteBridge
 * 
 * This module handles API URL configuration and provides utilities for
 * switching between mock mode (for development) and hitting the real API(s).
 * 
 * @remarks
 * - Mock mode: Enabled by default in development, uses MSW to intercept requests
 * - Real mode: Set VITE_USE_MOCK_API=false to connect to actual API endpoints
 */

/**
 * Global API configuration object.
 * 
 * @property useMockMode - Whether to use Mock Service Worker for API calls
 * @property baseUrl - Base URL of the actual API endpoints (only used when MSW is disabled)
 */
export const API_CONFIG = {
  /**
   * Use mock mode in development to avoid hitting the real API endpoints.
   * Set VITE_USE_MOCK_API=false to hit the real API endpoints.
   */
  useMockMode: import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API !== 'false',
  
  /**
   * Base URL of the actual API endpoints.
   * Defaults to the production API if VITE_API_BASE_URL is not set.
   */
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'https://129.114.108.18:8000',
} as const;

/**
 * Constructs the correct API URL based on the current mode.
 * 
 * @remarks
 * - **Mock mode**: Returns relative URLs that MSW will intercept
 * - **Real mode**: Returns full URLs pointing to the actual API endpoints
 * 
 * @param path - The API path (e.g., '/users/login/' or 'users/login/')
 * @returns The complete URL for the API call
 * 
 * @example
 * ```typescript
 * // In mock mode: returns '/users/login/'
 * // In real mode: returns 'https://129.114.108.18:8000/users/login/'
 * const url = getApiUrl('/users/login/');
 * ```
 */
export function getApiUrl(path: string): string {
  // Normalize path to always start with '/'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // In mock mode, use relative URLs that MSW will intercept
  if (API_CONFIG.useMockMode) {
    return normalizedPath;
  }
  
  // In real mode, use the configured base URL
  return `${API_CONFIG.baseUrl}${normalizedPath}`;
}