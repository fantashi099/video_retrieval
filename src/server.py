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
            force = getattr(request, 'force', False)
            download_video_task.delay(video_url, job_id_str, video_name, force=force)
            
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

    def ListJobs(self, request, context):
        limit = request.limit if request.limit > 0 else 10
        logging.info(f"Received ListJobs request (limit: {limit})")
        
        db = SessionLocal()
        try:
            jobs = db.query(Job).order_by(Job.created_at.desc()).limit(limit).all()
            response = video_search_pb2.ListJobsResponse()
            
            for j in jobs:
                job_info = response.jobs.add()
                job_info.id = str(j.id)
                job_info.url = j.video_url
                job_info.status = j.status.value if j.status else "UNKNOWN"
                job_info.message = j.error_log if j.error_log else ""
                job_info.video_name = j.video_name if j.video_name else ""
                
            return response
        except Exception as e:
            logging.error(f"Error listing jobs: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_search_pb2.ListJobsResponse()
        finally:
            db.close()

    def SearchVideo(self, request, context):
        query_text = request.query_text
        image_data = request.image_data
        limit = request.limit if request.limit > 0 else 5
        
        is_image_search = len(image_data) > 0
        logging.info(f"Received SearchVideo request (mode: {'image' if is_image_search else 'text'}, limit: {limit})")
        
        response = video_search_pb2.SearchResponse()
        
        if not is_image_search and not query_text.strip():
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Query text or image must be provided.")
            return response
            
        try:
            from src.protos import model_service_pb2, model_service_pb2_grpc
            
            # 1. Get query embedding (text or image)
            with grpc.insecure_channel('localhost:50052') as channel:
                model_stub = model_service_pb2_grpc.ModelServiceStub(channel)
                
                if is_image_search:
                    embed_req = model_service_pb2.EmbedImageRequest(image_data=image_data)
                    embed_res = model_stub.EmbedImage(embed_req)
                else:
                    embed_req = model_service_pb2.EmbedTextRequest(text=query_text)
                    embed_res = model_stub.EmbedText(embed_req)
                
            if not embed_res.embedding:
                context.set_code(grpc.StatusCode.INTERNAL)
                context.set_details("Failed to get embedding from ModelService.")
                return response
                
            query_vector = list(embed_res.embedding)

            # 2. Search Qdrant
            search_results = qdrant_client.query_points(
                collection_name=QDRANT_COLLECTION,
                query=query_vector,
                limit=limit * 3 if not is_image_search else limit
            ).points
            
            # 3. Reranking (text search only — metadata boosting doesn't apply to image similarity)
            if not is_image_search and query_text.strip():
                query_lower = query_text.lower()
                query_words = set(query_lower.split())
                
                for hit in search_results:
                    ocr = hit.payload.get("ocr_text", "").lower()
                    asr = hit.payload.get("asr_text", "").lower()
                    tags = [t.lower() for t in hit.payload.get("tags", [])]
                    
                    if query_lower in ocr or query_lower in asr:
                        hit.score += 0.2
                    if any(w in tags for w in query_words):
                        hit.score += 0.15

                search_results.sort(key=lambda x: x.score, reverse=True)
                search_results = search_results[:limit]
            
            # 4. Format Response
            for hit in search_results:
                result = response.results.add()
                result.youtube_id = hit.payload.get("youtube_id", "")
                result.scene_idx = hit.payload.get("scene_idx", 0)
                result.start_time = hit.payload.get("start_time", 0.0)
                result.end_time = hit.payload.get("end_time", 0.0)
                result.match_score = hit.score
                result.video_name = hit.payload.get("video_name", "")
                result.ocr_text = hit.payload.get("ocr_text", "")
                result.asr_text = hit.payload.get("asr_text", "")
                result.tags.extend(hit.payload.get("tags", []))
                
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

    def DeleteJob(self, request, context):
        job_id = request.job_id
        logging.info(f"Received DeleteJob request for: {job_id}")
        
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if not job:
                # If job not found, we still return success=True to avoid UI confusion
                # (maybe it was already deleted)
                return video_search_pb2.DeleteJobResponse(
                    success=True,
                    message="Job already removed."
                )
            
            db.delete(job)
            db.commit()
            logging.info(f"Deleted job {job_id}.")
            
            return video_search_pb2.DeleteJobResponse(
                success=True,
                message="Job removed from history."
            )
        except Exception as e:
            logging.error(f"Error deleting job: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_search_pb2.DeleteJobResponse(success=False, message=str(e))
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
