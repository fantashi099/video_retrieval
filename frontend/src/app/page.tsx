"use client";

import { useState, useRef, useCallback } from "react";
import { searchVideoAction, searchByImageAction } from "./actions";
import SketchCanvas, { SketchCanvasHandle } from "./SketchCanvas";

type SearchMode = "text" | "image" | "sketch";

export default function Home() {
  const [mode, setMode] = useState<SearchMode>("text");
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sketchRef = useRef<SketchCanvasHandle>(null);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (JPEG, PNG, WebP).");
      return;
    }
    setImageFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }, [handleImageSelect]);

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "text" && !query.trim()) return;
    if (mode === "image" && !imageFile) return;
    if (mode === "sketch" && sketchRef.current?.isEmpty()) return;

    setIsSearching(true);
    setError(null);
    try {
      let response;
      if (mode === "sketch" && sketchRef.current) {
        const blob = await sketchRef.current.toBlob();
        if (!blob) { setError("Failed to capture sketch."); setIsSearching(false); return; }
        const formData = new FormData();
        formData.append("image", new File([blob], "sketch.png", { type: "image/png" }));
        response = await searchByImageAction(formData, 10);
      } else if (mode === "image" && imageFile) {
        const formData = new FormData();
        formData.append("image", imageFile);
        response = await searchByImageAction(formData, 10);
      } else {
        response = await searchVideoAction(query, 10);
      }

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
    <div className="flex h-[calc(100vh-4rem-3.5rem)] -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8">
      {/* ── Left Sidebar: Search Controls ── */}
      <aside className="w-80 xl:w-96 shrink-0 border-r border-white/10 bg-slate-900/60 backdrop-blur-xl flex flex-col">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/5">
          <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Semantic Search
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Find scenes using text, images, or sketches
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="px-6 pt-4">
          <div className="flex bg-slate-800/80 rounded-xl p-1 border border-slate-700/50">
            <button
              onClick={() => setMode("text")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${mode === "text"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Text
            </button>
            <button
              onClick={() => setMode("image")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${mode === "image"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Image
            </button>
            <button
              onClick={() => setMode("sketch")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${mode === "sketch"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Sketch
            </button>
          </div>
        </div>

        {/* Search Form */}
        <div className="p-6 space-y-4">
          <form onSubmit={handleSearch} className="space-y-3">
            {mode === "text" && (
              /* Text Input */
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isSearching}
                  className="w-full bg-slate-800/80 border border-slate-700/50 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all disabled:opacity-50"
                  placeholder="e.g. 'A man speaking at a podium'"
                />
              </div>
            )}

            {mode === "image" && (
              /* Image Upload */
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageSelect(file);
                  }}
                />

                {imagePreview ? (
                  /* Preview */
                  <div className="relative rounded-xl overflow-hidden border border-indigo-500/30 bg-slate-800/50">
                    <img
                      src={imagePreview}
                      alt="Query image"
                      className="w-full h-40 object-contain bg-black/30"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-red-600/80 text-white p-1.5 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 p-2">
                      <p className="text-[10px] text-white/70 truncate">{imageFile?.name}</p>
                    </div>
                  </div>
                ) : (
                  /* Drop Zone */
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${isDragOver
                      ? "border-indigo-400 bg-indigo-900/20"
                      : "border-slate-700/50 hover:border-indigo-500/40 hover:bg-slate-800/50"
                      }`}
                  >
                    <svg className="w-8 h-8 mx-auto text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-xs text-slate-400">
                      {isDragOver ? "Drop image here" : "Click or drag an image"}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-1">JPEG, PNG, WebP</p>
                  </div>
                )}
              </div>
            )}

            {mode === "sketch" && (
              /* Sketch Canvas */
              <SketchCanvas ref={sketchRef} />
            )}

            <button
              type="submit"
              disabled={isSearching || (mode === "text" ? !query.trim() : mode === "image" ? !imageFile : false)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold py-3 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-indigo-900/20"
            >
              {isSearching ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Searching...
                </span>
              ) : (
                mode === "sketch" ? "Search by Sketch" : mode === "image" ? "Search by Image" : "Search"
              )}
            </button>
          </form>

          {error && (
            <div className="p-3 bg-red-900/40 border border-red-500/30 rounded-xl text-red-300 text-xs">
              <p className="font-semibold">Error</p>
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Stats / Info */}
        <div className="flex-1 flex flex-col justify-end p-6 border-t border-white/5">
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Results Found</span>
                <span className="text-[10px] bg-indigo-900/30 text-indigo-400 border border-indigo-700/30 px-2 py-0.5 rounded-full font-bold">
                  {results.length}
                </span>
              </div>
              <div className="text-[10px] text-slate-600">
                {mode === "text" ? `Query: "${query}"` : mode === "image" ? `Image: ${imageFile?.name || "uploaded"}` : "Sketch query"}
              </div>
            </div>
          )}
          {results.length === 0 && !isSearching && !error && (
            <div className="text-center text-slate-600 space-y-2">
              <svg className="h-10 w-10 mx-auto text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="text-xs">Describe a scene, upload an image, or sketch</p>
            </div>
          )}
        </div>
      </aside>

      {/* ── Right Main Panel: All Results ── */}
      <main className="flex-1 overflow-y-auto p-8">
        {results.length > 0 ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-xl font-semibold text-white">Results ({results.length})</h2>
              <span className="text-xs text-slate-500 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700/50">
                {mode === "text" ? "🔤 Text Search" : mode === "image" ? "🖼️ Image Search" : "✏️ Sketch Search"}
              </span>
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.map((result, idx) => (
                <div key={idx} className="bg-slate-900/50 backdrop-blur-sm rounded-xl overflow-hidden border border-slate-800/50 shadow hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-900/10 transition-all group">
                  {/* Video Embed */}
                  <div className="relative aspect-video bg-black">
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${result.youtube_id}?start=${Math.floor(result.start_time)}`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0"
                    ></iframe>
                  </div>

                  {/* Card Details */}
                  <div className="p-2.5 space-y-1.5">
                    <div className="flex justify-between items-start gap-1">
                      <h3 className="font-semibold text-xs line-clamp-1 text-white" title={result.video_name || result.youtube_id}>
                        {result.video_name || result.youtube_id}
                      </h3>
                      <span className="text-[9px] font-mono text-indigo-400 bg-indigo-900/30 px-1.5 py-0.5 rounded shrink-0">
                        {result.match_score.toFixed(3)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center text-[10px] gap-1 text-slate-500">
                      <span>🎬 {result.scene_idx}</span>
                      <span>⏱️ {result.start_time.toFixed(1)}s–{result.end_time.toFixed(1)}s</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {result.ocr_text && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-900/20 text-emerald-400 border border-emerald-800/30 cursor-help" title={result.ocr_text}>OCR</span>
                      )}
                      {result.asr_text && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-900/20 text-blue-400 border border-blue-800/30 cursor-help" title={result.asr_text}>Audio</span>
                      )}
                      {result.tags && result.tags.slice(0, 2).map((tag: string, i: number) => (
                        <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800/80 text-slate-400 border border-slate-700/50">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600">
            <svg className="h-20 w-20 mb-6 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Semantic Video Search
            </h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md text-center">
              Use the search panel on the left to find specific scenes using natural language queries or image similarity powered by SigLIP embeddings.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
