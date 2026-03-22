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
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                        {jobs.map((job) => (
                            <div key={job.id} className="bg-slate-800/50 rounded-xl border border-slate-700 flex items-center justify-between p-4 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex flex-col truncate pr-4 w-[60%]">
                                    <span className="text-sm font-bold text-indigo-300 truncate">{job.video_name}</span>
                                    <span className="text-xs text-slate-400 truncate mt-1">{job.url}</span>
                                </div>

                                <div className="flex items-center shrink-0 space-x-4">
                                    <div className="text-xs text-right hidden sm:block">
                                        <span className="text-slate-400 max-w-[200px] truncate block">{job.message || job.status}</span>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border
                                        ${job.status === "INDEXED" ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50" :
                                            job.status === "FAILED" || job.status === "ERROR" ? "bg-red-900/30 text-red-400 border-red-800/50" :
                                                "bg-yellow-900/30 text-yellow-400 border-yellow-800/50 animate-pulse"}
                                    `}>
                                        {job.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
