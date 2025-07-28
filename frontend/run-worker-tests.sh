#!/bin/bash

# Script to run the ParallelEncryptionManager end-to-end tests

echo "Running ParallelEncryptionManager tests with real Web Workers..."

# Ensure playwright is installed
if ! command -v npx &> /dev/null || ! npx playwright --version &> /dev/null; then
  echo "Installing Playwright browsers..."
  npx playwright install chromium
fi

# Run the tests with special worker config
npx playwright test --config=playwright-workers.config.ts
