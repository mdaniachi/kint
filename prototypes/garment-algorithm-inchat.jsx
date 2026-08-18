import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────
   GARMENT ALGORITHM — versão in-chat (sem credenciais)
   Seleção por varinha (flood fill por cor) + pincel de refino.
   Efeito: ASCII Reconstruction, recortado estritamente na máscara.
──────────────────────────────────────────────────────────────────── */

const PREVIEW_MAX = 1100;

/* ── canvas utils ── */
const mk = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const cx = (c) => c.getContext("2d", { willReadFrequently: true });
const scaleTo = (src, w, h) => {
  const c = mk(w, h);
  cx(c).drawImage(src, 0, 0, c.width, c.height);
  return c;
};
const maskAlphaArr = (mask) => {
  const d = cx(mask).getImageData(0, 0, mask.width, mask.height).data;
  const out = new Uint8ClampedArray(mask.width * mask.height);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j];
  return out;
};
const makeOutline = (mask, r = 2) => {
  const c = mk(mask.width, mask.height);
  const ctx = cx(c);
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      if (dx || dy) ctx.drawImage(mask, dx, dy);
    }
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return c;
};

/* ── análise: luminância + bordas (Sobel) ── */
function analyze(imgCanvas) {
  const w = imgCanvas.width, h = imgCanvas.height;
  const { data } = cx(imgCanvas).getImageData(0, 0, w, h);
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    lum[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
  const edge = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
      const l = lum[i - 1], r = lum[i + 1];
      const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const m = Math.sqrt(gx * gx + gy * gy) * 0.9;
      edge[i] = m > 1 ? 1 : m;
    }
  }
  return { lum, edge, width: w, height: h, rgba: data };
}

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── varinha: flood fill por semelhança de cor ── */
function wandFill(analysis, maskCanvas, sx, sy, tolerance) {
  const { width: w, height: h, rgba } = analysis;
  sx |= 0; sy |= 0;
  const seedI = (sy * w + sx) * 4;
  const sr = rgba[seedI], sg = rgba[seedI + 1], sb = rgba[seedI + 2];
  const maxD2 = Math.pow(28 + tolerance * 2.1, 2);
  const visited = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  const sel = cx(maskCanvas).getImageData(0, 0, w, h);
  const sd = sel.data;
  while (stack.length) {
    const i = stack.pop();
    if (visited[i]) continue;
    visited[i] = 1;
    const j = i * 4;
    const dr = rgba[j] - sr, dg = rgba[j + 1] - sg, db = rgba[j + 2] - sb;
    if (dr * dr + dg * dg + db * db > maxD2) continue;
    sd[j] = 255; sd[j + 1] = 255; sd[j + 2] = 255; sd[j + 3] = 255;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  cx(maskCanvas).putImageData(sel, 0, 0);
}

function paintBrush(mask, x, y, radius, mode) {
  const ctx = cx(mask);
  ctx.globalCompositeOperation = mode === "remove" ? "destination-out" : "source-over";
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

/* ── efeito: ASCII Reconstruction ── */
function renderAscii(image, mask, p, analysis, seed) {
  const w = image.width, h = image.height;
  const layer = mk(w, h);
  const ctx = cx(layer);
  const alpha = maskAlphaArr(mask);
  const { lum, edge } = analysis;
  const rand = mulberry32(seed);

  const dim = 1 - p.originalGarment / 100;
  if (dim > 0.005) {
    ctx.fillStyle = `rgba(10,10,10,${(dim * 0.92).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  const chars = (p.charset.replace(/\s+/g, "") || "#+*=-:.").split("");
  const cell = Math.max(5, p.charSize);
  const density = p.density / 100;
  const edgeW = p.edgeInfluence / 100;
  const rnd = p.randomness / 100;
  const opacity = p.opacity / 100;

  ctx.font = `${Math.round(cell * 1.05)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const half = Math.max(2, Math.round(cell / 2));
  const cX = (v) => (v < 0 ? 0 : v >= w ? w - 1 : v | 0);
  const cY = (v) => (v < 0 ? 0 : v >= h ? h - 1 : v | 0);

  for (let gy = half; gy < h; gy += cell) {
    for (let gx = half; gx < w; gx += cell) {
      const jAmp = cell * (0.16 + 0.5 * rnd);
      const jx = (rand() * 2 - 1) * jAmp;
      const jy = (rand() * 2 - 1) * jAmp;
      const sx = cX(gx + jx), sy = cY(gy + jy);
      const i = sy * w + sx;
      if (alpha[i] < 100) continue;
      const L = lum[i];
      const l0 = lum[cY(sy - half) * w + sx], l1 = lum[cY(sy + half) * w + sx];
      const l2 = lum[sy * w + cX(sx - half)], l3 = lum[sy * w + cX(sx + half)];
      const detail = Math.min(
        1,
        (Math.abs(l0 - L) + Math.abs(l1 - L) + Math.abs(l2 - L) + Math.abs(l3 - L)) * 2.4
      );
      const e = Math.max(
        edge[i],
        edge[cY(sy - half) * w + sx],
        edge[cY(sy + half) * w + sx],
        edge[sy * w + cX(sx - half)],
        edge[sy * w + cX(sx + half)]
      );
      const drive = (1 - edgeW) * detail + edgeW * Math.min(1, e * 1.5);
      let prob = density * (0.1 + 0.9 * drive);
      prob *= 1 - rnd * 0.45 * rand();
      if (rand() > prob) continue;
      let idx = Math.floor((1 - L) * chars.length + (rand() - 0.5) * rnd * 2.2);
      if (idx < 0) idx = 0;
      if (idx >= chars.length) idx = chars.length - 1;
      const dark = L > 0.62 && p.originalGarment > 35;
      ctx.globalAlpha = opacity * (0.68 + 0.32 * Math.min(1, e * 2));
      ctx.fillStyle = dark ? "rgba(16,16,15,1)" : "rgba(242,241,237,1)";
      ctx.fillText(chars[idx], gx + jx, gy + jy);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return layer;
}

function renderComposite(image, mask, params, analysis, seed) {
  const out = mk(image.width, image.height);
  const ctx = cx(out);
  ctx.drawImage(image, 0, 0);
  if (mask) ctx.drawImage(renderAscii(image, mask, params, analysis, seed), 0, 0);
  return out;
}

/* ── UI ── */
const C = {
  bg0: "#0F0F0E", bg1: "#141413", bg2: "#1A1A19", bg3: "#21211F",
  line: "#262624", lineHi: "#3A3A37",
  hi: "#E8E6E1", mid: "#9C9A93", low: "#67655F"
};
const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function Slider({ label, value, min = 0, max = 100, step = 1, suffix = "", onChange }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mid }}>{label}</span>
        <span style={{ fontSize: 10, color: C.low, fontVariantNumeric: "tabular-nums" }}>{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: C.hi, height: 14 }}
        aria-label={label}
      />
    </label>
  );
}

function Btn({ active, disabled, onClick, children, subtle }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
        padding: "7px 10px", cursor: disabled ? "default" : "pointer",
        background: active ? C.bg3 : "transparent",
        color: disabled ? C.low : active ? C.hi : C.mid,
        border: subtle ? "1px solid transparent" : `1px solid ${active ? C.low : C.lineHi}`,
        opacity: disabled ? 0.4 : 1
      }}
    >
      {children}
    </button>
  );
}

