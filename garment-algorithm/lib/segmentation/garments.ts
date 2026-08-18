import type { Garment } from "../types";
import { coverage, createCanvas, ctx2d, maskAlpha, mergeMasks } from "../maskUtils";
import { friendlyLabel, isGarment, mergeKey } from "./labels";

/** Segments below this share of the image are treated as noise. */
const MIN_COVERAGE = 0.002;

export interface RawMask {
  label: string;
  score?: number;
  mask: HTMLCanvasElement;
}

/**
 * Shared post-processing for every segmentation provider: drop non-garment
 * classes, merge paired labels (left/right shoe), discard specks, and sort
 * largest first — which is how the eye scans the photograph.
 */
export function buildGarments(items: RawMask[]): Garment[] {
  const grouped = new Map<string, RawMask>();

  for (const item of items) {
    if (!isGarment(item.label)) continue;
    const key = mergeKey(item.label);
    const existing = grouped.get(key);
    if (existing) {
      existing.mask = mergeMasks(existing.mask, item.mask);
      existing.score = Math.min(existing.score ?? 1, item.score ?? 1);
    } else {
      grouped.set(key, { ...item, label: friendlyLabel(item.label) });
    }
  }

  const out: { g: Garment; area: number }[] = [];
  let n = 0;
  for (const [key, item] of Array.from(grouped.entries())) {
    const area = coverage(maskAlpha(item.mask));
    if (area < MIN_COVERAGE) continue;
    n += 1;
    out.push({
      area,
      g: {
        id: `seg-${key}`,
        label: item.label || `Garment ${String(n).padStart(2, "0")}`,
        confidence: item.score,
        maskCanvas: item.mask
      }
    });
  }

  out.sort((a, b) => b.area - a.area);
  return out.map((x) => x.g);
}

/**
 * Turn a single-channel mask (0..255 coverage) into a white canvas whose
 * alpha carries the coverage, scaled to the photograph's full resolution.
 */
export function maskFromGray(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const small = createCanvas(w, h);
  const sc = ctx2d(small);
  const img = sc.createImageData(w, h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
    img.data[j + 3] = data[i];
  }
  sc.putImageData(img, 0, 0);

  if (w === targetW && h === targetH) return small;
  const full = createCanvas(targetW, targetH);
  ctx2d(full).drawImage(small, 0, 0, targetW, targetH);
  return full;
}
