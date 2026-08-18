import type { EffectParameters } from "../types";

/**
 * Shared reading of a garment, used by every effect so they all agree on
 * what "light", "shade" and "ink" mean.
 */
export interface GarmentReading {
  lo: number;
  hi: number;
  span: number;
  mean: number;
  /** True when the garment is dark and takes light ink. */
  lightInk: boolean;
  /** Resolved fill style (honours the Colour override). */
  ink: string;
}

/**
 * Tonal range of the garment itself: (lo, hi) luminance percentiles plus
 * its mean. A garment rarely spreads across the full 0..1 range — a black
 * jacket may live entirely inside 0.05..0.30. Stretching its own range is
 * what makes an effect describe *its* light instead of the photograph's.
 */
export function readGarment(
  lum: Float32Array,
  alpha: Uint8ClampedArray,
  p: EffectParameters
): GarmentReading {
  const bins = new Uint32Array(256);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < alpha.length; i += 2) {
    if (alpha[i] < 128) continue;
    bins[(lum[i] * 255) | 0]++;
    sum += lum[i];
    n++;
  }

  let lo = 0;
  let hi = 1;
  let mean = 0.5;
  if (n >= 32) {
    mean = sum / n;
    const cutoff = n * 0.03;
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += bins[b];
      if (acc >= cutoff) {
        lo = b / 255;
        break;
      }
    }
    acc = 0;
    for (let b = 255; b >= 0; b--) {
      acc += bins[b];
      if (acc >= cutoff) {
        hi = b / 255;
        break;
      }
    }
    if (hi - lo < 0.04) hi = lo + 0.04;
  }

  // Ink direction: a dark garment takes light ink building up in its
  // highlights, a light garment takes dark ink building up in its shadows.
  // Either way the marks reinforce the form instead of printing a negative.
  const lightInk = p.ink === "auto" ? mean < 0.5 : p.ink === "light";
  const ink =
    p.inkColor && p.inkColor !== "auto"
      ? p.inkColor
      : lightInk
        ? "rgba(246,245,241,1)"
        : "rgba(14,13,12,1)";

  return { lo, hi, span: hi - lo, mean, lightInk, ink };
}

/** Shade at pixel i: how much ink belongs there, 0..1, ink-direction aware. */
export function shadeAt(
  lum: Float32Array,
  i: number,
  r: GarmentReading
): number {
  let t = (lum[i] - r.lo) / r.span;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return r.lightInk ? t : 1 - t;
}

/** Layer A of every effect: dim the photographic garment underneath. */
export function applyBackdropDim(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: EffectParameters
): void {
  const dim = 1 - p.originalGarment / 100;
  if (dim > 0.005) {
    ctx.fillStyle = `rgba(8,8,7,${(dim * 0.85).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Final step of every effect: clip the whole layer to the garment mask. */
export function clipToMask(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  w: number,
  h: number
): void {
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}