export default function GarmentAlgorithm() {
  const [fullImage, setFullImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tool, setTool] = useState("wand"); // wand | add | remove
  const [view, setView] = useState("result"); // original | mask | result
  const [maskTick, setMaskTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState({
    density: 62, charSize: 10, edgeInfluence: 70, randomness: 35,
    originalGarment: 55, opacity: 90, charset: "#+*=-:."
  });
  const [tolerance, setTolerance] = useState(30);
  const [brushSize, setBrushSize] = useState(22);

  const maskRef = useRef(null);
  const analysisRef = useRef(null);
  const displayRef = useRef(null);
  const paintingRef = useRef(false);
  const cursorRef = useRef(null);
  const [result, setResult] = useState(null);

  const set = (patch) => setParams((p) => ({ ...p, ...patch }));

  /* upload */
  const onFile = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const full = mk(img.naturalWidth, img.naturalHeight);
      cx(full).drawImage(img, 0, 0);
      const s = Math.min(1, PREVIEW_MAX / Math.max(full.width, full.height));
      const prev = scaleTo(full, full.width * s, full.height * s);
      maskRef.current = mk(prev.width, prev.height);
      analysisRef.current = analyze(prev);
      setFullImage(full);
      setPreview(prev);
      setResult(null);
      setView("result");
      setTool("wand");
      setMaskTick((t) => t + 1);
    };
    img.src = url;
  }, []);

  /* composição (debounce leve) */
  useEffect(() => {
    if (!preview) return;
    const id = setTimeout(() => {
      const mask = maskRef.current;
      const has = mask && maskAlphaArr(mask).some((v) => v > 0);
      setResult(
        has ? renderComposite(preview, mask, params, analysisRef.current, 1337) : preview
      );
    }, 40);
    return () => clearTimeout(id);
  }, [preview, params, maskTick]);

  const outline = useMemo(
    () => (maskRef.current ? makeOutline(maskRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maskTick]
  );

  /* desenho do palco */
  const draw = useCallback(() => {
    const canvas = displayRef.current;
    if (!canvas || !preview) return;
    if (canvas.width !== preview.width) canvas.width = preview.width;
    if (canvas.height !== preview.height) canvas.height = preview.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (view === "mask") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (maskRef.current) ctx.drawImage(maskRef.current, 0, 0);
    } else if (view === "original") {
      ctx.drawImage(preview, 0, 0);
    } else {
      ctx.drawImage(result || preview, 0, 0);
    }
    if (view !== "mask" && maskRef.current) {
      if (tool !== "result") {
        ctx.globalAlpha = tool === "wand" ? 0.16 : 0.26;
        ctx.drawImage(maskRef.current, 0, 0);
        ctx.globalAlpha = 1;
      }
      if (outline) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(outline, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    if ((tool === "add" || tool === "remove") && cursorRef.current) {
      const { x, y } = cursorRef.current;
      ctx.strokeStyle = tool === "add" ? "rgba(240,240,236,.9)" : "rgba(240,120,110,.9)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(x, y, brushSize, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [preview, result, view, tool, outline, brushSize]);

  useEffect(() => { draw(); }, [draw]);

  /* interação */
  const toCoords = (e) => {
    const canvas = displayRef.current;
    if (!canvas || !preview) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * preview.width;
    const y = ((e.clientY - rect.top) / rect.height) * preview.height;
    if (x < 0 || y < 0 || x >= preview.width || y >= preview.height) return null;
    return { x, y };
  };

  const onPointerDown = (e) => {
    const pt = toCoords(e);
    if (!pt || !maskRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "wand") {
      wandFill(analysisRef.current, maskRef.current, pt.x, pt.y, tolerance);
      setMaskTick((t) => t + 1);
    } else {
      paintingRef.current = true;
      paintBrush(maskRef.current, pt.x, pt.y, brushSize, tool);
      draw();
    }
  };
  const onPointerMove = (e) => {
    const pt = toCoords(e);
    cursorRef.current = pt;
    if (paintingRef.current && pt && maskRef.current) {
      paintBrush(maskRef.current, pt.x, pt.y, brushSize, tool);
    }
    draw();
  };
  const endPaint = () => {
    if (paintingRef.current) {
      paintingRef.current = false;
      setMaskTick((t) => t + 1);
    }
  };

  const clearMask = () => {
    if (!maskRef.current) return;
    cx(maskRef.current).clearRect(0, 0, maskRef.current.width, maskRef.current.height);
    setMaskTick((t) => t + 1);
  };

  /* exportação em resolução original */
  const doExport = (fmt) => {
    if (!fullImage || !preview || busy) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const scale = fullImage.width / preview.width;
        // máscara em resolução total, com alpha binarizado
        const fullMask = scaleTo(maskRef.current, fullImage.width, fullImage.height);
        const md = cx(fullMask).getImageData(0, 0, fullMask.width, fullMask.height);
        for (let j = 3; j < md.data.length; j += 4) md.data[j] = md.data[j] > 64 ? 255 : 0;
        cx(fullMask).putImageData(md, 0, 0);
        const exportParams = { ...params, charSize: Math.max(5, Math.round(params.charSize * scale)) };
        const out = renderComposite(fullImage, fullMask, exportParams, analyze(fullImage), 1337);
        out.toBlob(
          (blob) => {
            if (blob) {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `garment-algorithm.${fmt}`;
              a.click();
              URL.revokeObjectURL(a.href);
            }
            setBusy(false);
          },
          fmt === "png" ? "image/png" : "image/jpeg",
          0.92
        );
      } catch {
        setBusy(false);
      }
    }, 30);
  };

  /* layout */
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      background: C.bg0, color: C.hi, fontFamily: mono, fontSize: 13
    }}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${C.line}`, gap: 8, flexWrap: "wrap"
      }}>
        <h1 style={{ margin: 0, fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 400 }}>
          Garment Algorithm
        </h1>
        <div style={{ display: "flex", gap: 6 }}>
          {fullImage && (
            <Btn subtle onClick={() => { setFullImage(null); setPreview(null); setResult(null); }}>
              Nova imagem
            </Btn>
          )}
          <Btn disabled={!fullImage || busy} onClick={() => doExport("png")}>
            {busy ? "Renderizando…" : "Exportar PNG"}
          </Btn>
          <Btn disabled={!fullImage || busy} onClick={() => doExport("jpg")}>Exportar JPG</Btn>
        </div>
      </header>

      <main style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: C.bg2, padding: 16, minHeight: 320
      }}>
        {preview ? (
          <canvas
            ref={displayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPaint}
            onPointerLeave={() => { cursorRef.current = null; endPaint(); draw(); }}
            style={{
              maxWidth: "100%", maxHeight: "62vh", border: `1px solid ${C.line}`,
              touchAction: "none",
              cursor: tool === "wand" ? "crosshair" : "none"
            }}
          />
        ) : (
          <label style={{
            width: "min(520px, 90%)", height: 220, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
            border: `1px dashed ${C.lineHi}`, cursor: "pointer", textAlign: "center"
          }}>
            <span style={{ fontSize: 13 }}>Solte uma imagem aqui</span>
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.low }}>ou</span>
            <span style={{ border: `1px solid ${C.lineHi}`, padding: "6px 12px", fontSize: 11, color: C.mid }}>
              Escolher imagem
            </span>
            <span style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.low }}>
              jpg · jpeg · png · webp
            </span>
            <input
              type="file" accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files && e.target.files[0])}
            />
          </label>
        )}
      </main>

      {preview && (
        <section style={{ borderTop: `1px solid ${C.line}`, background: C.bg1, padding: "12px 14px 18px" }}>
          {/* seleção */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.low, marginRight: 4 }}>
              Seleção
            </span>
            <Btn active={tool === "wand"} onClick={() => setTool("wand")}>Varinha</Btn>
            <Btn active={tool === "add"} onClick={() => setTool("add")}>Pincel +</Btn>
            <Btn active={tool === "remove"} onClick={() => setTool("remove")}>Pincel −</Btn>
            <Btn subtle onClick={clearMask}>Limpar</Btn>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.low }}>Ver</span>
            {["original", "mask", "result"].map((m) => (
              <Btn key={m} subtle active={view === m} onClick={() => setView(m)}>
                {m === "original" ? "Original" : m === "mask" ? "Máscara" : "Resultado"}
              </Btn>
            ))}
          </div>

          <p style={{ margin: "0 0 12px", fontSize: 10, lineHeight: 1.6, color: C.low }}>
            Toque na peça de roupa com a varinha para selecioná-la por semelhança de cor
            (toques repetidos somam regiões). Refine com os pincéis. O efeito é aplicado
            apenas dentro da máscara — o resto da foto permanece intocado.
          </p>

          <div style={{
            display: "grid", gap: "0 28px",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"
          }}>
            <div>
              {tool === "wand" && (
                <Slider label="Tolerância da varinha" value={tolerance} onChange={setTolerance} />
              )}
              {(tool === "add" || tool === "remove") && (
                <Slider label="Tamanho do pincel" value={brushSize} min={4} max={90} suffix="px" onChange={setBrushSize} />
              )}
              <Slider label="Densidade" value={params.density} onChange={(v) => set({ density: v })} />
              <Slider label="Tamanho do caractere" value={params.charSize} min={6} max={26} suffix="px" onChange={(v) => set({ charSize: v })} />
              <Slider label="Influência das bordas" value={params.edgeInfluence} onChange={(v) => set({ edgeInfluence: v })} />
            </div>
            <div>
              <Slider label="Aleatoriedade" value={params.randomness} onChange={(v) => set({ randomness: v })} />
              <Slider label="Peça original" value={params.originalGarment} onChange={(v) => set({ originalGarment: v })} />
              <Slider label="Opacidade do algoritmo" value={params.opacity} onChange={(v) => set({ opacity: v })} />
              <label style={{ display: "block" }}>
                <span style={{ display: "block", marginBottom: 4, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mid }}>
                  Conjunto de caracteres
                </span>
                <input
                  value={params.charset}
                  spellCheck={false}
                  onChange={(e) => set({ charset: e.target.value })}
                  style={{
                    width: "100%", boxSizing: "border-box", background: C.bg0, color: C.hi,
                    border: `1px solid ${C.line}`, padding: "7px 8px",
                    fontFamily: mono, fontSize: 13, letterSpacing: "0.2em", outline: "none"
                  }}
                  aria-label="Conjunto de caracteres, denso para claro"
                />
                <span style={{ fontSize: 9, color: C.low }}>Ordenado denso → claro</span>
              </label>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
