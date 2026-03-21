import grpc
import sys
from src.protos import video_search_pb2
from src.protos import video_search_pb2_grpc
import time

def run():
    channel = grpc.insecure_channel('localhost:50051')
    stub = video_search_pb2_grpc.VideoSearchServiceStub(channel)
    
    video_url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
    if len(sys.argv) > 1:
        video_url = sys.argv[1]
        
    print(f"Sending IngestRequest for {video_url}...")
    try:
        response = stub.IngestVideo(video_search_pb2.IngestRequest(video_url=video_url))
        print(f"Response Message: {response.message}")
        print(f"Job ID: {response.job_id}")
        
        job_id = response.job_id
        
        # Poll for status
        for _ in range(10):
            status_response = stub.GetJobStatus(video_search_pb2.JobStatusRequest(job_id=job_id))
            print(f"Status: {status_response.status} - {status_response.message}")
            if status_response.status in ["COMPLETED", "FAILED", "INDEXED"]:
                break
            time.sleep(5)
            
        print("\n--- Testing Search ---")
        search_query = "a man speaking"
        print(f"Searching for: '{search_query}'")
        search_req = video_search_pb2.SearchRequest(query_text=search_query, limit=3)
        search_res = stub.SearchVideo(search_req)
        print(f"Found {len(search_res.results)} results:")
        for r in search_res.results:
            print(f" - {r.youtube_id} (Scene {r.scene_idx}) [{r.start_time:.1f}s - {r.end_time:.1f}s] Score: {r.match_score:.3f}")
            
    except grpc.RpcError as e:
        print(f"RPC failed: {e}")

if __name__ == '__main__':
    run()
