/** Canvas + mask helpers. Masks are white pixels whose alpha channel is the mask. */

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** Draw an image/canvas into a new canvas at the given size. */
export function scaleTo(
  src: CanvasImageSource,
  w: number,
  h: number
): HTMLCanvasElement {
  const c = createCanvas(w, h);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * Decode a base64 PNG mask (white-on-black, as returned by segmentation APIs)
 * into a normalized alpha mask sized to the original image.
 */
export function decodeMaskBase64(
  b64: string,
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const raw = scaleTo(img, width, height);
      const rctx = ctx2d(raw);
      const data = rctx.getImageData(0, 0, width, height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        // Treat brightness as coverage; make pixel pure white with that alpha.
        const v = px[i]; // grayscale mask: r == g == b
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = v > 127 ? 255 : 0;
      }
      rctx.putImageData(data, 0, 0);
      resolve(raw);
    };
    img.onerror = () => reject(new Error("Failed to decode mask image"));
    img.src = `data:image/png;base64,${b64}`;
  });
}

/** Union of two masks (same dimensions). */
export function mergeMasks(
  a: HTMLCanvasElement,
  b: HTMLCanvasElement
): HTMLCanvasElement {
  const c = createCanvas(a.width, a.height);
  const ctx = ctx2d(c);
  ctx.drawImage(a, 0, 0);
  ctx.drawImage(b, 0, 0);
  return c;
}

export function emptyMask(w: number, h: number): HTMLCanvasElement {
  return createCanvas(w, h);
}

/** Alpha channel of a mask as a flat Uint8 array (for hit testing / rendering). */
export function maskAlpha(mask: HTMLCanvasElement): Uint8ClampedArray {
  const { data } = ctx2d(mask).getImageData(0, 0, mask.width, mask.height);
  const out = new Uint8ClampedArray(mask.width * mask.height);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = data[j];
  return out;
}

/** Fraction of pixels covered by the mask (used to drop tiny segments). */
export function coverage(alpha: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 127) n++;
  return n / alpha.length;
}

/**
 * Build a thin outline ring from a mask by stamping the mask with small
 * offsets and punching out the interior.
 */
export function makeOutline(
  mask: HTMLCanvasElement,
  thickness = 2
): HTMLCanvasElement {
  const c = createCanvas(mask.width, mask.height);
  const ctx = ctx2d(c);
  const r = thickness;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (dx === 0 && dy === 0) continue;
      ctx.drawImage(mask, dx, dy);
    }
  }
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

/**
 * Dilate a mask by `r` pixels, separably: a horizontal pass then a vertical
 * one. That is 2·(2r+1) blits instead of (2r+1)² for the same square
 * structuring element — the difference between instant and unusable at
 * preview resolution.
 */
function dilateMask(mask: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const w = mask.width;
  const h = mask.height;

  const pass = (src: HTMLCanvasElement, horizontal: boolean) => {
    const out = createCanvas(w, h);
    const ctx = ctx2d(out);
    for (let d = -r; d <= r; d++) {
      ctx.drawImage(src, horizontal ? d : 0, horizontal ? 0 : d);
    }
    return out;
  };

  return pass(pass(mask, true), false);
}

/** Complement of a mask: covered becomes uncovered and vice versa. */
function invertMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(mask.width, mask.height);
  const ctx = ctx2d(out);
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/**
 * Grow (r > 0) or shrink (r < 0) a mask by r pixels. Segmentation edges are
 * never exactly where you want them: growing lets the treatment bleed a
 * little past the garment, shrinking pulls it back off a halo.
 *
 * Eroding is dilating the complement and complementing the result.
 */
export function growMask(
  mask: HTMLCanvasElement,
  r: number
): HTMLCanvasElement {
  const n = Math.round(r);
  if (n === 0) return mask;
  if (n > 0) return dilateMask(mask, n);
  return invertMask(dilateMask(invertMask(mask), -n));
}

/** Paint a round brush stroke on a mask (add or remove). */
export function paintBrush(
  mask: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  mode: "add" | "remove"
): void {
  const ctx = ctx2d(mask);
  ctx.globalCompositeOperation =
    mode === "add" ? "source-over" : "destination-out";
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}
