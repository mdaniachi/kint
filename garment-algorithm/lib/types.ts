/** A detected (or manually created) garment with a full-resolution mask. */
export interface Garment {
  id: string;
  label: string;
  confidence?: number;
  /** Full-resolution mask. White pixels with alpha = mask coverage. */
  maskCanvas: HTMLCanvasElement;
  /** True when created by hand rather than by the segmentation service. */
  manual?: boolean;
}

/**
 * Which way the characters contrast against the garment. "auto" reads the
 * garment's own tone: dark garments take light ink, light garments take
 * dark ink. Ink direction also flips what the characters describe — light
 * ink builds up in the lit areas, dark ink builds up in the shadows — so
 * the glyphs reinforce the form either way instead of inverting it.
 */
export type InkMode = "auto" | "light" | "dark";

export interface EffectParameters {
  /** 0..100 — overall amount of characters. */
  density: number;
  /** Character cell size in preview pixels (scaled up for export). */
  charSize: number;
  /** 0..100 — how strongly edges/folds attract characters. */
  edgeInfluence: number;
  /**
   * 0..100 — how much each character rotates to follow the local fabric
   * direction (folds, seams, silhouette). 0 keeps strict horizontal rows.
   */
  flow: number;
  /**
   * 0..100 — how much character size follows the garment's light: lit
   * surfaces grow, shadow shrinks. 0 keeps every glyph the same size.
   */
  sizeByLight: number;
  /** 0..100 — irregularity of placement and glyph choice. */
  randomness: number;
  /** 0..100 — visibility of the photographic garment underneath. */
  originalGarment: number;
  /** 0..100 — opacity of the rendered characters. */
  opacity: number;
  /** Glyphs ordered dense → light. */
  charset: string;
  /** Character colour relative to the garment. */
  ink: InkMode;
  /**
   * "auto" follows the ink direction (light characters on dark garments,
   * dark on light). Any CSS colour overrides it without changing where the
   * characters go — direction and colour are separate decisions.
   */
  inkColor: string;
}

export const DEFAULT_PARAMS: EffectParameters = {
  density: 68,
  charSize: 11,
  edgeInfluence: 35,
  flow: 50,
  sizeByLight: 30,
  randomness: 30,
  originalGarment: 100,
  opacity: 100,
  charset: "#+=-:.",
  ink: "auto",
  inkColor: "auto"
};

/**
 * Everything adjustable about how one garment is treated. Lives per
 * garment, not in the panel: the panel is just an editor for the active
 * garment's settings.
 */
export interface GarmentSettings {
  effectId: string;
  params: EffectParameters;
  /** Mask grow (+) / shrink (−) in preview pixels. */
  maskEdge: number;
}

export function defaultSettings(): GarmentSettings {
  return { effectId: "ascii-reconstruction", params: { ...DEFAULT_PARAMS }, maskEdge: 0 };
}

export type ViewMode = "original" | "mask" | "result";

/** Precomputed per-pixel analysis of an image. */
export interface Analysis {
  /** Luminance, 0..1. */
  lum: Float32Array;
  /** Sobel edge magnitude, 0..1. */
  edge: Float32Array;
  /**
   * Local fabric direction in radians, wrapped to (-PI/2, PI/2]. This is the
   * direction *along* edges (perpendicular to the luminance gradient), from
   * a box-blurred structure tensor.
   */
  flow: Float32Array;
  /**
   * 0..1 — how directional the neighbourhood actually is. Flat cloth has no
   * meaningful direction; orientation there is noise and should be ignored.
   */
  coherence: Float32Array;
  width: number;
  height: number;
}

/**
 * Modular effect interface. Effects render a transparent layer that the
 * compositor draws on top of the untouched original image. The layer must
 * already be clipped to the garment mask.
 */
export interface GarmentEffect {
  id: string;
  name: string;
  render(
    image: HTMLCanvasElement,
    mask: HTMLCanvasElement,
    params: EffectParameters,
    analysis: Analysis,
    seed: number
  ): HTMLCanvasElement;
}
