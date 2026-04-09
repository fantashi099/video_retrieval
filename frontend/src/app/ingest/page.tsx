"use client";

import { useState, useEffect, useRef } from "react";
import { ingestVideoAction, getJobStatusAction, listJobsAction, deleteJobAction } from "../actions";
import { BatchUpload } from "./BatchUpload";

export default function IngestPage() {
    const [url, setUrl] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [jobs, setJobs] = useState<{ id: string, url: string, status: string, message: string }[]>([]);
    const pollingStarted = useRef(new Set<string>());

    const fetchRecentJobs = async () => {
        try {
            const res = await listJobsAction(5);
            if (res.jobs) {
                setJobs(res.jobs);
                // Start polling for any job that is not finished
                res.jobs.forEach((job: any) => {
                    if (job.status !== "INDEXED" && job.status !== "FAILED" && !pollingStarted.current.has(job.id)) {
                        pollJob(job.id);
                    }
                });
            }
        } catch (err) {
            console.error("Failed to fetch recent jobs", err);
        }
    };

    useEffect(() => {
        fetchRecentJobs();
    }, []);

    const handleIngest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;

        setIsSubmitting(true);
        setError(null);
        try {
            const response = await ingestVideoAction(url);
            if (response.error) {
                setError(response.error);
            } else {
                const newJob_id = response.job_id;
                setJobs((prev) => [{ id: newJob_id, url, status: "PENDING", message: response.message }, ...prev]);
                setUrl(""); // clear input

                // Start polling
                pollJob(newJob_id);
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred during ingestion.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const pollJob = (id: string) => {
        if (pollingStarted.current.has(id)) return;
        pollingStarted.current.add(id);

        const interval = setInterval(async () => {
            try {
                const st = await getJobStatusAction(id);
                if (st.error) {
                    setJobs((prev) => prev.map(j => j.id === id ? { ...j, status: "ERROR", message: st.error } : j));
                    clearInterval(interval);
                    pollingStarted.current.delete(id);
                    return;
                }

                setJobs((prev) => prev.map(j => j.id === id ? { ...j, status: st.status, message: st.message } : j));

                if (st.status === "INDEXED" || st.status === "FAILED") {
                    clearInterval(interval);
                    pollingStarted.current.delete(id);
                }
            } catch (err) {
                console.error("Polling error", err);
            }
        }, 3000);
    };

    const handleDeleteJob = async (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm("Remove this job from history?")) return;

        try {
            const res = await deleteJobAction(id);
            if (res.success) {
                setJobs((prev) => prev.filter(j => j.id !== id));
            } else {
                alert(`Error: ${res.message}`);
            }
        } catch (err: any) {
            console.error("Failed to delete job", err);
        }
    };

    return (
        <div className="flex flex-col items-center justify-start pt-12 min-h-[60vh] space-y-12">
            <div className="text-center space-y-4 max-w-2xl">
                <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                    Ingest Video
                </h1>
                <p className="text-lg text-slate-400">
                    Paste a YouTube URL below to download, segment, and index it into the database.
                </p>
            </div>

            <div className="w-full max-w-2xl relative">
                <form onSubmit={handleIngest} className="flex gap-4">
                    <input
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={isSubmitting}
                        className="flex-1 bg-slate-900 border border-slate-700/50 rounded-xl py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-transparent transition-all shadow-lg disabled:opacity-50"
                        placeholder="https://www.youtube.com/watch?v=..."
                        required
                    />
                    <button
                        type="submit"
                        disabled={isSubmitting || !url.trim()}
                        className="bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-teal-900/20 active:scale-95 flex items-center justify-center min-w-[140px]"
                    >
                        {isSubmitting ? (
                            <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            "Index Video"
                        )}
                    </button>
                </form>
            </div>

            {error && (
                <div className="w-full max-w-2xl p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200">
                    <p className="font-semibold">Ingestion Failed</p>
                    <p className="text-sm">{error}</p>
                </div>
            )}

            <BatchUpload />

            <div className="w-full max-w-3xl space-y-4">
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <h2 className="text-lg font-semibold text-slate-300">Ingestion History</h2>
                    <button
                        onClick={fetchRecentJobs}
                        className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
                    >
                        Refresh List
                    </button>
                </div>

                <div className="space-y-4">
                    {jobs.slice(0, 5).map((job) => (
                        <div key={job.id} className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-slate-700/50 p-5 group transition-all hover:border-teal-500/30 hover:shadow-2xl hover:shadow-teal-900/10">
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-slate-800 rounded-lg text-teal-400 group-hover:scale-110 transition-transform">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                        </div>
                                        <span className="text-sm font-semibold text-slate-100 truncate block mr-6" title={job.url}>
                                            {job.url}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-mono pl-8">
                                        <span>ID: {job.id}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0 self-end md:self-start pt-1 md:pt-0">
                                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter border flex items-center gap-2
                                        ${job.status === "INDEXED" ? "bg-emerald-900/20 text-emerald-400 border-emerald-500/30" :
                                            job.status === "FAILED" || job.status === "ERROR" ? "bg-red-900/20 text-red-400 border-red-500/30" :
                                                "bg-amber-900/20 text-amber-400 border-amber-500/30 animate-pulse"
                                        }
                                    `}>
                                        {job.status === "INDEXED" && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                        {(job.status === "FAILED" || job.status === "ERROR") && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                                        {job.status !== "INDEXED" && job.status !== "FAILED" && job.status !== "ERROR" && <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />}
                                        {job.status.replace("StatusEnum.", "").replace("JobStatus.", "")}
                                    </span>

                                    <button
                                        onClick={(e) => handleDeleteJob(job.id, e)}
                                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
                                        title="Remove from history"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                                    </button>
                                </div>
                            </div>

                            {/* Status Message Section */}
                            <div className="mt-4 pl-8 border-l border-slate-700/50">
                                <p className="text-xs text-slate-400 leading-relaxed break-words">
                                    <span className="text-slate-500 font-medium mr-2">Update:</span>
                                    {job.message || "Initializing job..."}
                                </p>
                            </div>
                        </div>
                    ))}

                    {!isSubmitting && jobs.length === 0 && (
                        <div className="text-center py-8 text-slate-500 italic text-sm">
                            No recent ingestion jobs found.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
