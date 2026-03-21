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

export async function ingestVideoAction(url: string): Promise<any> {
    return new Promise((resolve) => {
        grpcClient.IngestVideo({ video_url: url }, (err: any, response: any) => {
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
