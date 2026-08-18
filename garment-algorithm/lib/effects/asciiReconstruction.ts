import type { Analysis, EffectParameters, GarmentEffect } from "../types";
import { createCanvas, ctx2d, maskAlpha } from "../maskUtils";
import { mulberry32 } from "../analysis";
import {
  applyBackdropDim,
  clipToMask,
  readGarment,
  shadeAt
} from "./shared";

const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/**
 * ASCII Reconstruction
 *
 * A monospace grid walks the garment. The garment's own tonal range is
 * stretched first, then:
 *
 *   - ink direction is chosen from the garment's mean tone, and "shade"
 *     becomes "how much ink belongs here" — highlights for light ink,
 *     shadows for dark ink;
 *   - shade crossing a threshold decides *whether* a character is placed
 *     and *which* glyph it is (dense → light ramp);
 *   - edges add on top, so folds and silhouettes recruit extra characters;
 *   - each glyph rotates to follow the local fabric direction (structure
 *     tensor), weighted by how directional the spot really is, and scales
 *     with the light — so the characters hatch the drape instead of lying
 *     in flat rows;
 *   - randomness frays the threshold boundary and blurs the glyph choice.
 *
 * The horizontal step is the font's own advance width, so neighbouring
 * characters butt together into solid runs instead of floating apart.
 * The layer is transparent, pre-clipped to the mask; the compositor draws
 * it over the untouched photograph.
 */
export const asciiReconstruction: GarmentEffect = {
  id: "ascii-reconstruction",
  name: "ASCII Reconstruction",

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

    // ── Layer A: optional dimming of the photograph underneath ────────
    applyBackdropDim(ctx, w, h, p);

    // ── Grid geometry ─────────────────────────────────────────────────
    const chars = (p.charset.replace(/\s+/g, "") || "#+*=-:.").split("");
    const fontSize = Math.max(4, p.charSize);
    ctx.font = `${fontSize}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Advance width of the monospace cell: characters tile edge to edge.
    const advance = ctx.measureText("#").width || fontSize * 0.6;
    const cellW = Math.max(2, advance * 1.06);
    const cellH = Math.max(3, fontSize * 1.04);

    const density = p.density / 100;
    const edgeW = p.edgeInfluence / 100;
    const rnd = p.randomness / 100;
    const flowW = p.flow / 100;
    const sizeW = p.sizeByLight / 100;

    const reading = readGarment(lum, alpha, p);

    const clampX = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v | 0);
    const clampY = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v | 0);

    ctx.globalAlpha = p.opacity / 100;
    ctx.fillStyle = reading.ink;

    for (let gy = cellH * 0.5; gy < h; gy += cellH) {
      for (let gx = 0; gx < w; gx += cellW) {
        // Jitter is proportional to randomness only: at 0 the grid is exact.
        // Vertical jitter stays small so rows survive as rows.
        const jx = (rand() - 0.5) * rnd * cellW * 0.85;
        const jy = (rand() - 0.5) * rnd * cellH * 0.4;

        const sx = clampX(gx + cellW * 0.5 + jx);
        const sy = clampY(gy + jy);
        const i = sy * w + sx;

        if (alpha[i] < 128) continue;

        // "Shade" = how much ink belongs here, ink-direction aware.
        const shade = shadeAt(lum, i, reading);

        const e = Math.max(
          edge[i],
          edge[clampY(sy - 1) * w + sx],
          edge[sy * w + clampX(sx - 1)]
        );

        // Lit surfaces fill in; edges recruit on top of that. The small
        // floor keeps shadow from going completely empty — the reference
        // look still carries sparse light glyphs down in the darks.
        // Exponent > 1 keeps the response contrasty: the garment's own
        // highlights fill in, its mid-tones and shadows open up. A flatter
        // curve fills the whole mask evenly and reads as a texture laid on
        // top rather than as the garment's light.
        const tone = 0.06 + 0.94 * Math.pow(shade, 1.5);
        const drive = Math.min(1, tone + edgeW * Math.min(1, e * 1.7) * 0.9);

        // Threshold, not a per-cell coin flip. An independent random draw
        // per cell scatters isolated characters like salt and pepper; a
        // threshold fills a region solidly once its tone crosses the line,
        // and randomness only frays the boundary. That contiguity is what
        // makes the characters read as a reconstruction of the garment.
        const cut = 1.06 - density * 1.06;
        if (drive + (rand() - 0.5) * rnd * 0.6 < cut) continue;

        // Glyph: bright → dense end of the ramp, randomness blurs the pick.
        let idx = Math.floor(
          (1 - shade) * chars.length + (rand() - 0.5) * rnd * 2.2
        );
        if (idx < 0) idx = 0;
        if (idx >= chars.length) idx = chars.length - 1;

        // Follow the fabric: rotate the glyph along the local direction,
        // weighted by how directional the neighbourhood actually is — flat
        // cloth has no meaningful direction and stays horizontal. Size
        // follows the light on top: lit surfaces grow, shadow shrinks.
        const angle =
          flowW > 0 ? flow[i] * flowW * Math.min(1, coherence[i] * 1.6) : 0;
        let scl = 1 + sizeW * (shade - 0.35) * 1.1;
        if (scl < 0.45) scl = 0.45;

        const cos = Math.cos(angle) * scl;
        const sin = Math.sin(angle) * scl;
        ctx.setTransform(cos, sin, -sin, cos, gx + cellW * 0.5 + jx, gy + jy);
        ctx.fillText(chars[idx], 0, 0);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    clipToMask(ctx, mask, w, h);
    return layer;
  }
};
