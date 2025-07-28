#!/bin/bash

# Set maximum time to wait for server (in seconds)
MAX_WAIT_TIME=10

# Function to log with timestamps
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Start the Vite development server
log "Starting Vite development server..."
npm run dev &
VITE_PID=$!

# Wait for the server to be responsive
log "Waiting for server to start (max ${MAX_WAIT_TIME}s)..."
START_TIME=$(date +%s)
while ! curl -s http://localhost:5174 > /dev/null; do
  CURRENT_TIME=$(date +%s)
  ELAPSED_TIME=$((CURRENT_TIME - START_TIME))
  
  if [ $ELAPSED_TIME -ge $MAX_WAIT_TIME ]; then
    log "ERROR: Server failed to start in ${MAX_WAIT_TIME} seconds"
    log "Checking if server is running on a different port..."
    netstat -tlpn | grep -E 'vite|node'
    kill $VITE_PID 2>/dev/null || true
    exit 1
  fi
  
  log "Waiting for server to start (${ELAPSED_TIME}s elapsed)..."
  sleep 1
done

log "Server started successfully! Running on http://localhost:5174"

# Run the Playwright tests with a timeout
log "Running Playwright tests..."
log "Setting DEBUG=pw:api to see more detailed logs"
DEBUG=pw:api timeout 60s npx playwright test --config=playwright-workers.config.ts
PLAYWRIGHT_EXIT=$?

if [ $PLAYWRIGHT_EXIT -eq 124 ]; then
  log "ERROR: Tests timed out after 60 seconds"
  exit 1
elif [ $PLAYWRIGHT_EXIT -ne 0 ]; then
  log "ERROR: Tests failed with exit code $PLAYWRIGHT_EXIT"
else
  log "Tests completed successfully"
fi

# Clean up - kill the Vite server
log "Tests completed, cleaning up..."
kill $VITE_PID 2>/dev/null || true

exit $PLAYWRIGHT_EXIT
