/**
 * @file main.tsx
 * @description Entry point for the ByteBridge React application. Handles application bootstrapping, theme provider setup, and optional API mocking for development.
 *
 * This module is responsible for:
 * - Initializing the React application and mounting it to the DOM
 * - Conditionally enabling API mocking in development mode
 * - Providing application-wide theming via ThemeProvider
 *
 * Key Design Principles:
 * - Separation of environment-specific logic (mocking vs real API)
 * - Fail-fast on missing root element
 * - Minimal, professional logging for maintainability
 *
 * @example Application Startup
 * // No direct usage; this file is executed as the main entry point.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';
import { API_CONFIG } from './config/api';

/**
 * Logs development messages only in development mode.
 *
 * @param {string} message - The message to log
 * @param {'log' | 'info' | 'warn' | 'error'} [level='log'] - Log level
 * @internal
 * @sideeffects Writes to console in development mode
 */
function devLog(message: string, level: 'log' | 'info' | 'warn' | 'error' = 'log'): void {
  if (import.meta.env.DEV) {
    console[level](`[ByteBridge] ${message}`);
  }
}

/**
 * Logs the application configuration for debugging purposes.
 *
 * @internal
 * @sideeffects Writes configuration to console
 */
function logAppConfiguration(): void {
  const config = {
    environment: import.meta.env.MODE,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    viteUseMockApi: import.meta.env.VITE_USE_MOCK_API,
    viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
    apiConfigUseMockMode: API_CONFIG.useMockMode,
    apiConfigBaseUrl: API_CONFIG.baseUrl,
  };
  console.group('[ByteBridge] Application Configuration');
  console.table(config);
  console.groupEnd();
}

/**
 * Initializes API mocking in development mode if enabled.
 *
 * This function conditionally starts the Mock Service Worker (MSW) based on the current environment and the VITE_USE_MOCK_API environment variable. When enabled, all API requests are intercepted and handled by MSW, allowing development without a real backend.
 *
 * @returns {Promise<void>} Promise that resolves when mocking is initialized or skipped
 * @throws {Error} If MSW fails to start in development mode
 * @example
 * await enableMocking();
 */
async function enableMocking(): Promise<void> {
  logAppConfiguration();
  if (!import.meta.env.DEV) {
    // Production mode: do not enable mocking
    return;
  }
  if (import.meta.env.VITE_USE_MOCK_API !== 'false') {
    devLog('Loading Mock Service Worker...', 'info');
    try {
      const { startMockWorker } = await import('./mocks/browser');
      await startMockWorker();
      devLog('Mock API enabled. All requests will be intercepted.', 'info');
    } catch (error) {
      console.error('[ByteBridge] Failed to start Mock Service Worker:', error);
      throw error;
    }
  } else {
    devLog('Mock API disabled. Using real API endpoints at ' + API_CONFIG.baseUrl, 'info');
  }
}

/**
 * Application entry point. Initializes the React application, sets up theming, and optionally enables API mocking in development.
 *
 * @internal
 * @sideeffects Mounts React application to DOM, may enable API mocking in development
 */
enableMocking()
  .then(() => {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found. Ensure index.html contains a div with id="root"');
    }
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </React.StrictMode>
    );
    devLog('Application mounted successfully.', 'info');
  })
  .catch((error) => {
    console.error('[ByteBridge] Failed to initialize application:', error);
  });