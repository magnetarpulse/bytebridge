#!/bin/bash
set -e

# Step 1: Build the frontend
echo "Building frontend..."
cd frontend
npm run build
cd ..

# Step 2: Find the latest worker filenames
WORKER1=$(ls static/frontend/assets/encryption.worker-*.js | xargs -n1 basename)
WORKER2=$(ls static/frontend/assets/encryption.streaming.worker-*.js | xargs -n1 basename)
MAINJS=$(ls static/frontend/assets/index-*.js | xargs -n1 basename)
MAINCSS=$(ls static/frontend/assets/index-*.css | xargs -n1 basename)

echo "Detected worker files:"
echo "  encryption.worker: $WORKER1"
echo "  encryption.streaming.worker: $WORKER2"
echo "  main JS: $MAINJS"
echo "  main CSS: $MAINCSS"

# Step 3: Update templates/index.html
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
    <link rel="preload" href="/workers/$WORKER1" as="worker" type="application/javascript" crossorigin>
    <link rel="preload" href="/workers/$WORKER2" as="worker" type="application/javascript" crossorigin>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="{% static 'frontend/assets/$MAINJS' %}"></script>
    <script>
      window.__WORKER_PATHS__ = {
        encryptionWorker: "/workers/$WORKER1",
        streamingWorker: "/workers/$WORKER2"
      };
    </script>
</body>
</html>
EOF

echo "Updated $INDEX_HTML with latest worker and asset filenames."

# Step 4: Collect static files
echo "Collecting static files with Django..."
. .venv/bin/activate
python manage.py collectstatic --noinput

echo "All done!"