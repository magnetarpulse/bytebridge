#!/bin/bash
set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' 

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

# Step 1: Build the frontend
print_header "Building Frontend"
print_status "Starting frontend build process..."
cd frontend
npm run build
cd ..
print_success "Frontend build completed successfully!"

# Step 2: Find the latest worker filenames
print_header "Detecting Worker Files"
print_status "Scanning for built worker files..."

WORKER2=$(ls static/frontend/assets/upload-web-worker-*.js | xargs -n1 basename)
WEBTRANSPORT_WORKER=$(ls static/frontend/assets/upload-webtransport-*.js 2>/dev/null | xargs -n1 basename || echo "")
MAINJS=$(ls static/frontend/assets/index-*.js | xargs -n1 basename)
MAINCSS=$(ls static/frontend/assets/index-*.css | xargs -n1 basename)

echo -e "${GREEN}✓${NC} encryption.worker: ${WORKER1}"
echo -e "${GREEN}✓${NC} encryption.streaming.worker: ${WORKER2}"
if [ -n "$WEBTRANSPORT_WORKER" ]; then
    echo -e "${GREEN}✓${NC} webtransport.streaming.worker: ${WEBTRANSPORT_WORKER}"
fi
echo -e "${GREEN}✓${NC} main JS: ${MAINJS}"
echo -e "${GREEN}✓${NC} main CSS: ${MAINCSS}"

# Step 3: Update templates/index.html
print_header "Updating Templates"
print_status "Generating new index.html template..."

INDEX_HTML="templates/index.html"
cat > "$INDEX_HTML" <<EOF
{% load static %}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ByteBridge</title>
    <link rel="stylesheet" href="{% static 'frontend/assets/$MAINCSS' %}">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="{% static 'frontend/assets/$MAINJS' %}"></script>
    <script>
      window.__WORKER_PATHS__ = {
        streamingWorker: "{% static 'workers/$WORKER2' %}",
EOF

if [ -n "$WEBTRANSPORT_WORKER" ]; then
cat >> "$INDEX_HTML" <<EOF
        webtransportWorker: "{% static 'workers/$WEBTRANSPORT_WORKER' %}"
EOF
fi

cat >> "$INDEX_HTML" <<EOF
      };
    </script>
</body>
</html>
EOF

print_success "Template updated successfully!"

# Step 4: Collect static files
print_header "Collecting Static Files"
print_status "Running Django collectstatic..."

print_status "Cleaning __pycache__ directories and .pyc/.pyo files..."
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete 2>/dev/null || true
find . -name "*.pyo" -delete 2>/dev/null || true
print_success "Cleanup completed."

python manage.py collectstatic --noinput

print_status "Final cleanup of __pycache__ directories and .pyc/.pyo files..."
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete 2>/dev/null || true
find . -name "*.pyo" -delete 2>/dev/null || true
print_success "Final cleanup completed."

print_header "Build Complete"
print_success "All done! Your ByteBridge application is ready to run."
print_success "To run the ByteBridge application, use: ./run_server_granian.sh --production"