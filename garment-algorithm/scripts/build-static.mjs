/**
 * Static build for GitHub Pages.
 *
 * `output: "export"` refuses to build a POST route handler, and
 * app/api/segment is exactly that. It is not needed here — detection runs
 * in the browser — but it stays in the repo for anyone self-hosting on a
 * server, so this moves it aside for the duration of the build and always
 * puts it back.
 */

import { rename, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const API_DIR = path.join("app", "api");
const PARKED = path.join(".api-parked");
const OUT = "out";

const exists = (p) => stat(p).then(() => true, () => false);

let parked = false;
try {
  if (await exists(API_DIR)) {
    await rm(PARKED, { recursive: true, force: true });
    await rename(API_DIR, PARKED);
    parked = true;
    console.log("• app/api guardado temporariamente");
  }

  await rm(OUT, { recursive: true, force: true });

  const res = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" }
  });
  if (res.status !== 0) throw new Error(`next build saiu com ${res.status}`);

  // Without this, GitHub Pages runs Jekyll and hides every _next/ path.
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, ".nojekyll"), "");
  console.log("• .nojekyll criado");
  console.log(`\nPronto: ${OUT}/`);
} finally {
  if (parked) {
    await rename(PARKED, API_DIR);
    console.log("• app/api restaurado");
  }
}
