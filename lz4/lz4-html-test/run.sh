#!/bin/bash

# run.sh - LZ4 Tool Launcher
# Serves index.html from the current directory

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PORT=8000

# Function to find an available port
find_available_port() {
    local port=$1
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
        echo -e "${YELLOW}Port $port is in use, trying $((++port))...${NC}" >&2
    done
    echo $port
}

# Function to open the browser with fallback
open_browser() {
    local url=$1
    case "$OSTYPE" in
        darwin*)
            if command -v open > /dev/null 2>&1; then
                open "$url"
            else
                echo -e "${YELLOW}Please open: $url${NC}"
            fi
            ;;
        linux*)
            if command -v xdg-open > /dev/null 2>&1; then
                xdg-open "$url"
            elif command -v firefox > /dev/null 2>&1; then
                firefox "$url"
            elif command -v google-chrome > /dev/null 2>&1; then
                google-chrome "$url"
            else
                echo -e "${YELLOW}Please open: $url${NC}"
            fi
            ;;
        msys*|cygwin*)
            if command -v start > /dev/null 2>&1; then
                start "$url"
            else
                echo -e "${YELLOW}Please open: $url${NC}"
            fi
            ;;
        *)
            echo -e "${YELLOW}Please open: $url${NC}"
            ;;
    esac
}

# Check if index.html exists in current directory
if [ ! -f "index.html" ]; then
    echo -e "${RED}Error: index.html not found in current directory${NC}" >&2
    exit 1
fi

# Check if Python is available
if ! command -v python3 > /dev/null 2>&1; then
    echo -e "${RED}Error: Python3 is not installed or not in PATH${NC}" >&2
    exit 1
fi

# Find available port
AVAILABLE_PORT=$(find_available_port $PORT)

# Start server in background
echo -e "${GREEN}Starting server on port $AVAILABLE_PORT...${NC}"
python3 -m http.server $AVAILABLE_PORT &
SERVER_PID=$!

# Wait for server to start
sleep 1

# Check if server is running
if kill -0 $SERVER_PID 2>/dev/null; then
    URL="http://localhost:$AVAILABLE_PORT/index.html"
    echo -e "${GREEN}LZ4 Tool running at: $URL${NC}"
    echo -e "${BLUE}PID: $SERVER_PID (Press Ctrl+C to stop)${NC}"
    
    # Open browser automatically
    open_browser "$URL"
    
    # Trap to handle cleanup
    trap 'kill $SERVER_PID 2>/dev/null; echo -e "\n${GREEN}Server stopped${NC}"; exit' INT TERM
    wait $SERVER_PID
else
    echo -e "${RED}Failed to start server${NC}" >&2
    exit 1
fi