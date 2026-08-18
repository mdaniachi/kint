# KINT STUDIO

A web-based creative tool: upload a fashion photograph, the app detects the garments, you click one, and an algorithmic treatment is rendered strictly inside that garment's mask. Every pixel outside the mask comes directly from the original photograph. Four treatments ship — ASCII Reconstruction, Halftone, Contour Lines, Scanline — and every garment carries its own effect and settings.

```
UPLOAD → DETECT → SELECT GARMENT → APPLY EFFECT → ADJUST → EXPORT
```

## Run it

```bash
npm install
npm run setup:model    # one-time: downloads the detection model (~29 MB)
npm run dev
```

Open http://localhost:3000. No account, no API key, no `.env` needed.

## Garment detection

Detection runs **on this machine**, in the browser. A clothes-parsing model
(`Xenova/segformer_b2_clothes`, 18 classes: top, pants, dress, skirt, hat, bag,
shoes, …) executes in a Web Worker via ONNX Runtime WebAssembly. The inference
library is served from `public/vendor/`, the weights from `public/models/`, the
runtime from `public/ort/` — all on this origin. **No photograph and no request
ever leaves the computer.**

- `npm run setup:model` fetches the quantised weights (~29 MB) and copies the
  library and wasm runtime out of `node_modules`. Run once; the three
  directories are gitignored.
- transformers.js is loaded at runtime (`import()` of `/vendor/…`) rather than
  bundled. Its ONNX runtime ships pre-minified ESM that Next's minifier cannot
  parse, and its browser build imports two bare specifiers a Worker cannot
  resolve — `setup:model` rewrites both to the vendored ORT bundle. Keeping it
  out of the bundle also holds the first-load JS under 100 kB.
- The worker starts when the studio mounts, so the model is usually warm by the
  time the first photograph is picked. First inference is a few seconds; after
  that it is roughly a second per photograph.
- Multi-threaded wasm is deliberately off. It needs `SharedArrayBuffer`, which
  would require cross-origin isolation headers on every response — not worth it
  for one model.
- Detection is never faked. If it fails, the app says so and you can still paint
  a mask by hand (**+ Manual mask**) and use the whole effect pipeline on it.

### Using a hosted provider instead

`app/api/segment/route.ts` still holds a Hugging Face Inference provider. Set
`NEXT_PUBLIC_SEGMENTATION_PROVIDER=remote` and `HF_TOKEN` in `.env.local` to
route through it. The response shape (`[{ label, score, mask }]`) is the
contract — any hosted segmenter can be swapped in without touching the UI.

## Using the tool

- **Hover** an untreated garment to see it as a translucent overlay with label + confidence; **click** to treat it, click again to release. **Several garments can be treated at once** — each gets its own layer, its own ink direction and its own stable seed, so a white blazer and black trousers in one photograph are read separately.
- **Treated garments carry no outline and no tint.** The canvas shows exactly what Export writes: the only marks on a selected garment are the characters themselves. Selection is legible from the side list (and from the treatment itself). The mask only becomes visible again while the refine brush is active, because painting needs to see it.
- **Settings are per garment.** The panel edits the *active* garment (the most recently selected — its name shows under "Editing"), so the shirt can run ASCII while the trousers run Halftone, each with its own density, colour and mask edge. **Apply to all** copies the active garment's full setup onto every treated garment.
- **Effect selector** at the top of the panel: ASCII Reconstruction, Halftone (screen-print dots, stretched along the fabric by Flow), Contour Lines (the garment's light quantised into topographic curves; the shade field is blurred before quantising so fabric grain doesn't read as static), Scanline (CRT sweeps whose thickness is the waveform of the tone; rows glitch sideways with Randomness).
- **Effect panel**: Density, Character size, **Mask edge**, Edge influence, **Flow**, **Size by light**, Randomness, Original garment, Algorithm opacity, Ink direction, Colour, and an editable character set (ordered dense → light). Parameters are reinterpreted per effect (e.g. in Contour Lines, Density is the number of bands and Character size is line weight + smoothing).
- **Flow** rotates each character to follow the local fabric direction — folds, seams, silhouette — so the glyphs hatch the drape instead of lying in flat rows. Direction comes from a box-blurred structure tensor over the luminance gradients (the tensor is smoothed, not the angle: +89° and −89° are nearly the same direction but average to zero). Rotation is weighted by local coherence, so flat cloth, which has no meaningful direction, stays horizontal instead of picking up noise.
- **Size by light** scales each glyph with the garment's own light: lit surfaces grow, shadow shrinks. Together with Flow it is the difference between "text laid over the roupa" and characters that describe its volume.
- **Animate** (footer) re-rolls the random part of the reconstruction (~8 fps): jitter, dropout and glyph blur re-decide each tick while the grid and tonal reading stay put, so the garment flickers as if being continuously reconstructed. Needs **Randomness** above 0 — at 0 there is nothing random to re-roll and the frame is static.
- **Export WebM** records ~3.2 s (32 frames, 10 fps) of that flicker via MediaRecorder — the browser's native encoder, no dependencies. It records in real time at preview resolution; GIF is deliberately out (needs a bundled encoder, and WebM loops everywhere a GIF would).
- **Mask edge** grows (+) or shrinks (−) every treated mask by up to 16 preview pixels. Detection edges never land exactly where you want them: shrinking pulls the treatment back off a halo, growing lets it bleed past the garment on purpose. It is a mask transform, applied before the effect runs — dilation is separable (two passes, 2·(2r+1) blits instead of (2r+1)²) so it stays interactive, and erosion is dilation of the complement. It is suspended while the refine brush is active so the mask matches what you paint.
- **Ink** and **Colour** are separate: Ink decides *where* the characters go (dark garments fill their highlights, light garments their shadows), Colour decides what they look like. Setting a colour never moves a character.
- **View modes** (bottom left): Original / Mask (selected garment as white on black) / Result.
- **Refine mask** (bottom right): Add / Remove brush painting on the selected mask — segmentation is never perfect and output quality depends on mask quality. Manual masks start empty in Add mode.
- **Export** (top right): PNG or JPG at the original image dimensions. The composition is re-rendered at full resolution (character size scales with it) — never a screenshot of the interface. **Export Layer** writes the effect alone as a transparent RGBA PNG at full resolution, for compositing over the original RAW/TIFF in Photoshop/After Effects — the app becomes a step in the pipeline instead of the end of it.

