'use server'

import { grpcClient } from '@/lib/grpc';

export async function searchVideoAction(query: string, limit: number = 5): Promise<any> {
    return new Promise((resolve) => {
        grpcClient.SearchVideo({ query_text: query, limit }, (err: any, response: any) => {
            if (err) {
                console.error("gRPC Error in SearchVideo:", err);
                resolve({ error: err.message });
            } else {
                resolve({ results: response.results });
            }
        });
    });
}

export async function ingestVideoAction(url: string, videoName: string = ""): Promise<any> {
    return new Promise((resolve) => {
        grpcClient.IngestVideo({ video_url: url, video_name: videoName }, (err: any, response: any) => {
            if (err) {
                console.error("gRPC Error in IngestVideo:", err);
                resolve({ error: err.message });
            } else {
                resolve({ job_id: response.job_id, message: response.message });
            }
        });
    });
}

export async function getJobStatusAction(jobId: string): Promise<any> {
    return new Promise((resolve) => {
        grpcClient.GetJobStatus({ job_id: jobId }, (err: any, response: any) => {
            if (err) {
                console.error("gRPC Error in GetJobStatus:", err);
                resolve({ error: err.message });
            } else {
                resolve({ status: response.status, message: response.message });
            }
        });
    });
}

export async function listVideosAction(): Promise<any> {
    return new Promise((resolve) => {
        grpcClient.ListVideos({}, (err: any, response: any) => {
            if (err) {
                console.error("gRPC Error in ListVideos:", err);
                resolve({ error: err.message });
            } else {
                resolve({ videos: response.videos || [] });
            }
        });
    });
}

export async function parseFileAction(formData: FormData): Promise<any> {
    const file = formData.get('file') as File;
    if (!file) return { error: "No file provided" };

    try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        return new Promise((resolve) => {
            grpcClient.ParseBatchFile({
                file_content: buffer,
                filename: file.name
            }, (err: any, response: any) => {
                if (err) {
                    console.error("gRPC Error in ParseBatchFile:", err);
                    resolve({ error: err.message });
                } else if (response.error_message) {
                    resolve({ error: response.error_message });
                } else {
                    resolve({ videos: response.videos || [] });
                }
            });
        });
    } catch (e: any) {
        return { error: e.message };
    }
}
