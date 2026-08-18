"use client";

/**
 * Dev-only harness for tuning effects against real photographs.
 * Pick a sample, click the garment to grow a mask by colour similarity
 * (same idea as the in-chat prototype's wand), then move the sliders.
 * It imports the real effect module, so what you see is the app's output.
 * Not linked from the app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createCanvas, ctx2d, growMask } from "../../../lib/maskUtils";
import { renderComposite } from "../../../lib/compose";
import { DEFAULT_PARAMS, type EffectParameters, type InkMode, type Garment } from "../../../lib/types";
import { segmentImage } from "../../../lib/segmentation/client";
import { effects } from "../../../lib/effects";

const SAMPLES = ["blazer-branco.webp", "denim-azul.webp", "denim-claro.webp"];
const MAXW = 820;

/** Flood fill by colour distance from a seed pixel. */
function wand(img: HTMLCanvasElement, sx: number, sy: number, tol: number) {
  const w = img.width;
  const h = img.height;
  const d = ctx2d(img).getImageData(0, 0, w, h).data;
  const seed = (sy * w + sx) * 4;
  const r0 = d[seed];
  const g0 = d[seed + 1];
  const b0 = d[seed + 2];
  const limit = tol * tol * 3;

  const out = createCanvas(w, h);
  const oc = ctx2d(out);
  const od = oc.createImageData(w, h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];

  while (stack.length) {
    const i = stack.pop() as number;
    if (seen[i]) continue;
    seen[i] = 1;
    const j = i * 4;
    const dr = d[j] - r0;
    const dg = d[j + 1] - g0;
    const db = d[j + 2] - b0;
    if (dr * dr + dg * dg + db * db > limit) continue;
    od.data[j] = od.data[j + 1] = od.data[j + 2] = 255;
    od.data[j + 3] = 255;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  oc.putImageData(od, 0, 0);
  return out;
}

export default function EffectPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  const [sample, setSample] = useState(SAMPLES[0]);
  const [tol, setTol] = useState(38);
  const [seedPt, setSeedPt] = useState<[number, number] | null>(null);
  const [params, setParams] = useState<EffectParameters>(DEFAULT_PARAMS);
  const detectedRef = useRef<Garment[]>([]);
  const chosenRef = useRef<string[]>([]);
  const [info, setInfo] = useState("clique na peça ou detecte");
  const [detected, setDetected] = useState<Garment[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [maskEdge, setMaskEdge] = useState(0);
  const edgeRef = useRef(0);
  const [effectId, setEffectId] = useState("ascii-reconstruction");
  const effectRef = useRef("ascii-reconstruction");
  const [anim, setAnim] = useState(false);
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!anim) return;
    const iv = window.setInterval(() => setTick((t) => t + 1), 130);
    return () => window.clearInterval(iv);
  }, [anim]);
  const [busy, setBusy] = useState<string | null>(null);

  detectedRef.current = detected;
  chosenRef.current = chosen;
  edgeRef.current = maskEdge;
  tickRef.current = tick;
  effectRef.current = effectId;

  const draw = useCallback(() => {
    const img = imgRef.current;
    const el = canvasRef.current;
    if (!img || !el) return;
    const picked = detectedRef.current.filter((g) => chosenRef.current.includes(g.id));
    const base = picked.length
      ? picked.map((g, i) => ({
          mask: growMask(g.maskCanvas, edgeRef.current),
          seed: 1000 + i * 7919 + tickRef.current * 104729
        }))
      : maskRef.current
        ? [{ mask: maskRef.current, seed: 12345 }]
        : [];
    const targets = base.map((t) => ({ ...t, effectId: effectRef.current, params }));
    const out = renderComposite(img, targets);
    el.width = out.width;
    el.height = out.height;
    ctx2d(el).drawImage(out, 0, 0);
  }, [params]);

  // Load sample
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const scale = Math.min(1, MAXW / im.width);
      const c = createCanvas(Math.round(im.width * scale), Math.round(im.height * scale));
      ctx2d(c).drawImage(im, 0, 0, c.width, c.height);
      imgRef.current = c;
      maskRef.current = null;
      setSeedPt(null);
      setDetected([]);
      setChosen([]);
      setInfo("clique na peça ou detecte");
      draw();
    };
    im.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/samples/${sample}`;
  }, [sample, draw]);

  // Rebuild mask when seed or tolerance changes
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !seedPt) return;
    const m = wand(img, seedPt[0], seedPt[1], tol);
    maskRef.current = m;
    const a = ctx2d(m).getImageData(0, 0, m.width, m.height).data;
    let n = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] > 127) n++;
    setInfo(`máscara: ${((n / (m.width * m.height)) * 100).toFixed(1)}% do quadro`);
    draw();
  }, [seedPt, tol, draw]);

  useEffect(() => {
    draw();
  }, [params, chosen, detected, maskEdge, effectId, tick, draw]);

  const detect = async () => {
    const img = imgRef.current;
    if (!img) return;
    setBusy("detectando…");
    setDetected([]);
    setChosen([]);
    const t0 = performance.now();
    try {
      const found = await segmentImage(
        img.toDataURL("image/jpeg", 0.9),
        img.width,
        img.height,
        (stage) => setBusy(stage === "loading" ? "carregando modelo…" : "detectando…")
      );
      setDetected(found);
      setChosen(found.length ? [found[0].id] : []);
      maskRef.current = null;
      setInfo(
        found.length
          ? `${found.length} peça(s) em ${((performance.now() - t0) / 1000).toFixed(1)}s`
          : "nenhuma peça detectada"
      );

    } catch (err) {
      setInfo(err instanceof Error ? err.message : "falhou");
    } finally {
      setBusy(null);
    }
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSeedPt([
      Math.round(((e.clientX - r.left) / r.width) * el.width),
      Math.round(((e.clientY - r.top) / r.height) * el.height)
    ]);
  };

  const num = (k: keyof EffectParameters, max = 100) => (
    <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 122 }}>{k}</span>
      <b style={{ width: 30 }}>{String(params[k])}</b>
      <input
        type="range"
        min={0}
        max={max}
        value={params[k] as number}
        onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <main style={{ background: "#101010", color: "#ddd", padding: 14, font: "12px ui-monospace, monospace", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <canvas
          ref={canvasRef}
          onClick={onClick}
          style={{ maxHeight: "88vh", border: "1px solid #333", cursor: "crosshair" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 330 }}>
          <select value={sample} onChange={(e) => setSample(e.target.value)} style={{ padding: 4 }}>
            {SAMPLES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div style={{ color: "#8a8" }}>{busy ?? info}</div>
          <button onClick={detect} disabled={!!busy} style={{ padding: "6px 8px" }}>
            detectar peças (modelo local)
          </button>
          {detected.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {detected.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setSeedPt(null);
                    maskRef.current = null;
                    setChosen((prev) =>
                      prev.includes(g.id)
                        ? prev.filter((x) => x !== g.id)
                        : [...prev, g.id]
                    );
                  }}
                  style={{
                    padding: "4px 6px",
                    background: chosen.includes(g.id) ? "#3a5" : undefined,
                    color: chosen.includes(g.id) ? "#000" : undefined
                  }}
                >
                  {g.label}
                  {g.confidence ? ` ${(g.confidence * 100) | 0}%` : ""}
                </button>
              ))}
            </div>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>wand tolerance</span>
            <b style={{ width: 30 }}>{tol}</b>
            <input type="range" min={2} max={120} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>effect</span>
            <select value={effectId} onChange={(e) => setEffectId(e.target.value)}>
              {effects.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>mask edge</span>
            <b style={{ width: 30 }}>{maskEdge}</b>
            <input
              type="range"
              min={-16}
              max={16}
              value={maskEdge}
              onChange={(e) => setMaskEdge(Number(e.target.value))}
            />
          </label>
          <hr style={{ borderColor: "#333", width: "100%" }} />
          {num("density")}
          {num("charSize", 30)}
          {num("edgeInfluence")}
          {num("flow")}
          {num("sizeByLight")}
          {num("randomness")}
          {num("originalGarment")}
          {num("opacity")}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>ink</span>
            <select
              value={params.ink}
              onChange={(e) => setParams((p) => ({ ...p, ink: e.target.value as InkMode }))}
            >
              <option value="auto">auto</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>animate</span>
            <input type="checkbox" checked={anim} onChange={(e) => setAnim(e.target.checked)} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>inkColor</span>
            <input
              type="color"
              value={params.inkColor === "auto" ? "#f6f5f1" : params.inkColor}
              onChange={(e) => setParams((p) => ({ ...p, inkColor: e.target.value }))}
            />
            <button onClick={() => setParams((p) => ({ ...p, inkColor: "auto" }))}>
              auto
            </button>
            <span style={{ color: "#888" }}>{params.inkColor}</span>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 122 }}>charset</span>
            <input
              value={params.charset}
              onChange={(e) => setParams((p) => ({ ...p, charset: e.target.value }))}
              style={{ width: 130 }}
            />
          </label>
        </div>
      </div>
    </main>
  );
}
