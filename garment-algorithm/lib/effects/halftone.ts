import type { Analysis, EffectParameters, GarmentEffect } from "../types";
import { createCanvas, ctx2d, maskAlpha } from "../maskUtils";
import { mulberry32 } from "../analysis";
import {
  applyBackdropDim,
  clipToMask,
  readGarment,
  shadeAt
} from "./shared";

/**
 * Halftone
 *
 * Screen-print dots: a jittered grid where dot size carries the garment's
 * tone — big dots where ink belongs, vanishing dots where it doesn't. Flow
 * stretches dots into ellipses along the fabric direction, so the screen
 * itself follows the drape. Placement uses the same threshold logic as the
 * ASCII effect: regions fill solidly, randomness only frays the boundary.
 */
export const halftone: GarmentEffect = {
  id: "halftone",
  name: "Halftone",

  render(
    image: HTMLCanvasElement,
    mask: HTMLCanvasElement,
    p: EffectParameters,
    analysis: Analysis,
    seed: number
  ): HTMLCanvasElement {
    const w = image.width;
    const h = image.height;
    const layer = createCanvas(w, h);
    const ctx = ctx2d(layer);

    const alpha = maskAlpha(mask);
    const { lum, edge, flow, coherence } = analysis;
    const rand = mulberry32(seed);
    const reading = readGarment(lum, alpha, p);

    applyBackdropDim(ctx, w, h, p);

    const cell = Math.max(4, p.charSize);
    const density = p.density / 100;
    const edgeW = p.edgeInfluence / 100;
    const rnd = p.randomness / 100;
    const flowW = p.flow / 100;
    const sizeW = p.sizeByLight / 100;

    const clampX = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v | 0);
    const clampY = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v | 0);

    ctx.globalAlpha = p.opacity / 100;
    ctx.fillStyle = reading.ink;

    for (let gy = cell * 0.5; gy < h; gy += cell) {
      for (let gx = cell * 0.5; gx < w; gx += cell) {
        const jx = (rand() - 0.5) * rnd * cell * 0.8;
        const jy = (rand() - 0.5) * rnd * cell * 0.8;
        const sx = clampX(gx + jx);
        const sy = clampY(gy + jy);
        const i = sy * w + sx;

        if (alpha[i] < 128) continue;

        const shade = shadeAt(lum, i, reading);
        const e = Math.max(
          edge[i],
          edge[clampY(sy - 1) * w + sx],
          edge[sy * w + clampX(sx - 1)]
        );

        const tone = 0.06 + 0.94 * Math.pow(shade, 1.4);
        const drive = Math.min(1, tone + edgeW * Math.min(1, e * 1.7) * 0.9);
        const cut = 1.06 - density * 1.06;
        if (drive + (rand() - 0.5) * rnd * 0.6 < cut) continue;

        // Dot radius carries the tone; Size by light exaggerates it.
        let r = cell * 0.5 * (0.18 + 0.82 * shade);
        r *= 1 + sizeW * (shade - 0.35) * 1.1;
        if (r < 0.4) continue;

        // Flow: stretch the dot into an ellipse along the fabric.
        const c = Math.min(1, coherence[i] * 1.6) * flowW;
        const angle = c > 0 ? flow[i] : 0;
        const rx = r * (1 + c * 0.9);
        const ry = r * (1 - c * 0.45);

        ctx.beginPath();
        ctx.ellipse(gx + jx, gy + jy, rx, ry, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    clipToMask(ctx, mask, w, h);
    return layer;
  }
};
