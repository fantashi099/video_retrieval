"use client";

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";

export interface SketchCanvasHandle {
    toBlob: () => Promise<Blob | null>;
    clear: () => void;
    isEmpty: () => boolean;
}

const SketchCanvas = forwardRef<SketchCanvasHandle>(function SketchCanvas(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasStrokes, setHasStrokes] = useState(false);
    const [brushSize, setBrushSize] = useState(3);
    const [brushColor, setBrushColor] = useState("#ffffff");

    const colors = ["#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#f97316"];

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, []);

    const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        if ("touches" in e) {
            const touch = e.touches[0];
            return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
        }
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }, []);

    const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = getPos(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
        setIsDrawing(true);
    }, [getPos]);

    const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        e.preventDefault();
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = getPos(e);
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineTo(x, y);
        ctx.stroke();
        setHasStrokes(true);
    }, [isDrawing, getPos, brushColor, brushSize]);

    const stopDraw = useCallback(() => {
        setIsDrawing(false);
    }, []);

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setHasStrokes(false);
    }, []);

    useImperativeHandle(ref, () => ({
        toBlob: () => new Promise<Blob | null>((resolve) => {
            canvasRef.current?.toBlob((blob) => resolve(blob), "image/png");
        }),
        clear: clearCanvas,
        isEmpty: () => !hasStrokes,
    }), [clearCanvas, hasStrokes]);

    return (
        <div className="space-y-2">
            {/* Canvas */}
            <div className="rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900">
                <canvas
                    ref={canvasRef}
                    width={320}
                    height={200}
                    className="w-full cursor-crosshair touch-none"
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={stopDraw}
                    onMouseLeave={stopDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={stopDraw}
                />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
                {/* Color Palette */}
                <div className="flex gap-1">
                    {colors.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setBrushColor(c)}
                            className={`w-5 h-5 rounded-full border-2 transition-all ${brushColor === c ? "border-indigo-400 scale-110" : "border-slate-600"}`}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>

                {/* Brush Size */}
                <input
                    type="range"
                    min={1}
                    max={12}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="flex-1 h-1 accent-indigo-500"
                />

                {/* Clear */}
                <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-[10px] text-slate-400 hover:text-red-400 bg-slate-800 hover:bg-red-900/20 px-2 py-1 rounded-lg border border-slate-700/50 transition-colors"
                >
                    Clear
                </button>
            </div>
        </div>
    );
});

export default SketchCanvas;
