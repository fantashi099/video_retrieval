"use client";

import { useState } from "react";
import { searchVideoAction } from "./actions";

export default function Home() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);
    try {
      const response = await searchVideoAction(query, 5);
      if (response.error) {
        setError(response.error);
      } else {
        setResults(response.results || []);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during search.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start pt-12 min-h-[60vh] space-y-12">
      <div className="text-center space-y-4 max-w-2xl">
        <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
          Semantic Video Search
        </h1>
        <p className="text-lg text-slate-400">
          Instantly find specific scenes in your videos using natural language queries powered by SigLIP embeddings.
        </p>
      </div>

      <div className="w-full max-w-2xl relative">
        <form onSubmit={handleSearch}>
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isSearching}
            className="w-full bg-slate-900 border border-slate-700/50 rounded-2xl py-4 pl-12 pr-24 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all shadow-xl disabled:opacity-50"
            placeholder="Search for a scene... (e.g. 'A man speaking at a podium')"
          />
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="absolute inset-y-2 right-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-colors shrink-0"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </form>
      </div>

      {error && (
        <div className="w-full max-w-2xl p-4 bg-red-900/50 border border-red-500/50 rounded-xl text-red-200">
          <p className="font-semibold">Search Failed</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="w-full max-w-4xl space-y-6">
          <h2 className="text-xl font-semibold border-b border-white/10 pb-2">Results ({results.length})</h2>

          <div className="grid gap-6 sm:grid-cols-2">
            {results.map((result, idx) => (
              <div key={idx} className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-lg hover:border-indigo-500/50 transition-colors">
                <div className="relative aspect-video bg-black">
                  {/* We will embed the iframe replacing this placeholder later if possible. For now a thumbnail or iframe placeholder */}
                  <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${result.youtubeId}?start=${Math.floor(result.startTime)}`}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0"
                  ></iframe>
                </div>
                <div className="p-5 space-y-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-lg line-clamp-1" title={result.youtubeId}>
                      Video: {result.youtubeId}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                      Score: {result.matchScore.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex items-center text-sm text-slate-400 gap-4">
                    <span>🎬 Scene {result.sceneIdx}</span>
                    <span>⏱️ {result.startTime.toFixed(1)}s - {result.endTime.toFixed(1)}s</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && !isSearching && query && !error && (
        <div className="text-slate-500">No results found for your query.</div>
      )}
    </div>
  );
}
