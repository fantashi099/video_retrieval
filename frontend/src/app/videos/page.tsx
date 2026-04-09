"use client";

import { useEffect, useState } from "react";
import { listVideosAction, deleteVideoAction, ingestVideoAction } from "../actions";

interface VideoInfo {
    youtube_id: string;
    title: string;
    url: string;
    status: string;
    duration: number;
}

export default function VideosPage() {
    const [videos, setVideos] = useState<VideoInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    const fetchVideos = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listVideosAction();
            if (res.error) {
                setError(res.error);
            } else {
                setVideos(res.videos || []);
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVideos();
    }, []);

    const formatDuration = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col space-y-8 max-w-6xl mx-auto px-4 py-8">
            <div className="flex flex-col space-y-4">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                        Indexed Videos
                    </h1>
                </div>
                <p className="text-slate-400">
                    A list of all YouTube videos that have been downloaded, segmented, and embedded in the vector database.
                </p>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-xl font-semibold">Total: {videos.length} videos</h2>
                    <button
                        onClick={fetchVideos}
                        disabled={loading}
                        className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-2 px-4 rounded-lg transition-colors border border-slate-700 disabled:opacity-50"
                    >
                        {loading ? "Refreshing..." : "Refresh"}
                    </button>
                </div>

                {error && (
                    <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200 mb-6">
                        <p className="font-semibold">Failed to load videos</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {videos.map((video) => (
                        <div key={video.youtube_id} className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-lg flex flex-col">
                            <div className="relative aspect-video bg-black shrink-0">
                                <img
                                    src={`https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`}
                                    alt={video.title || video.youtube_id}
                                    className="w-full h-full object-cover opacity-80"
                                />
                                <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-mono font-medium backdrop-blur-sm">
                                    {formatDuration(video.duration)}
                                </div>
                            </div>
                            <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                                <div>
                                    <h3 className="font-semibold line-clamp-2 text-sm leading-tight text-slate-200" title={video.title || "Unknown Title"}>
                                        {video.title || "Unknown Title"}
                                    </h3>
                                    <a href={video.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
                                        {video.youtube_id} &rarr;
                                    </a>
                                </div>
                                <div className="flex items-center justify-between mt-auto">
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border
                    ${video.status === "INDEXED" ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50" :
                                            video.status === "FAILED" || video.status === "ERROR" ? "bg-red-900/30 text-red-400 border-red-800/50" :
                                                "bg-yellow-900/30 text-yellow-400 border-yellow-800/50"
                                        }
                  `}>
                                        {video.status}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={async () => {
                                                if (!confirm(`Reprocess "${video.title || video.youtube_id}" to update metadata?`)) return;
                                                setDeleting(video.youtube_id);
                                                const res = await ingestVideoAction(video.url, video.title, true);
                                                setDeleting(null);
                                                if (res.error) {
                                                    setError(res.error);
                                                } else {
                                                    alert("Reprocessing started! Check ingest tab for status.");
                                                    window.location.href = "/ingest";
                                                }
                                            }}
                                            disabled={!!deleting}
                                            className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border bg-indigo-900/30 text-indigo-400 border-indigo-800/50 hover:bg-indigo-800/50 transition-colors disabled:opacity-50"
                                        >
                                            {deleting === video.youtube_id ? 'Starting...' : 'Reprocess'}
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (!confirm(`Delete "${video.title || video.youtube_id}" and all its vectors?`)) return;
                                                setDeleting(video.youtube_id);
                                                const res = await deleteVideoAction(video.youtube_id);
                                                setDeleting(null);
                                                if (res.error) {
                                                    setError(res.error);
                                                } else {
                                                    setVideos(prev => prev.filter(v => v.youtube_id !== video.youtube_id));
                                                }
                                            }}
                                            disabled={!!deleting}
                                            className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border bg-red-900/30 text-red-400 border-red-800/50 hover:bg-red-800/50 transition-colors disabled:opacity-50"
                                        >
                                            {deleting === video.youtube_id ? 'Deleting...' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {loading && videos.length === 0 && (
                        <div className="col-span-full h-32 flex items-center justify-center text-slate-500">
                            <span className="animate-pulse">Loading videos...</span>
                        </div>
                    )}

                    {!loading && videos.length === 0 && (
                        <div className="col-span-full h-32 flex items-center justify-center text-slate-500 italic">
                            No videos indexed yet.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
