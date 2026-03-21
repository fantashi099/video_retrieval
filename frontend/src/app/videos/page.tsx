"use client";

import { useEffect, useState } from "react";
import { listVideosAction } from "../actions";

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

    const fetchVideos = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await listVideosAction();
            if (response.error) {
                setError(response.error);
            } else {
                setVideos(response.videos);
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred while fetching videos.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVideos();
    }, []);

    const formatDuration = (seconds: number) => {
        const min = Math.floor(seconds / 60);
        const sec = seconds % 60;
        return `${min}:${sec.toString().padStart(2, "0")}`;
    };

    return (
        <div className="flex flex-col items-center justify-start pt-12 min-h-[60vh] space-y-12">
            <div className="text-center space-y-4 max-w-2xl">
                <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Indexed Videos
                </h1>
                <p className="text-lg text-slate-400">
                    A full repository of every video ingested and encoded in the database.
                </p>
            </div>

            <div className="w-full max-w-4xl space-y-6">
                <div className="flex justify-between items-center border-b border-white/10 pb-4">
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
                    <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200">
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
                                </div>
                            </div>
                        </div>
                    ))}
                    {loading && videos.length === 0 && (
                        <div className="col-span-full h-32 flex items-center justify-center text-slate-500">
                            <span className="animate-pulse">Loading videos...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
