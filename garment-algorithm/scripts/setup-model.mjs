/**
 * One-time setup for local garment detection.
 *
 * Fetches the clothes-parsing weights into public/models and copies the ONNX
 * WebAssembly runtime out of node_modules into public/ort, so that at runtime
 * everything is served from this origin and no request leaves the machine.
 *
 *   npm run setup:model
 */

import { createWriteStream } from "node:fs";
import { mkdir, copyFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const REPO = "Xenova/segformer_b2_clothes";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const FILES = ["config.json", "preprocessor_config.json", "onnx/model_quantized.onnx"];

const MODEL_DIR = path.join("public", "models", ...REPO.split("/"));
const ORT_SRC = path.join("node_modules", "onnxruntime-web", "dist");
const ORT_DIR = path.join("public", "ort");
const LIB_SRC = path.join(
  "node_modules",
  "@huggingface",
  "transformers",
  "dist",
  "transformers.web.js"
);
const LIB_DIR = path.join("public", "vendor");

const exists = (p) => stat(p).then(() => true, () => false);

async function download(rel) {
  const dest = path.join(MODEL_DIR, rel);
  if (await exists(dest)) {
    console.log(`  = ${rel} (já existe)`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok || !res.body) {
    throw new Error(`falhou ao baixar ${rel}: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const { size } = await stat(dest);
  console.log(`  + ${rel} (${(size / 1e6).toFixed(1)} MB)`);
}

async function copyRuntime() {
  if (!(await exists(ORT_SRC))) {
    throw new Error("onnxruntime-web não encontrado — rode npm install primeiro.");
  }
  await mkdir(ORT_DIR, { recursive: true });
  // Only the two runtimes the vendored bundles actually reference. The
  // full dist is 74 MB; these four files are 35 MB and enough — jsep and
  // jspi are for execution providers this build never requests.
  const NEEDED = /^ort-wasm-simd-threaded(\.asyncify)?\.(wasm|mjs)$/;
  const names = (await readdir(ORT_SRC)).filter((f) => NEEDED.test(f));
  for (const name of names) {
    await copyFile(path.join(ORT_SRC, name), path.join(ORT_DIR, name));
  }
  console.log(`  + ${names.length} arquivos de runtime → ${ORT_DIR}`);
}

const ORT_BUNDLE = "ort.webgpu.bundle.min.mjs";

/**
 * The browser build of transformers.js imports two bare specifiers
 * ("onnxruntime-web/webgpu" and "onnxruntime-common"). A bare specifier
 * cannot be resolved by a plain <script type=module> or a Worker — and
 * Workers do not support import maps. Both resolve to the same self-contained
 * ORT bundle, which re-exports Tensor, so the copy is rewritten to point at
 * it as a relative URL.
 */
async function copyLibrary() {
  if (!(await exists(LIB_SRC))) {
    throw new Error("@huggingface/transformers não encontrado — rode npm install primeiro.");
  }
  await mkdir(LIB_DIR, { recursive: true });

  await copyFile(path.join(ORT_SRC, ORT_BUNDLE), path.join(LIB_DIR, ORT_BUNDLE));
  console.log(`  + ${ORT_BUNDLE}`);

  const source = await readFile(LIB_SRC, "utf8");
  const patched = source
    .replace(/(from\s*)["']onnxruntime-web\/webgpu["']/g, `$1"./${ORT_BUNDLE}"`)
    .replace(/(from\s*)["']onnxruntime-common["']/g, `$1"./${ORT_BUNDLE}"`);

  if (patched === source) {
    throw new Error(
      "não encontrei os imports de onnxruntime para reescrever — o build de transformers.js mudou."
    );
  }

  const dest = path.join(LIB_DIR, "transformers.web.js");
  await writeFile(dest, patched);
  const { size } = await stat(dest);
  console.log(`  + transformers.web.js (${(size / 1e6).toFixed(1)} MB, imports reescritos)`);
}

console.log(`Modelo de detecção (${REPO}) → ${MODEL_DIR}`);
for (const f of FILES) await download(f);
console.log("Biblioteca de inferência:");
await copyLibrary();
console.log("Runtime ONNX WebAssembly:");
await copyRuntime();
console.log("Pronto. Detecção roda 100% local.");
