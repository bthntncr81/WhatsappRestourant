#!/bin/bash
set -e

SERVER="root@37.247.101.231"
DEPLOY_DIR="/opt/whatres"

echo "=== WhatRes Deploy Script ==="

# Step 1: Create whatres_db in existing PostgreSQL
echo "[1/4] Creating database..."
ssh $SERVER "docker exec highfive-db psql -U highfive -d highfive_suite -c \"SELECT 1 FROM pg_database WHERE datname = 'whatres_db'\" | grep -q 1 || docker exec highfive-db psql -U highfive -d highfive_suite -c \"CREATE DATABASE whatres_db OWNER highfive;\""

# Step 2: Sync project files
echo "[2/4] Syncing files to server..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .nx \
  --exclude .angular \
  --exclude dist \
  --exclude .git \
  --exclude .claude \
  --exclude .env \
  --exclude .env.local \
  ./ $SERVER:$DEPLOY_DIR/

# Step 3: Copy .env if exists
if [ -f .env.production ]; then
  scp .env.production $SERVER:$DEPLOY_DIR/.env
fi

# Step 4: Build and start on server
echo "[3/4] Building Docker image..."
ssh $SERVER "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml build --no-cache"

echo "[4/4] Starting services..."
ssh $SERVER "cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml up -d"

echo "=== Deploy complete! ==="
echo "API running on port 3001"
ssh $SERVER "docker compose -f $DEPLOY_DIR/docker-compose.prod.yml ps"
