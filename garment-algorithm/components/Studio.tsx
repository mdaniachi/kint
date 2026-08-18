"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EffectParameters,
  Garment,
  GarmentSettings,
  ViewMode
} from "@/lib/types";
import { defaultSettings } from "@/lib/types";
import {
  coverage,
  createCanvas,
  ctx2d,
  emptyMask,
  growMask,
  maskAlpha,
  paintBrush,
  scaleTo
} from "@/lib/maskUtils";
import { hashString } from "@/lib/analysis";
import { renderComposite, type EffectTarget } from "@/lib/compose";
import { recordWebM } from "@/lib/video";
import {
  preloadSegmenter,
  segmentImage,
  SegmentationError
} from "@/lib/segmentation/client";
import { CanvasStage, type RefineState, type StageGarment } from "./CanvasStage";
import { EffectControls, GarmentList, UploadZone } from "./controls";

const PREVIEW_MAX = 1600; // longest side of the working preview
const API_MAX = 1024; // longest side of the image sent to segmentation

type Status = "idle" | "analyzing" | "ready";

export default function Studio() {
  const [fullImage, setFullImage] = useState<HTMLCanvasElement | null>(null);
  const [previewImage, setPreviewImage] = useState<HTMLCanvasElement | null>(
    null
  );
  const [status, setStatus] = useState<Status>("idle");
  const [garments, setGarments] = useState<Garment[]>([]);
  // More than one garment can be treated at once. Order is selection order;
  // the last one is the "active" garment that brush refinement targets.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Settings live per garment; the panel edits the active garment's copy.
  const [settings, setSettings] = useState<Record<string, GarmentSettings>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("result");
  const [refine, setRefine] = useState<RefineState>({
    active: false,
    tool: "add",
    size: 26
  });
  const [maskVersion, setMaskVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Animation: the grid and glyph choices stay put; only the random part
  // (jitter, dropout, glyph blur) re-rolls each tick, so the reconstruction
  // flickers like it is being continuously re-decided.
  const [animating, setAnimating] = useState(false);
  const [animTick, setAnimTick] = useState(0);

  useEffect(() => {
    if (!animating) return;
    const iv = window.setInterval(() => setAnimTick((t) => t + 1), 130);
    return () => window.clearInterval(iv);
  }, [animating]);
  const manualCount = useRef(0);

  /* ── Upload ──────────────────────────────────────────────────────── */

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const full = createCanvas(img.naturalWidth, img.naturalHeight);
      ctx2d(full).drawImage(img, 0, 0);

      const pScale = Math.min(
        1,
        PREVIEW_MAX / Math.max(full.width, full.height)
      );
      const preview = scaleTo(
        full,
        Math.round(full.width * pScale),
        Math.round(full.height * pScale)
      );

      setFullImage(full);
      setPreviewImage(preview);
      setGarments([]);
      setSelectedIds([]);
      setSettings({});
      setHoverId(null);
      setNotice(null);
      setViewMode("result");
      setRefine((r) => ({ ...r, active: false }));
      manualCount.current = 0;
      setStatus("analyzing");

      // Send a resized JPEG to the segmentation service; masks are scaled
      // back up to full resolution when decoded.
      const aScale = Math.min(1, API_MAX / Math.max(full.width, full.height));
      const apiCanvas = scaleTo(
        full,
        Math.round(full.width * aScale),
        Math.round(full.height * aScale)
      );
      const dataUrl = apiCanvas.toDataURL("image/jpeg", 0.9);

      segmentImage(dataUrl, full.width, full.height, (stage) =>
        setNotice(
          stage === "loading"
            ? "Loading the detection model (first photograph only)…"
            : null
        )
      )
        .then((found) => {
          setGarments(found);
          if (found.length === 0) {
            setNotice(
              "No garments were detected in this photograph. You can still create a mask by hand with “Manual mask”."
            );
          }
          setStatus("ready");
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof SegmentationError
              ? `${err.message} You can still draw a mask by hand with “Manual mask”.`
              : "Garment detection failed. You can draw a mask by hand with “Manual mask”.";
          setNotice(msg);
          setStatus("ready");
        });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setNotice("This file could not be read as an image.");
    };
    img.src = url;
  }, []);

  // Start the segmenter worker as soon as the studio mounts, so the model
  // is already loading while the user picks a photograph.
  useEffect(() => {
    preloadSegmenter();
  }, []);

  /* ── Preview-resolution stage data (masks, outlines, hit maps) ───── */

  const [stageGarments, setStageGarments] = useState<StageGarment[]>([]);

  // Masks are expensive to rebuild; keying on the edge offsets alone keeps
  // ordinary parameter slides from re-scaling every mask.
  const edgeKey = garments
    .map((g) => `${g.id}:${settings[g.id]?.maskEdge ?? 0}`)
    .join("|");

  useEffect(() => {
    if (!previewImage) {
      setStageGarments([]);
      return;
    }
    const pw = previewImage.width;
    const ph = previewImage.height;
    const list: StageGarment[] = garments.map((g) => {
      // While the brush is active the mask must match what the user paints,
      // so the edge offset is suspended.
      const edge = refine.active ? 0 : (settings[g.id]?.maskEdge ?? 0);
      const mask =
        edge === 0
          ? scaleTo(g.maskCanvas, pw, ph)
          : growMask(scaleTo(g.maskCanvas, pw, ph), edge);
      const alpha = maskAlpha(mask);
      return {
        id: g.id,
        label: g.label,
        confidence: g.confidence,
        mask,
        alpha,
        area: coverage(alpha)
      };
    });
    setStageGarments(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garments, previewImage, maskVersion, edgeKey, refine.active]);

  const selectedStages = useMemo(
    () => selectedIds
      .map((id) => stageGarments.find((g) => g.id === id))
      .filter((g): g is StageGarment => !!g),
    [stageGarments, selectedIds]
  );

  // Brush refinement acts on one garment: the most recently selected.
  const activeStage = selectedStages[selectedStages.length - 1] ?? null;

  const settingsOf = useCallback(
    (id: string): GarmentSettings => settings[id] ?? defaultSettings(),
    [settings]
  );
  const activeSettings = activeStage ? settingsOf(activeStage.id) : null;

  const patchActive = useCallback(
    (patch: Partial<EffectParameters>) => {
      if (!activeStage) return;
      const id = activeStage.id;
      setSettings((prev) => {
        const cur = prev[id] ?? defaultSettings();
        return { ...prev, [id]: { ...cur, params: { ...cur.params, ...patch } } };
      });
    },
    [activeStage]
  );

  const setActiveField = useCallback(
    (field: "effectId" | "maskEdge", value: string | number) => {
      if (!activeStage) return;
      const id = activeStage.id;
      setSettings((prev) => {
        const cur = prev[id] ?? defaultSettings();
        return { ...prev, [id]: { ...cur, [field]: value } };
      });
    },
    [activeStage]
  );

  // Copy the active garment's settings onto every treated garment.
  const applyToAll = useCallback(() => {
    if (!activeStage) return;
    const src = settingsOf(activeStage.id);
    setSettings((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        next[id] = {
          effectId: src.effectId,
          params: { ...src.params },
          maskEdge: src.maskEdge
        };
      }
      return next;
    });
  }, [activeStage, selectedIds, settingsOf]);

  /* ── Live composite (preview resolution) ─────────────────────────── */

  const composite = useMemo(() => {
    if (!previewImage) return null;
    if (selectedStages.length === 0) return previewImage;
    const frame = animating ? animTick : 0;
    const targets: EffectTarget[] = selectedStages.map((g) => {
      const st = settingsOf(g.id);
      return {
        mask: g.mask,
        seed: hashString(g.id) + frame * 104729,
        effectId: st.effectId,
        params: st.params
      };
    });
    return renderComposite(previewImage, targets);
  }, [previewImage, selectedStages, settingsOf, animating, animTick]);

  /* ── Selection & refine ──────────────────────────────────────────── */

  // Clicking toggles: a second click on a treated garment releases it.
  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setViewMode("result");
    setRefine((r) => ({ ...r, active: false }));
  }, []);

  const handleAddManual = useCallback(() => {
    if (!fullImage) return;
    manualCount.current += 1;
    const id = `manual-${manualCount.current}`;
    const g: Garment = {
      id,
      label: `Garment ${String(garments.length + 1).padStart(2, "0")}`,
      maskCanvas: emptyMask(fullImage.width, fullImage.height),
      manual: true
    };
    setGarments((prev) => [...prev, g]);
    setSelectedIds((prev) => [...prev, id]);
    setRefine({ active: true, tool: "add", size: 34 });
    setViewMode("result");
  }, [fullImage, garments.length]);

  const handlePaint = useCallback(
    (x: number, y: number) => {
      if (!fullImage || !previewImage || !activeStage) return;
      const g = garments.find((gg) => gg.id === activeStage.id);
      if (!g) return;
      const scale = fullImage.width / previewImage.width;
      paintBrush(g.maskCanvas, x * scale, y * scale, refine.size * scale, refine.tool);
      // Paint the preview mask in place so the overlay tracks the stroke live.
      paintBrush(activeStage.mask, x, y, refine.size, refine.tool);
    },
    [fullImage, previewImage, activeStage, garments, refine]
  );

  const handlePaintEnd = useCallback(() => {
    setMaskVersion((v) => v + 1); // rebuild alpha maps, outline, composite
  }, []);

  /* ── Export ──────────────────────────────────────────────────────── */

  /** Full-resolution targets, each with its own settings scaled up. */
  const buildExportTargets = useCallback(
    (frame = 0): EffectTarget[] => {
      if (!fullImage || !previewImage) return [];
      const scale = fullImage.width / previewImage.width;
      return selectedIds
        .map((id) => garments.find((g) => g.id === id))
        .filter((g): g is Garment => !!g)
        .map((g) => {
          const st = settingsOf(g.id);
          return {
            mask: growMask(g.maskCanvas, Math.round(st.maskEdge * scale)),
            seed: hashString(g.id) + frame * 104729,
            effectId: st.effectId,
            params: {
              ...st.params,
              charSize: Math.max(5, Math.round(st.params.charSize * scale))
            }
          };
        });
    },
    [fullImage, previewImage, garments, selectedIds, settingsOf]
  );

  /**
   * `layer` exports the effect alone on transparency, full resolution —
   * for compositing over the original RAW/TIFF in Photoshop/After Effects.
   * PNG is forced there: JPEG has no alpha.
   */
  const handleExport = useCallback(
    (fmt: "png" | "jpg" | "layer") => {
      if (!fullImage || exporting) return;
      setExporting(true);
      // Let the button state paint before the heavy synchronous render.
      window.setTimeout(() => {
        try {
          const out = renderComposite(
            fullImage,
            buildExportTargets(),
            fmt !== "layer"
          );
          out.toBlob(
            (blob) => {
              if (blob) {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download =
                  fmt === "layer"
                    ? "garment-algorithm-layer.png"
                    : `garment-algorithm.${fmt}`;
                a.click();
                URL.revokeObjectURL(a.href);
              }
              setExporting(false);
            },
            fmt === "jpg" ? "image/jpeg" : "image/png",
            0.92
          );
        } catch {
          setExporting(false);
        }
      }, 30);
    },
    [fullImage, exporting, buildExportTargets]
  );

  /**
   * Loop export: 32 frames at 10 fps ≈ 3.2 s of the same flicker the
   * Animate toggle shows. Rendered at preview resolution — video codecs eat
   * fine detail anyway, and MediaRecorder records in real time, so full
   * resolution would only add wait, not quality.
   */
  const handleExportVideo = useCallback(() => {
    if (!previewImage || selectedStages.length === 0 || exporting) return;
    setExporting(true);
    recordWebM({
      width: previewImage.width,
      height: previewImage.height,
      frames: 32,
      fps: 10,
      renderFrame: (f) =>
        renderComposite(
          previewImage,
          selectedStages.map((g) => {
            const st = settingsOf(g.id);
            return {
              mask: g.mask,
              seed: hashString(g.id) + f * 104729,
              effectId: st.effectId,
              params: st.params
            };
          })
        )
    })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "garment-algorithm.webm";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => {
        setNotice("Video export failed in this browser. PNG/JPG still work.");
      })
      .finally(() => setExporting(false));
  }, [previewImage, selectedStages, settingsOf, exporting]);

  const handleReset = useCallback(() => {
    setFullImage(null);
    setPreviewImage(null);
    setGarments([]);
    setSelectedIds([]);
    setHoverId(null);
    setNotice(null);
    setStatus("idle");
    setRefine((r) => ({ ...r, active: false }));
  }, []);

  /* ── Layout ──────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col bg-ink-0 text-fg-hi">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-line px-4">
        <h1 className="text-[12px] uppercase tracking-[0.28em] text-fg-hi">
          Garment Algorithm
        </h1>
        <div className="flex items-center gap-2">
          {fullImage && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-low transition-colors hover:text-fg-hi"
            >
              New image
            </button>
          )}
          <button
            onClick={() => handleExport("png")}
            disabled={!fullImage || exporting}
            className="border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors enabled:hover:border-fg-low enabled:hover:text-fg-hi disabled:opacity-35"
          >
            {exporting ? "Rendering…" : "Export PNG"}
          </button>
          <button
            onClick={() => handleExport("jpg")}
            disabled={!fullImage || exporting}
            className="border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors enabled:hover:border-fg-low enabled:hover:text-fg-hi disabled:opacity-35"
          >
            Export JPG
          </button>
          <button
            onClick={() => handleExport("layer")}
            disabled={selectedIds.length === 0 || exporting}
            className="border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors enabled:hover:border-fg-low enabled:hover:text-fg-hi disabled:opacity-35"
            title="Transparent PNG of the effect alone, full resolution — for compositing over the original file"
          >
            Export Layer
          </button>
          <button
            onClick={handleExportVideo}
            disabled={selectedIds.length === 0 || exporting}
            className="border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors enabled:hover:border-fg-low enabled:hover:text-fg-hi disabled:opacity-35"
            title="~3 s loop of the animated flicker (records in real time)"
          >
            {exporting ? "Rendering…" : "Export WebM"}
          </button>
        </div>
      </header>

      {/* Main three-area layout */}
      <div className="flex min-h-0 flex-1">
        <GarmentList
          garments={garments}
          selectedIds={selectedIds}
          hoverId={hoverId}
          notice={notice}
          onSelect={handleSelect}
          onHover={setHoverId}
          onAddManual={handleAddManual}
        />

        <main className="min-w-0 flex-1 bg-ink-2">
          {previewImage ? (
            <CanvasStage
              previewImage={previewImage}
              composite={viewMode === "result" ? composite : null}
              garments={stageGarments}
              selectedIds={selectedIds}
              activeId={activeStage?.id ?? null}
              hoverId={hoverId}
              viewMode={viewMode}
              refine={refine}
              analyzing={status === "analyzing"}
              onHover={setHoverId}
              onSelect={handleSelect}
              onPaint={handlePaint}
              onPaintEnd={handlePaintEnd}
            />
          ) : (
            <UploadZone onFile={handleFile} />
          )}
        </main>

        <EffectControls
          settings={activeSettings}
          activeLabel={activeStage?.label ?? null}
          multi={selectedIds.length > 1}
          onChange={patchActive}
          onEffectChange={(id) => setActiveField("effectId", id)}
          onMaskEdgeChange={(v) => setActiveField("maskEdge", v)}
          onApplyToAll={applyToAll}
        />
      </div>

      {/* Footer: view modes + mask refinement */}
      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-ink-line px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAnimating((a) => !a)}
            disabled={selectedIds.length === 0}
            aria-pressed={animating}
            className={[
              "mr-2 px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors disabled:opacity-35",
              animating ? "bg-ink-3 text-fg-hi" : "text-fg-low hover:text-fg-hi"
            ].join(" ")}
            title="Re-rolls the randomness each tick. Needs Randomness above 0 to move."
          >
            {animating ? "■ Animating" : "▶ Animate"}
          </button>
          {(["original", "mask", "result"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={[
                "px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition-colors",
                viewMode === m
                  ? "bg-ink-3 text-fg-hi"
                  : "text-fg-low hover:text-fg-hi"
              ].join(" ")}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {refine.active && (
            <>
              <div className="flex items-center gap-1">
                {(["add", "remove"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRefine((r) => ({ ...r, tool: t }))}
                    className={[
                      "px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors",
                      refine.tool === t
                        ? "bg-ink-3 text-fg-hi"
                        : "text-fg-low hover:text-fg-hi"
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="flex w-40 items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.12em] text-fg-low">
                  Brush
                </span>
                <input
                  type="range"
                  min={6}
                  max={120}
                  value={refine.size}
                  onChange={(e) =>
                    setRefine((r) => ({ ...r, size: Number(e.target.value) }))
                  }
                  aria-label="Brush size"
                />
              </label>
            </>
          )}
          <button
            onClick={() => setRefine((r) => ({ ...r, active: !r.active }))}
            disabled={!activeStage}
            className={[
              "border px-3 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors disabled:opacity-35",
              refine.active
                ? "border-fg-low bg-ink-3 text-fg-hi"
                : "border-ink-line-hi text-fg-mid enabled:hover:border-fg-low enabled:hover:text-fg-hi"
            ].join(" ")}
          >
            {refine.active ? "Done refining" : "Refine mask"}
          </button>
        </div>
      </footer>
    </div>
  );
}
