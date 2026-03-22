#!/bin/bash
# Clean up background processes when this script stops
trap 'echo "Stopping services..."; kill $(jobs -p) 2>/dev/null; exit' SIGINT SIGTERM EXIT

# echo "Resetting database..."
# sudo rm -rf pg_data

echo "Stopping containers..."
docker compose down

echo "Starting Docker containers..."
docker compose up -d

echo "Waiting for PostgreSQL to boot..."
sleep 5

echo "Initializing database tables..."
python -m src.db

echo "Starting Model Service..."
python -m src.model_service &

echo "Starting Celery worker..."
python -m celery -A src.celery_app worker -B --loglevel=info
