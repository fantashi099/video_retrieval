import grpc
from concurrent import futures
import time
import logging

from src.protos import video_search_pb2
from src.protos import video_search_pb2_grpc

from src.db import SessionLocal
from src.models import Job, Video, StatusEnum
from src.tasks import download_video_task

from qdrant_client import QdrantClient

QDRANT_HOST = 'localhost'
QDRANT_PORT = 6333
QDRANT_COLLECTION = "video_segments_siglip"
qdrant_client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)

class VideoSearchServiceServicer(video_search_pb2_grpc.VideoSearchServiceServicer):
    
    def IngestVideo(self, request, context):
        video_url = request.video_url
        video_name = request.video_name
        logging.info(f"Received IngestVideo request for: {video_url} (name: {video_name})")
        
        db = SessionLocal()
        try:
            # Create a job synchronously to return the job_id
            job = Job(video_url=video_url, video_name=video_name, status=StatusEnum.PENDING)
            db.add(job)
            db.commit()
            db.refresh(job)
            
            job_id_str = str(job.id)
            
            # Fire the celery background task
            download_video_task.delay(video_url, job_id_str, video_name)
            
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

    def ParseBatchFile(self, request, context):
        import pandas as pd
        import io
        try:
            filename = request.filename.lower()
            file_bytes = io.BytesIO(request.file_content)
            
            if filename.endswith('.csv'):
                df = pd.read_csv(file_bytes)
            elif filename.endswith('.parquet'):
                df = pd.read_parquet(file_bytes)
            elif filename.endswith('.tsv') or filename.endswith('.txt'):
                df = pd.read_csv(file_bytes, sep='\t')
            else:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("Unsupported file format. Use .csv, .tsv, or .parquet")
                return video_search_pb2.ParseFileResponse(error_message="Unsupported file format")
                
            response = video_search_pb2.ParseFileResponse()
            
            # normalize columns to handle case differences
            df.columns = [c.lower().strip() for c in df.columns]
            
            if 'url' not in df.columns or 'video_name' not in df.columns:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("File must contain 'video_name' and 'url' columns.")
                return video_search_pb2.ParseFileResponse(error_message="Missing required columns")
                
            # Fill NaN values with empty string
            df = df.fillna('')
            for _, row in df.iterrows():
                name = str(row['video_name']).strip()
                url = str(row['url']).strip()
                if name and url:
                    vid = response.videos.add()
                    vid.video_name = name
                    vid.url = url
                    
            return response
        except Exception as e:
            logging.error(f"Error parsing file: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_search_pb2.ParseFileResponse(error_message=str(e))

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
            # 1. Embed the search text using ModelService microservice
            from src.protos import model_service_pb2, model_service_pb2_grpc
            with grpc.insecure_channel('localhost:50052') as channel:
                model_stub = model_service_pb2_grpc.ModelServiceStub(channel)
                embed_req = model_service_pb2.EmbedTextRequest(text=query_text)
                embed_res = model_stub.EmbedText(embed_req)
                
            if not embed_res.embedding:
                context.set_code(grpc.StatusCode.INTERNAL)
                context.set_details("Failed to get embedding from ModelService.")
                return response
                
            query_vector = list(embed_res.embedding)

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

    def ListVideos(self, request, context):
        logging.info("Received ListVideos request.")
        response = video_search_pb2.ListVideosResponse()
        db = SessionLocal()
        try:
            videos = db.query(Video).order_by(Video.created_at.desc()).all()
            for v in videos:
                info = response.videos.add()
                info.youtube_id = v.youtube_id
                info.title = v.title or ""
                info.url = v.url
                info.status = v.status.value if v.status else "UNKNOWN"
                info.duration = int(v.duration) if v.duration else 0
            return response
        except Exception as e:
            logging.error(f"Error listing videos: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return response
        finally:
            db.close()

    def DeleteVideo(self, request, context):
        youtube_id = request.youtube_id
        logging.info(f"Received DeleteVideo request for: {youtube_id}")
        
        db = SessionLocal()
        try:
            # 1. Delete vectors from Qdrant
            try:
                from qdrant_client.models import Filter, FieldCondition, MatchValue
                qdrant_client.delete(
                    collection_name=QDRANT_COLLECTION,
                    points_selector=Filter(
                        must=[FieldCondition(key="youtube_id", match=MatchValue(value=youtube_id))]
                    )
                )
                logging.info(f"Deleted vectors for {youtube_id} from Qdrant.")
            except Exception as e:
                logging.warning(f"Qdrant deletion warning (may not exist): {e}")

            # 2. Delete video record from PostgreSQL
            video = db.query(Video).filter(Video.youtube_id == youtube_id).first()
            if video:
                db.delete(video)

            # 3. Delete all related job records
            jobs = db.query(Job).filter(Job.video_url.contains(youtube_id)).all()
            for job in jobs:
                db.delete(job)

            db.commit()
            logging.info(f"Deleted all records for {youtube_id}.")
            
            return video_search_pb2.DeleteVideoResponse(
                success=True,
                message=f"Video {youtube_id} deleted successfully."
            )
        except Exception as e:
            logging.error(f"Error deleting video: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_search_pb2.DeleteVideoResponse(
                success=False,
                message=str(e)
            )
        finally:
            db.close()

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
