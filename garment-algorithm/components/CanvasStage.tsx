"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewMode } from "@/lib/types";

export interface StageGarment {
  id: string;
  label: string;
  confidence?: number;
  /** Preview-resolution mask (white, alpha = coverage). */
  mask: HTMLCanvasElement;
  alpha: Uint8ClampedArray;
  area: number;
}

export interface RefineState {
  active: boolean;
  tool: "add" | "remove";
  /** Brush radius in preview pixels. */
  size: number;
}

export function CanvasStage({
  previewImage,
  composite,
  garments,
  selectedIds,
  activeId,
  hoverId,
  viewMode,
  refine,
  analyzing,
  onHover,
  onSelect,
  onPaint,
  onPaintEnd
}: {
  previewImage: HTMLCanvasElement | null;
  composite: HTMLCanvasElement | null;
  garments: StageGarment[];
  selectedIds: string[];
  activeId: string | null;
  hoverId: string | null;
  viewMode: ViewMode;
  refine: RefineState;
  analyzing: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onPaint: (x: number, y: number) => void;
  onPaintEnd: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    label: string;
    confidence?: number;
  } | null>(null);

  const active = garments.find((g) => g.id === activeId) ?? null;
  const hovered = garments.find((g) => g.id === hoverId) ?? null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewImage) return;
    const w = previewImage.width;
    const h = previewImage.height;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    if (viewMode === "mask") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      for (const g of garments) {
        if (selectedIds.includes(g.id)) ctx.drawImage(g.mask, 0, 0);
      }
    } else if (viewMode === "original") {
      ctx.drawImage(previewImage, 0, 0);
    } else {
      ctx.drawImage(composite ?? previewImage, 0, 0);
    }

    if (viewMode !== "mask") {
      // Only *untreated* garments get a hover wash, as an invitation to click.
      // Treated ones are shown exactly as they will be exported: no outline,
      // no tint, nothing that is not in the final image.
      if (hovered && !selectedIds.includes(hovered.id) && !refine.active) {
        ctx.globalAlpha = 0.24;
        ctx.drawImage(hovered.mask, 0, 0);
        ctx.globalAlpha = 1;
      }
      // While painting, the mask under the brush has to be visible.
      if (refine.active && active) {
        ctx.globalAlpha = 0.28;
        ctx.drawImage(active.mask, 0, 0);
        ctx.globalAlpha = 1;
      }
    }

    if (refine.active && cursorRef.current) {
      const { x, y } = cursorRef.current;
      ctx.strokeStyle =
        refine.tool === "add" ? "rgba(240,240,236,0.9)" : "rgba(240,120,110,0.9)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(x, y, refine.size, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [previewImage, composite, viewMode, garments, active, hovered, selectedIds, refine]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toImageCoords = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !previewImage) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * previewImage.width;
    const y = ((e.clientY - rect.top) / rect.height) * previewImage.height;
    if (x < 0 || y < 0 || x >= previewImage.width || y >= previewImage.height)
      return null;
    return { x, y };
  };

  /** Smallest garment wins when masks overlap. */
  const hitTest = (x: number, y: number): StageGarment | null => {
    if (!previewImage) return null;
    const i = (y | 0) * previewImage.width + (x | 0);
    const ordered = [...garments].sort((a, b) => a.area - b.area);
    for (const g of ordered) if (g.alpha[i] > 100) return g;
    return null;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const pt = toImageCoords(e);
    if (!pt) {
      cursorRef.current = null;
      setTooltip(null);
      onHover(null);
      draw();
      return;
    }
    if (refine.active) {
      cursorRef.current = pt;
      setTooltip(null);
      if (paintingRef.current) onPaint(pt.x, pt.y);
      draw();
      return;
    }
    const hit = hitTest(pt.x, pt.y);
    onHover(hit?.id ?? null);
    if (hit) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const host = (
        canvasRef.current!.parentElement as HTMLElement
      ).getBoundingClientRect();
      setTooltip({
        x: e.clientX - host.left + 14,
        y: e.clientY - host.top + 14,
        label: hit.label,
        confidence: hit.confidence
      });
      void rect;
    } else {
      setTooltip(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const pt = toImageCoords(e);
    if (!pt) return;
    if (refine.active) {
      paintingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onPaint(pt.x, pt.y);
      draw();
      return;
    }
    const hit = hitTest(pt.x, pt.y);
    if (hit) onSelect(hit.id);
  };

  const handlePointerUp = () => {
    if (paintingRef.current) {
      paintingRef.current = false;
      onPaintEnd();
    }
  };

  const handlePointerLeave = () => {
    cursorRef.current = null;
    setTooltip(null);
    onHover(null);
    if (paintingRef.current) {
      paintingRef.current = false;
      onPaintEnd();
    }
    draw();
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-6">
      {previewImage && (
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className={[
            "max-h-full max-w-full select-none border border-ink-line",
            refine.active
              ? "cursor-none"
              : hoverId
                ? "cursor-pointer"
                : "cursor-crosshair"
          ].join(" ")}
          style={{ touchAction: "none" }}
        />
      )}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 border border-ink-line-hi bg-ink-0/95 px-2.5 py-1.5"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="text-[11px] uppercase tracking-[0.14em] text-fg-hi">
            {tooltip.label}
          </div>
          {typeof tooltip.confidence === "number" && (
            <div className="mt-0.5 text-[10px] text-fg-low">
              confidence {Math.round(tooltip.confidence * 100)}%
            </div>
          )}
        </div>
      )}
      {analyzing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-0/70">
          <span className="text-[12px] uppercase tracking-[0.2em] text-fg-hi">
            Analyzing image
            <span className="ga-cursor">…</span>
          </span>
        </div>
      )}
    </div>
  );
}
