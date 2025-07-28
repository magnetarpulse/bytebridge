import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 10000, // Global timeout for individual tests
  // Global expect timeout - assertions should complete quickly
  expect: {
    timeout: 3000, // Keep expect assertions fast - 3s timeout
  },
  use: {
    headless: true,  // Set to true for CI environments
    // Set up a web server to serve our source files
    baseURL: 'http://localhost:5174', // Using 5174 as we saw Vite using this port
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5000, // Allow actions more time
    navigationTimeout: 10000, // Allow more time for page navigation
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  workers: 1,  // Run tests sequentially for Web Worker tests
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  retries: 1,  // Retry flaky tests once
  fullyParallel: false,  // Don't run tests in parallel
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
