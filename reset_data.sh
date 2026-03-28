#!/bin/bash

# This script stops all services and wipes all stored data (Qdrant, PostgreSQL, and Videos)
# Use with caution!

echo "🛑 Stopping services and removing containers..."
docker compose down

echo "🧹 Cleaning up data directories..."
# Remove vector data
sudo rm -rf qdrant_data
# Remove postgres metadata
sudo rm -rf pg_data

echo "✨ Re-creating directories..."
mkdir -p qdrant_data pg_data

echo "🚀 Restarting infrastructure..."
docker compose up -d

echo "⏳ Waiting for PostgreSQL to initialize..."
sleep 5

echo "🔨 Initializing fresh database schema..."
# Activate conda manually if needed, but assuming user context is set
python -m src.db

echo "✅ Data reset complete! Your system is now clean and ready for new ingestions."
echo "You can now run ./start_server.sh to boot the model service and worker."
