import type { Analysis } from "./types";
import { ctx2d } from "./maskUtils";

/**
 * Compute per-pixel luminance and Sobel edge magnitude for an image.
 * Both maps are normalized to 0..1. This is what makes the effect "read"
 * the garment instead of tiling a pattern over it.
 */
export function analyzeCanvas(image: HTMLCanvasElement): Analysis {
  const w = image.width;
  const h = image.height;
  const { data } = ctx2d(image).getImageData(0, 0, w, h);
  const n = w * h;

  const lum = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    lum[i] =
      (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
  }

  const edge = new Float32Array(n);
  const jxx = new Float32Array(n);
  const jxy = new Float32Array(n);
  const jyy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
      const l = lum[i - 1], r = lum[i + 1];
      const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const mag = Math.sqrt(gx * gx + gy * gy) * 0.9;
      edge[i] = mag > 1 ? 1 : mag;
      // Structure tensor entries, blurred below into a stable orientation.
      jxx[i] = gx * gx;
      jxy[i] = gx * gy;
      jyy[i] = gy * gy;
    }
  }

  // Smooth the tensor, not the angle: angles average badly (+89° and -89°
  // are almost the same direction but cancel), tensor entries average fine.
  const R = 6;
  boxBlur(jxx, w, h, R);
  boxBlur(jxy, w, h, R);
  boxBlur(jyy, w, h, R);

  const flow = new Float32Array(n);
  const coherence = new Float32Array(n);
  const HALF_PI = Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const a = jxx[i];
    const b = jxy[i];
    const c = jyy[i];
    const sum = a + c;
    if (sum < 1e-7) continue; // flat: no direction, coherence stays 0
    // Dominant gradient orientation; the fabric runs perpendicular to it.
    let ang = 0.5 * Math.atan2(2 * b, a - c) + HALF_PI;
    if (ang > HALF_PI) ang -= Math.PI;
    flow[i] = ang;
    coherence[i] = Math.sqrt((a - c) * (a - c) + 4 * b * b) / sum;
  }

  return { lum, edge, flow, coherence, width: w, height: h };
}

/** In-place separable box blur (moving average), radius r. */
export function boxBlur(data: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(data.length);
  const norm = 1 / (2 * r + 1);

  // Horizontal pass: data -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) {
      acc += data[row + Math.min(w - 1, Math.max(0, x))];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      const add = row + Math.min(w - 1, x + r + 1);
      const sub = row + Math.max(0, x - r);
      acc += data[add] - data[sub];
    }
  }

  // Vertical pass: tmp -> data
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) {
      acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    }
    for (let y = 0; y < h; y++) {
      data[y * w + x] = acc * norm;
      const add = Math.min(h - 1, y + r + 1) * w + x;
      const sub = Math.max(0, y - r) * w + x;
      acc += tmp[add] - tmp[sub];
    }
  }
}

const analysisCache = new WeakMap<HTMLCanvasElement, Analysis>();

/** Cached analysis, keyed by canvas identity. */
export function getAnalysis(image: HTMLCanvasElement): Analysis {
  let a = analysisCache.get(image);
  if (!a || a.width !== image.width || a.height !== image.height) {
    a = analyzeCanvas(image);
    analysisCache.set(image, a);
  }
  return a;
}

/** Deterministic PRNG so re-renders are stable for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