## How the effect works

The treatment *reads* the garment rather than tiling a pattern:

1. Luminance and Sobel edge maps are computed for the image (`lib/analysis.ts`).
2. The garment's **own tonal range** is measured (3rd/97th luminance percentiles
   inside the mask) and stretched to 0..1. A black jacket may occupy only
   0.05..0.30 of the photograph's range; without this step the characters would
   describe the photo's light instead of the garment's, and the mask would come
   back nearly empty.
3. A monospace grid walks the mask. The horizontal step is the font's own
   advance width, so neighbouring characters butt together into solid runs
   instead of floating apart as isolated specks. Vertical jitter stays small so
   rows read as rows; at **Randomness** 0 the grid is exact.
4. **Ink** direction comes from the garment's mean tone (or is forced in the
   panel). A dark garment takes light characters that build up in its
   *highlights*; a light garment takes dark characters that build up in its
   *shadows*. Either way the glyphs reinforce the form instead of printing a
   negative of it — white characters on a white blazer would simply vanish.
5. Placement is a **threshold**, not a per-cell coin flip: once the local shade
   crosses the line set by **Density**, the region fills solidly, and
   **Randomness** only frays the boundary. An independent random draw per cell
   scatters isolated characters like salt and pepper; contiguity is what makes
   the output read as a reconstruction rather than as noise.
6. **Edge influence** adds on top, so folds and silhouettes recruit extra
   characters; shade also selects the glyph from the dense→light ramp.
7. **Original garment** below 100 dims the photograph under the glyphs; at 100
   (the default) the photograph is untouched and only the characters are added.
   The layer is clipped to the mask with `destination-in`, then drawn over the
   untouched original:

```
Final Image = Original Image + (Algorithm Effect x Garment Mask)
```

### Tuning the effect without a photo

`/dev/effect-preview` renders a synthetic scene (dark subject, lit topline) and
its mask, with live sliders. It imports the real effect module, so it is the
fastest way to judge a parameter change or a new treatment. Dev-only, not linked
from the app.

## Architecture

```
app/
  page.tsx                     entry
  api/segment/route.ts         segmentation provider (Hugging Face) — swappable
lib/
  brand.ts                     product name + export filename slug
components/
  Studio.tsx                   state orchestration, layout, export
  CanvasStage.tsx              display canvas, hover/select hit testing, brush painting
  controls.tsx                 upload zone, garment list, effect sliders
lib/
  types.ts                     Garment, EffectParameters, GarmentEffect interface
  compose.ts                   final compositor (original + masked effect layer)
  analysis.ts                  luminance/edge maps, seeded PRNG
  maskUtils.ts                 mask decode/merge/outline/brush/hit-test helpers
  effects/
    shared.ts                  tonal reading, ink resolution, dim, clip
    asciiReconstruction.ts     characters hatching the drape
    halftone.ts                screen-print dots
    contourLines.ts            topographic curves of the light
    scanline.ts                CRT sweeps
    index.ts                   effect registry
  segmentation/
    client.ts                  segmentImage() service boundary + provider choice
    local.ts                   in-browser provider (spawns the worker)
    segmenter.worker.ts        the model, off the main thread
    remote.ts                  hosted provider via /api/segment
    garments.ts                shared post-processing (merge, filter, sort)
    labels.ts                  label mapping/filtering for clothes-parsing models
    errors.ts                  SegmentationError
scripts/
  setup-model.mjs              one-time model + wasm runtime fetch
public/
  vendor/                      transformers.js + ORT bundle (gitignored)
  models/                      weights (gitignored, see setup:model)
  ort/                         ONNX wasm runtime (gitignored)
```

- **Segmentation is a service boundary**: the UI only calls `segmentImage()`. Two providers sit behind it — local (default) and remote — and both funnel through the same post-processing.
- **Effects are modular**: a treatment implements `GarmentEffect` and registers in `lib/effects/index.ts` — that is the only wiring. It receives the image, the mask, parameters, precomputed analysis (luminance, edges, fabric direction), and a stable seed; masks, multi-selection, per-garment settings, animation and every export come for free. The four shipped effects agree on what "light", "shade" and "ink" mean through `lib/effects/shared.ts`.
- **Two resolutions**: interaction and live rendering happen on a ≤1600px preview; export re-renders at full resolution with scaled parameters. This same split is what a future video mode would build on (per-frame analysis + mask tracking feeding the same effect interface).

## Deliberately out of scope (per the brief)

Video, accounts, auth, database, billing, project management. The creative interaction is the product.
