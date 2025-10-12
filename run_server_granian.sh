#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
print_status() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

print_success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

print_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

# Activate venv if it exists
if [[ -d .venv ]]; then
    print_status "Activating virtual environment..."
    source .venv/bin/activate
    print_success "Virtual environment activated."
else
    print_warning "No virtual environment found at .venv"
fi

# Install granian if missing
print_status "Checking for Granian..."
if ! python -c "import granian" 2>/dev/null; then
    print_warning "Granian not found, installing..."
    pip install granian
    print_success "Granian installed successfully."
else
    print_success "Granian is already installed."
fi

mkdir -p logs
print_success "Logs directory created."

cleanup() {
    print_warning "Shutting down ByteBridge..."

    # Method 1: Try graceful shutdown using pkill
    if pkill -TERM -f granian; then
        print_status "Sent TERM signal to granian processes, waiting for graceful shutdown..."
        sleep 3
    fi

    # Method 2: Force kill any remaining granian processes
    if pkill -KILL -f granian 2>/dev/null; then
        print_warning "Force killed remaining granian processes"
    fi

    # Method 3: Fallback - kill by port (if pkill didn't work)
    pids=$(lsof -t -i :8000 2>/dev/null || true)
    if [ -n "$pids" ]; then
        print_warning "Killing remaining processes on port 8000: $pids"
        kill -KILL $pids 2>/dev/null || true
    fi
}

trap cleanup INT TERM EXIT

print_header "Starting ByteBridge with Granian"

print_status "Initializing server configuration..."

# Default values
SSL_ARGS=()

# Collect remaining arguments, skipping --production
REST_ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--production" ]]; then
        print_success "Running in PRODUCTION mode with SSL enabled."
        SSL_ARGS=(--ssl-certificate ./certs/fullchain.pem --ssl-keyfile ./certs/privkey.pem)
        # Do NOT add --production to REST_ARGS
    else
        REST_ARGS+=("$arg")
    fi
done

print_status "Server configuration complete."
print_status "Launching Granian server..."
print_status "Host: 0.0.0.0, Port: 8000, Workers: 4, Log Level: warning"

# Start granian with appropriate flags
exec granian \
    --interface asgi \
    bytebridge.asgi:application \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4 \
    --log-level warning \
    "${SSL_ARGS[@]}" \
    "${REST_ARGS[@]}"