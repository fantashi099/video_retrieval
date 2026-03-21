#!/bin/bash

echo "Starting server reset..."
sudo rm -rf pg_data
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
python -m celery -A src.celery_app worker --loglevel=info
