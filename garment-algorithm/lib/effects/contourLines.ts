import type { Analysis, EffectParameters, GarmentEffect } from "../types";
import { createCanvas, ctx2d, maskAlpha } from "../maskUtils";
import { boxBlur } from "../analysis";
import {
  applyBackdropDim,
  clipToMask,
  readGarment,
  shadeAt
} from "./shared";

/**
 * Contour Lines
 *
 * The garment's light quantised into bands, drawing only the boundaries —
 * topographic curves of the illumination. Density sets how many levels the
 * light is sliced into, Character size sets line weight, and Randomness
 * perturbs the band thresholds with a seeded per-pixel noise, which is what
 * makes the contours quiver in animation.
 */
export const contourLines: GarmentEffect = {
  id: "contour-lines",
  name: "Contour Lines",

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
    const { lum } = analysis;
    const reading = readGarment(lum, alpha, p);

    applyBackdropDim(ctx, w, h, p);

    // 4..22 bands. More density = more slices = tighter topography.
    const levels = 4 + Math.round((p.density / 100) * 18);
    const rnd = p.randomness / 100;
    const noiseAmp = (rnd * 1.4) / levels;

    // Shade field with seeded hash noise, then blurred. The blur is what
    // turns fabric grain into topography: raw denim texture makes a band
    // boundary at every thread and the result reads as static. Smoothing
    // BEFORE quantising yields long coherent curves, and because the noise
    // is added before the blur it survives as low-frequency wobble (the
    // quiver in animation) instead of per-pixel speckle.
    const field = new Float32Array(w * h);
    const s0 = seed | 0;
    for (let i = 0; i < field.length; i++) {
      let t = shadeAt(lum, i, reading);
      if (noiseAmp > 0) {
        let hsh = (i ^ s0) * 2654435761;
        hsh = (hsh ^ (hsh >>> 13)) * 1274126177;
        hsh = hsh ^ (hsh >>> 16);
        t += ((hsh >>> 0) / 4294967296 - 0.5) * noiseAmp;
      }
      field[i] = t;
    }
    // Character size doubles as smoothing radius: bigger = calmer curves.
    boxBlur(field, w, h, Math.max(2, Math.round(p.charSize / 2)));

    const q = new Int16Array(w * h);
    for (let i = 0; i < q.length; i++) {
      if (alpha[i] < 128) {
        q[i] = -1;
        continue;
      }
      let lvl = Math.floor(field[i] * levels);
      if (lvl < 0) lvl = 0;
      if (lvl >= levels) lvl = levels - 1;
      q[i] = lvl;
    }

    // Boundary pixels: level changes against the right or lower neighbour,
    // both inside the mask.
    const line = createCanvas(w, h);
    const lc = ctx2d(line);
    const img = lc.createImageData(w, h);
    const d = img.data;
    // reading.ink is either an rgba() we control or a user hex colour; parse
    // via a scratch fill to stay format-agnostic.
    lc.fillStyle = reading.ink;
    lc.fillRect(0, 0, 1, 1);
    const px = lc.getImageData(0, 0, 1, 1).data;
    lc.clearRect(0, 0, w, h);

    for (let y = 0; y < h - 1; y++) {
      const row = y * w;
      for (let x = 0; x < w - 1; x++) {
        const i = row + x;
        const v = q[i];
        if (v < 0) continue;
        const r = q[i + 1];
        const b = q[i + w];
        if ((r >= 0 && r !== v) || (b >= 0 && b !== v)) {
          const j = i * 4;
          d[j] = px[0];
          d[j + 1] = px[1];
          d[j + 2] = px[2];
          d[j + 3] = 255;
        }
      }
    }
    lc.putImageData(img, 0, 0);

    // Line weight: thicken the 1px boundaries by stamping shifted copies.
    const thickness = Math.max(1, Math.round(p.charSize / 8));
    ctx.globalAlpha = p.opacity / 100;
    for (let dx = 0; dx < thickness; dx++) {
      for (let dy = 0; dy < thickness; dy++) {
        ctx.drawImage(line, dx, dy);
      }
    }
    ctx.globalAlpha = 1;

    clipToMask(ctx, mask, w, h);
    return layer;
  }
};
