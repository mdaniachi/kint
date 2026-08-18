/// <reference lib="webworker" />

/**
 * In-browser clothes parsing. Runs off the main thread so the interface
 * stays responsive while the model loads and infers.
 *
 * Everything is served from this origin: the library from /vendor, the
 * weights from /models, the ONNX runtime from /ort. Remote model resolution
 * is switched off, so no image and no request ever leaves the machine.
 *
 * The library is imported at runtime rather than bundled — its ONNX runtime
 * ships pre-minified ESM that Next's minifier refuses to parse.
 */

const MODEL = "Xenova/segformer_b2_clothes";

// GitHub Pages serves the app from /<repo>, not from the domain root, so
// every path built here has to carry that prefix. Empty in dev and on a
// custom domain.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Kept in a variable so TypeScript does not try to resolve it as a module
// and webpack does not try to bundle it — it is fetched from this origin.
const LIBRARY_URL = `${BASE}/vendor/transformers.web.js`;

interface RawSegment {
  label: string;
  score?: number | null;
  mask: { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
}

type Segmenter = (input: string) => Promise<RawSegment[]>;

interface TransformersModule {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    localModelPath: string;
    backends: { onnx: { wasm?: { wasmPaths?: string; numThreads?: number } } };
  };
  pipeline: (
    task: "image-segmentation",
    model: string,
    options?: Record<string, unknown>
  ) => Promise<Segmenter>;
}

let segmenter: Segmenter | null = null;
let loading: Promise<Segmenter> | null = null;

async function getSegmenter(): Promise<Segmenter> {
  if (segmenter) return segmenter;
  if (!loading) {
    loading = (async () => {
      const { env, pipeline } = (await import(
        /* webpackIgnore: true */ LIBRARY_URL
      )) as TransformersModule;

      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = `${BASE}/models/`;

      const wasm = env.backends.onnx.wasm;
      if (wasm) {
        wasm.wasmPaths = `${BASE}/ort/`;
        // Single-threaded: multi-threaded wasm needs SharedArrayBuffer, which
        // would require cross-origin isolation headers on every response.
        wasm.numThreads = 1;
      }

      const ready = await pipeline("image-segmentation", MODEL, { dtype: "q8" });
      segmenter = ready;
      return ready;
    })();
  }
  return loading;
}

self.addEventListener("message", async (event: MessageEvent) => {
  const { id, image } = event.data as { id: number; image: string };
  const post = (msg: Record<string, unknown>, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage({ id, ...msg }, transfer ?? []);

  try {
    if (!segmenter) post({ type: "stage", stage: "loading" });
    const run = await getSegmenter();

    post({ type: "stage", stage: "running" });
    const output = await run(image);

    const segments = output
      .filter((s) => s?.mask)
      .map((s) => ({
        label: s.label,
        score: s.score ?? undefined,
        width: s.mask.width,
        height: s.mask.height,
        data: new Uint8Array(s.mask.data)
      }));

    post(
      { type: "done", segments },
      segments.map((s) => s.data.buffer)
    );
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err)
    });
  }
});
