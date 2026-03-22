# Aura Farming Video Retrieval System

A scalable video ingestion, scene detection, and retrieval platform. Powered by **TransNetV2** for intelligent scene segmentation and Google's **SigLIP 2** for text-to-video semantic search. The system uses a highly efficient microservice architecture built with Python, Celery, gRPC, and Qdrant.

## Key Features

- **Automated Video Ingestion**: Downloads YouTube videos via `yt-dlp`.
- **Intelligent Scene Detection**: Extracts keyframes using `TransNetV2` to accurately segment videos into scenes.
- **Multimodal Search**: Uses `SigLIP 2` to batch-embed visual frames and map natural language text queries to video segments.
- **Scalable Microservices**: Decouples GPU-heavy inference into a dedicated Model gRPC Service, offloading ingestion to Celery background workers.

## Tech Stack

- **Language**: Python (Conda environment required)
- **Databases**: Qdrant (Vector DB), PostgreSQL (Metadata DB), Redis (Message Broker)
- **Frameworks**: gRPC, Celery, SQLAlchemy, FastAPI (Client)
- **ML Models**: PyTorch, Transformers, SigLIP 2, TransNetV2
- **Containerization**: Docker Compose

## Prerequisites

- Docker and Docker Compose
- Conda (Anaconda / Miniconda)
- NVIDIA GPU (Recommended for timely ML inference)

---

## Getting Started

### 1. Environment Setup

It is required to use the Conda environment named `aura_retrieval` to run this project smoothly.

```bash
# Create and activate the conda environment
conda create -n aura_retrieval python=3.10 -y
conda activate aura_retrieval

# Install the necessary Python dependencies
pip install -r requirements.txt
```

### 2. Compile gRPC Protobufs

The system relies on gRPC for lightning-fast inter-service communication (like passing arrays of image bytes to the inference service). You must compile the `.proto` files inside your conda environment:

```bash
make proto
```
*(This generates the necessary `_pb2.py` and `_pb2_grpc.py` files in `src/protos/`)*.

### 3. Start the Infrastructure Databases

Start Qdrant, PostgreSQL, and Redis in the background using Docker Compose:

```bash
docker compose up -d
```
*(Wait a few seconds for PostgreSQL to accept connections).*

### 4. Start the Services

We have provided a bootstrap script that initializes the Postgres schema, kicks off the dedicated Model Service on port `50052`, and starts the Celery worker for background jobs.

```bash
chmod +x start_server.sh
./start_server.sh
```

### 5. Launch the Public API

In a separate terminal (with your `aura_retrieval` environment activated), start the main API Server. This server accepts search requests on port `50051`.

```bash
conda activate aura_retrieval
python -m src.server
```

### 6. Frontend Setup

The frontend is a Next.js application that provides a user interface for search and video management.

```bash
cd frontend
npm install
npm run dev
```
*(Open [http://localhost:3000](http://localhost:3000) in your browser to access the UI).*

---

## Architecture Overview

1. **`src/server.py`**: The public-facing gRPC server (`VideoSearchService`). It handles incoming client searches, creates database jobs, and triggers Celery workers.
2. **`src/model_service.py`**: The isolated GPU Model Service (`ModelService`). It keeps the massive SigLIP model stored in VRAM only once, processing high-speed batch text and image embedding requests. 
3. **`src/tasks.py`**: The Celery background worker. It downloads videos, runs TransNetV2 to find scenes, passes frames via gRPC to the Model Service, and stores the resulting embedding vectors in Qdrant.
4. **`src/db.py` & `src/models.py`**: SQLAlchemy setups for maintaining state, such as video metadata, job statuses, and error tracking in Postgres.
5. **`frontend/`**: Next.js web application for searching and viewing video segments.

## Testing 

You can test the ingestion and search endpoints using the provided test client:
```bash
python test_client.py
```
