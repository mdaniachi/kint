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
 * Scanline
 *
 * CRT-style horizontal sweeps: one line per row of the grid, its thickness
 * modulated by the garment's tone like a waveform. Randomness shifts whole
 * rows sideways — the glitch that animation re-rolls every frame. Flow
 * bends each line vertically to ride the fabric direction instead of
 * cutting straight across it.
 */
export const scanline: GarmentEffect = {
  id: "scanline",
  name: "Scanline",

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
    const { lum, flow, coherence } = analysis;
    const rand = mulberry32(seed);
    const reading = readGarment(lum, alpha, p);

    applyBackdropDim(ctx, w, h, p);

    const gap = Math.max(3, p.charSize);
    const density = p.density / 100;
    const rnd = p.randomness / 100;
    const flowW = p.flow / 100;
    const sizeW = p.sizeByLight / 100;
    const step = 2; // horizontal resolution of each sweep

    const clampX = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v | 0);
    const clampY = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v | 0);

    ctx.globalAlpha = p.opacity / 100;
    ctx.fillStyle = reading.ink;

    for (let gy = gap * 0.5; gy < h; gy += gap) {
      // Whole-row glitch shift; re-rolled per frame in animation.
      const rowShift = (rand() - 0.5) * rnd * gap * 2.5;
      // Vertical drift accumulates as the line rides the fabric direction.
      let drift = 0;

      for (let x = 0; x < w; x += step) {
        const sx = clampX(x + rowShift);
        const sy = clampY(gy + drift);
        const i = sy * w + sx;

        if (flowW > 0) {
          const c = Math.min(1, coherence[i] * 1.6);
          drift += Math.tan(flow[i] * 0.9) * step * flowW * c * 0.5;
          if (drift > gap) drift = gap;
          if (drift < -gap) drift = -gap;
        }

        if (alpha[i] < 128) continue;

        // Same threshold discipline as the other effects: the sweep only
        // exists where enough ink belongs, randomness frays the ends.
        const shade = shadeAt(lum, i, reading);
        const cut = 1.02 - density * 1.02;
        if (shade + (rand() - 0.5) * rnd * 0.4 < cut) continue;

        // Thickness is the waveform: tone in, line weight out.
        let th = gap * 0.62 * (0.12 + 0.88 * shade);
        th *= 1 + sizeW * (shade - 0.35) * 1.1;
        if (th < 0.35) continue;

        ctx.fillRect(x, sy - th * 0.5, step, th);
      }
    }
    ctx.globalAlpha = 1;

    clipToMask(ctx, mask, w, h);
    return layer;
  }
};
