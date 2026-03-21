import grpc
from concurrent import futures
import time
import logging

from src.protos import video_search_pb2
from src.protos import video_search_pb2_grpc

from src.db import SessionLocal
from src.models import Job, Video, StatusEnum
from src.tasks import download_video_task

import torch
import transformers
from transformers import AutoProcessor, SiglipModel, SiglipTokenizer
from qdrant_client import QdrantClient

transformers.logging.set_verbosity_error()

# Global Model Loading for Search
device = "cuda" if torch.cuda.is_available() else "cpu"
compute_dtype = torch.float16 if device == "cuda" else torch.float32

print(f"Loading SigLIP model for text search on {device} ({compute_dtype})...")
model_id = "google/siglip2-base-patch16-224"
siglip_model = SiglipModel.from_pretrained(
    model_id,
    attn_implementation='sdpa',
    torch_dtype=compute_dtype,
).to(device)

print("Loading SigLIP Tokenizer...")
siglip_tokenizer = SiglipTokenizer.from_pretrained("google/siglip-base-patch16-224")

QDRANT_HOST = 'localhost'
QDRANT_PORT = 6333
QDRANT_COLLECTION = "video_segments_siglip"
qdrant_client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)

class VideoSearchServiceServicer(video_search_pb2_grpc.VideoSearchServiceServicer):
    
    def IngestVideo(self, request, context):
        video_url = request.video_url
        logging.info(f"Received IngestVideo request for: {video_url}")
        
        db = SessionLocal()
        try:
            # Create a job synchronously to return the job_id
            job = Job(video_url=video_url, status=StatusEnum.PENDING)
            db.add(job)
            db.commit()
            db.refresh(job)
            
            job_id_str = str(job.id)
            
            # Fire the celery background task
            download_video_task.delay(video_url, job_id_str)
            
            return video_search_pb2.IngestResponse(
                job_id=job_id_str,
                message="Video ingestion started successfully."
            )
        except Exception as e:
            logging.error(f"Error during ingestion: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_search_pb2.IngestResponse(message="Internal error.")
        finally:
            db.close()

    def GetJobStatus(self, request, context):
        job_id = request.job_id
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if not job:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Job {job_id} not found.")
                return video_search_pb2.JobStatusResponse(status="NOT_FOUND", message="Job not found")
            
            # Convert python enum to string
            status_str = job.status.value if job.status else "UNKNOWN"
            message = job.error_log if job.error_log else "Job is processing or completed."
            
            return video_search_pb2.JobStatusResponse(
                status=status_str,
                message=message
            )
        finally:
            db.close()

    def SearchVideo(self, request, context):
        query_text = request.query_text
        limit = request.limit if request.limit > 0 else 5
        logging.info(f"Received SearchVideo request for: '{query_text}' (limit: {limit})")
        
        response = video_search_pb2.SearchResponse()
        
        if not query_text.strip():
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Query text cannot be empty.")
            return response
            
        try:
            # 1. Embed the search text using the tokenizer
            inputs = siglip_tokenizer(text=[query_text], padding="max_length", return_tensors="pt").to(device)
            with torch.no_grad():
                text_outputs = siglip_model.get_text_features(input_ids=inputs.input_ids)
                
                if hasattr(text_outputs, 'text_embeds'):
                    text_features = text_outputs.text_embeds
                elif hasattr(text_outputs, 'pooler_output'):
                    text_features = text_outputs.pooler_output
                elif isinstance(text_outputs, tuple):
                    text_features = text_outputs[0]
                else:
                    text_features = text_outputs
                
                # Normalize exactly like the image vectors
                text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
                query_vector = text_features.cpu().numpy()[0].tolist()

            # 2. Search Qdrant using the new query_points API
            search_results = qdrant_client.query_points(
                collection_name=QDRANT_COLLECTION,
                query=query_vector,
                limit=limit
            ).points
            
            # 3. Format Response
            for hit in search_results:
                result = response.results.add()
                result.youtube_id = hit.payload.get("youtube_id", "")
                result.scene_idx = hit.payload.get("scene_idx", 0)
                result.start_time = hit.payload.get("start_time", 0.0)
                result.end_time = hit.payload.get("end_time", 0.0)
                result.match_score = hit.score
                
            return response
            
        except Exception as e:
            logging.error(f"Search API error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return response

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    video_search_pb2_grpc.add_VideoSearchServiceServicer_to_server(VideoSearchServiceServicer(), server)
    
    # Listen on port 50051
    port = '50051'
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logging.info(f"gRPC Server running on port {port}...")
    
    try:
        # Keep alive
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    serve()
