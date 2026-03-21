import grpc
from concurrent import futures
import time
import logging
import torch
import transformers
from transformers import SiglipImageProcessor, SiglipModel, SiglipTokenizer
from PIL import Image
import io

from src.protos import model_service_pb2
from src.protos import model_service_pb2_grpc

transformers.logging.set_verbosity_error()

device = "cuda" if torch.cuda.is_available() else "cpu"
compute_dtype = torch.float16 if device == "cuda" else torch.float32

print(f"Loading SigLIP model for dedicated Model Service on {device} ({compute_dtype})...")
model_id = "google/siglip2-base-patch16-224"
siglip_model = SiglipModel.from_pretrained(
    model_id,
    attn_implementation='sdpa',
    torch_dtype=compute_dtype,
).to(device)
siglip_processor = SiglipImageProcessor.from_pretrained(model_id)
siglip_tokenizer = SiglipTokenizer.from_pretrained("google/siglip-base-patch16-224")

class ModelServiceServicer(model_service_pb2_grpc.ModelServiceServicer):
    
    def EmbedText(self, request, context):
        text = request.text
        if not text.strip():
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Text cannot be empty.")
            return model_service_pb2.EmbedTextResponse()
            
        try:
            inputs = siglip_tokenizer(text=[text], padding="max_length", return_tensors="pt").to(device)
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
                
                text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
                vector = text_features.cpu().numpy()[0].tolist()
                
            return model_service_pb2.EmbedTextResponse(embedding=vector)
        except Exception as e:
            logging.error(f"EmbedText error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return model_service_pb2.EmbedTextResponse()

    def EmbedImage(self, request, context):
        try:
            image = Image.open(io.BytesIO(request.image_data)).convert('RGB')
            inputs = siglip_processor(images=image, return_tensors="pt").to(device)
            
            with torch.no_grad():
                output = siglip_model.get_image_features(pixel_values=inputs.pixel_values.to(compute_dtype))
                
            if hasattr(output, 'image_embeds'):
                image_features = output.image_embeds
            elif hasattr(output, 'pooler_output'):
                image_features = output.pooler_output
            elif isinstance(output, tuple):
                image_features = output[0]
            else:
                image_features = output
                
            image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            vector = image_features.cpu().numpy()[0].tolist()
            
            return model_service_pb2.EmbedImageResponse(embedding=vector)
        except Exception as e:
            logging.error(f"EmbedImage error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return model_service_pb2.EmbedImageResponse()
            
    def EmbedImageBatch(self, request, context):
        try:
            images = [Image.open(io.BytesIO(img_bytes)).convert('RGB') for img_bytes in request.image_data_list]
            if not images:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("No images provided.")
                return model_service_pb2.EmbedImageBatchResponse()
                
            batch_size = 8
            all_vectors = []
            
            for i in range(0, len(images), batch_size):
                chunk = images[i:i + batch_size]
                inputs = siglip_processor(images=chunk, return_tensors="pt").to(device)
                
                with torch.no_grad():
                    output = siglip_model.get_image_features(pixel_values=inputs.pixel_values.to(compute_dtype))
                    
                if hasattr(output, 'image_embeds'):
                    image_features = output.image_embeds
                elif hasattr(output, 'pooler_output'):
                    image_features = output.pooler_output
                elif isinstance(output, tuple):
                    image_features = output[0]
                else:
                    image_features = output
                    
                image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
                chunk_vectors = image_features.cpu().numpy().tolist()
                all_vectors.extend(chunk_vectors)
                
                # Free VRAM for next chunk proactively
                del inputs, output, image_features
                torch.cuda.empty_cache()
            
            response = model_service_pb2.EmbedImageBatchResponse()
            for vec in all_vectors:
                emb = response.embeddings.add()
                emb.vector.extend(vec)
            
            return response
        except Exception as e:
            logging.error(f"EmbedImageBatch error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return model_service_pb2.EmbedImageBatchResponse()

def serve():
    options = [
        ('grpc.max_send_message_length', 100 * 1024 * 1024),
        ('grpc.max_receive_message_length', 100 * 1024 * 1024)
    ]
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10), options=options)
    model_service_pb2_grpc.add_ModelServiceServicer_to_server(ModelServiceServicer(), server)
    
    port = '50052'
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logging.info(f"Model Service gRPC running on port {port}...")
    
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    serve()
