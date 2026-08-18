import type { EffectParameters } from "./types";
import { createCanvas, ctx2d } from "./maskUtils";
import { getAnalysis } from "./analysis";
import { getEffect } from "./effects";

/** One garment to treat, carrying its own effect and parameters. */
export interface EffectTarget {
  mask: HTMLCanvasElement;
  seed: number;
  effectId: string;
  params: EffectParameters;
}

/**
 * Composite:
 *
 *   Final Image = Original Image + Σ (Effect Layer x Garment Mask)
 *
 * Layers render independently — each garment has its own effect, its own
 * parameters, its own ink direction and its own stable seed. With
 * `drawBase` false the photograph is omitted and the return value is just
 * the transparent sum of the effect layers, which is what the layer export
 * hands to Photoshop/After Effects.
 */
export function renderComposite(
  image: HTMLCanvasElement,
  targets: EffectTarget[],
  drawBase = true
): HTMLCanvasElement {
  const out = createCanvas(image.width, image.height);
  const ctx = ctx2d(out);
  if (drawBase) ctx.drawImage(image, 0, 0);
  if (targets.length === 0) return out;

  const analysis = getAnalysis(image);
  for (const { mask, seed, effectId, params } of targets) {
    ctx.drawImage(
      getEffect(effectId).render(image, mask, params, analysis, seed),
      0,
      0
    );
  }
  return out;
}
