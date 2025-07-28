import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 5000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});