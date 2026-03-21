"use client";

import { useState } from "react";
import { ingestVideoAction, getJobStatusAction } from "../actions";

export default function IngestPage() {
    const [url, setUrl] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [jobs, setJobs] = useState<{ id: string, url: string, status: string, message: string }[]>([]);

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
        const interval = setInterval(async () => {
            try {
                const st = await getJobStatusAction(id);
                if (st.error) {
                    setJobs((prev) => prev.map(j => j.id === id ? { ...j, status: "ERROR", message: st.error } : j));
                    clearInterval(interval);
                    return;
                }

                setJobs((prev) => prev.map(j => j.id === id ? { ...j, status: st.status, message: st.message } : j));

                if (st.status === "INDEXED" || st.status === "FAILED") {
                    clearInterval(interval);
                }
            } catch (err) {
                console.error("Polling error", err);
            }
        }, 3000);
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
                        className="bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors shrink-0 shadow-lg"
                    >
                        {isSubmitting ? "Submitting..." : "Index Video"}
                    </button>
                </form>
            </div>

            {error && (
                <div className="w-full max-w-2xl p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200">
                    <p className="font-semibold">Ingestion Failed</p>
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {jobs.length > 0 && (
                <div className="w-full max-w-3xl space-y-4">
                    <h2 className="text-lg font-semibold border-b border-white/10 pb-2 text-slate-300">Recent Jobs</h2>

                    <div className="space-y-3">
                        {jobs.map((job) => (
                            <div key={job.id} className="bg-slate-800/50 rounded-xl border border-slate-700 flex items-center justify-between p-4">
                                <div className="flex flex-col truncate pr-4">
                                    <span className="text-sm font-medium text-slate-200 truncate" title={job.url}>{job.url}</span>
                                    <span className="text-xs text-slate-500 mt-1">ID: {job.id}</span>
                                </div>

                                <div className="flex items-center shrink-0 space-x-4">
                                    <div className="text-xs text-right hidden sm:block">
                                        <span className="text-slate-400 max-w-[200px] truncate block">{job.message}</span>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border
                    ${job.status === "INDEXED" ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50" :
                                            job.status === "FAILED" || job.status === "ERROR" ? "bg-red-900/30 text-red-400 border-red-800/50" :
                                                "bg-yellow-900/30 text-yellow-400 border-yellow-800/50 animate-pulse"
                                        }
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
