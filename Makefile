.PHONY: proto
proto:
	python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. src/protos/video_search.proto
	python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. src/protos/model_service.proto
