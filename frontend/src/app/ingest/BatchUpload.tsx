'use client';

import { useState } from 'react';
import { parseFileAction, ingestVideoAction, getJobStatusAction } from '../actions';

interface ParsedVideo {
    video_name: string;
    url: string;
}

interface JobStatus {
    id: string;
    video_name: string;
    url: string;
    status: string;
    message?: string;
}

export function BatchUpload() {
    const [file, setFile] = useState<File | null>(null);
    const [parsedVideos, setParsedVideos] = useState<ParsedVideo[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [jobs, setJobs] = useState<JobStatus[]>([]);
    const [processLimit, setProcessLimit] = useState<number | 'ALL'>('ALL');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setParsedVideos([]);
            setParseError(null);
            setJobs([]);
        }
    };

    const handleParse = async () => {
        if (!file) return;
        setIsParsing(true);
        setParseError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await parseFileAction(formData);
            if (res.error) {
                setParseError(res.error);
            } else {
                setParsedVideos(res.videos);
            }
        } catch (err: any) {
            setParseError(err.message || 'Error parsing file.');
        } finally {
            setIsParsing(false);
        }
    };

    const handleProcessAll = async () => {
        if (parsedVideos.length === 0) return;
        setIsProcessing(true);

        let newJobs: JobStatus[] = [];

        // Determine which videos to process based on limit
        const videosToProcess = processLimit === 'ALL' ? parsedVideos : parsedVideos.slice(0, processLimit);

        // Fire ingestion for selected videos sequentially to respect backend logic
        for (const video of videosToProcess) {
            try {
                const res = await ingestVideoAction(video.url, video.video_name);
                if (res.error) {
                    newJobs.push({ id: `error-${Date.now()}-${Math.random()}`, video_name: video.video_name, url: video.url, status: 'FAILED', message: res.error });
                } else {
                    newJobs.push({ id: res.job_id, video_name: video.video_name, url: video.url, status: 'PENDING', message: res.message });
                }
            } catch (err: any) {
                newJobs.push({ id: `error-${Date.now()}-${Math.random()}`, video_name: video.video_name, url: video.url, status: 'FAILED', message: err.message });
            }
        }

        setJobs(newJobs);
        setIsProcessing(false);

        // Start polling for valid jobs
        newJobs.forEach(job => {
            if (job.status !== 'FAILED') pollJob(job.id);
        });
    };

    const pollJob = (id: string) => {
        const interval = setInterval(async () => {
            try {
                const st = await getJobStatusAction(id);
                if (st.error) {
                    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "ERROR", message: st.error } : j));
                    clearInterval(interval);
                    return;
                }
                setJobs(prev => prev.map(j => j.id === id ? { ...j, status: st.status, message: st.message } : j));
                if (st.status === "INDEXED" || st.status === "FAILED" || st.status === "ERROR") {
                    clearInterval(interval);
                }
            } catch (err) {
                console.error("Polling error", err);
            }
        }, 3000);
    };

    return (
        <div className="w-full max-w-4xl space-y-6 mt-12 bg-slate-900/50 p-6 rounded-2xl border border-slate-700/50 shadow-xl mb-12">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Batch File Upload</h2>
            <p className="text-slate-400">Upload a <code className="bg-slate-800 px-1.5 py-0.5 rounded text-indigo-300">.csv</code>, <code className="bg-slate-800 px-1.5 py-0.5 rounded text-indigo-300">.tsv</code>, or <code className="bg-slate-800 px-1.5 py-0.5 rounded text-indigo-300">.parquet</code> file with <code className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-200">video_name</code> and <code className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-200">url</code> columns to process recordings in bulk.</p>

            <div className="flex items-center gap-4">
                <input
                    type="file"
                    accept=".csv,.tsv,.txt,.parquet"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-indigo-900/30 file:text-indigo-400 hover:file:bg-indigo-900/50 transition-colors"
                />
                <button
                    onClick={handleParse}
                    disabled={!file || isParsing}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors shrink-0 shadow-lg"
                >
                    {isParsing ? 'Parsing...' : 'Parse Data'}
                </button>
            </div>

            {parseError && (
                <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200">
                    <p className="font-semibold">Parse Error</p>
                    <p className="text-sm">{parseError}</p>
                </div>
            )}

            {parsedVideos.length > 0 && jobs.length === 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h3 className="text-lg font-semibold text-slate-300">Preview Data ({parsedVideos.length} items)</h3>
                            <select
                                value={processLimit}
                                onChange={(e) => setProcessLimit(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                                disabled={isProcessing}
                                className="bg-slate-800 text-slate-200 border border-slate-700/50 rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="ALL">All ({parsedVideos.length})</option>
                                <option value={10}>First 10</option>
                                <option value={50}>First 50</option>
                                <option value={100}>First 100</option>
                            </select>
                        </div>
                        <button
                            onClick={handleProcessAll}
                            disabled={isProcessing}
                            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-2 px-6 rounded-xl transition-colors shadow-lg"
                        >
                            {isProcessing ? 'Enqueuing...' : `Ingest ${processLimit === 'ALL' ? 'All' : processLimit} Videos`}
                        </button>
                    </div>

                    <div className="max-h-80 overflow-y-auto w-full border border-slate-700/50 rounded-xl shadow-inner scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                        <table className="w-full text-sm text-left text-slate-400">
                            <thead className="bg-slate-800 text-xs text-slate-300 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-6 py-4 font-semibold w-1/4">Custom Name</th>
                                    <th className="px-6 py-4 font-semibold">Video URL</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {parsedVideos.map((vid, idx) => (
                                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-indigo-300 truncate max-w-[200px]">{vid.video_name}</td>
                                        <td className="px-6 py-4 truncate max-w-md">{vid.url}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {jobs.length > 0 && (
                <div className="space-y-4 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h3 className="text-lg font-semibold border-b border-white/10 pb-2 text-slate-300">Batch Processing Status</h3>
                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                        {jobs.map((job) => (
                            <div key={job.id} className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-slate-700/50 p-5 group transition-all hover:border-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-900/10">
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 bg-slate-800 rounded-lg text-indigo-400 group-hover:scale-110 transition-transform">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>
                                            </div>
                                            <span className="text-sm font-semibold text-slate-100 truncate block uppercase tracking-tight" title={job.video_name}>
                                                {job.video_name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono pl-8 truncate" title={job.url}>
                                            <span>URL: {job.url}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0 self-end md:self-start pt-1 md:pt-0">
                                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter border flex items-center gap-2
                                            ${job.status === "INDEXED" ? "bg-emerald-900/20 text-emerald-400 border-emerald-500/30" :
                                                job.status === "FAILED" || job.status === "ERROR" ? "bg-red-900/20 text-red-400 border-red-500/30" :
                                                    "bg-indigo-900/20 text-indigo-400 border-indigo-500/30 animate-pulse"
                                            }
                                        `}>
                                            {job.status === "INDEXED" && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                            {(job.status === "FAILED" || job.status === "ERROR") && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                                            {job.status !== "INDEXED" && job.status !== "FAILED" && job.status !== "ERROR" && <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />}
                                            {job.status}
                                        </span>
                                    </div>
                                </div>

                                {/* Status Message Section */}
                                <div className="mt-4 pl-8 border-l border-slate-700/50">
                                    <p className="text-xs text-slate-400 leading-relaxed break-words">
                                        <span className="text-slate-500 font-medium mr-2">Status:</span>
                                        {job.message || "Processing..."}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
