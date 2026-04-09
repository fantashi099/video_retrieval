#!/bin/bash
# Clean up background processes when this script stops
cleanup() {
    echo "Stopping services..."
    # Kill all background jobs
    jobs -p | xargs -r kill 2>/dev/null
    # Stop Docker containers
    docker compose down
    exit
}

trap cleanup SIGINT SIGTERM EXIT

echo "Stopping containers..."
docker compose down

echo "Starting Docker containers..."
docker compose up -d

echo "Waiting for PostgreSQL to boot..."
sleep 5

echo "Initializing database tables..."
eval "$(conda shell.bash hook)"
conda activate aura_retrieval
python -m src.db

echo "Starting Model Service..."
python -m src.model_service &

echo "Starting Celery worker with Beat..."
python -m celery -A src.celery_app worker -B --loglevel=info &

# Wait for all background jobs
wait
