import type { Garment } from "../types";
import { SegmentationError } from "./errors";
import { buildGarments, maskFromGray } from "./garments";

/**
 * Local provider: clothes parsing in a Web Worker, on this machine.
 * The worker is created once and kept warm, so only the first photograph
 * pays for loading the model.
 */

export type Stage = "loading" | "running";

interface WorkerSegment {
  label: string;
  score?: number;
  width: number;
  height: number;
  data: Uint8Array;
}

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./segmenter.worker.ts", import.meta.url), {
      type: "module"
    });
  }
  return worker;
}

/** Warm the model up before the user needs it. Safe to call repeatedly. */
export function preloadSegmenter(): void {
  if (typeof window !== "undefined") getWorker();
}

export function segmentLocally(
  dataUrl: string,
  width: number,
  height: number,
  onStage?: (stage: Stage) => void
): Promise<Garment[]> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = getWorker();
    } catch (err) {
      reject(
        new SegmentationError(
          "worker_unavailable",
          err instanceof Error ? err.message : "Could not start the segmenter."
        )
      );
      return;
    }

    const id = ++seq;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.id !== id) return;

      if (msg.type === "stage") {
        onStage?.(msg.stage as Stage);
        return;
      }

      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);

      if (msg.type === "error") {
        reject(new SegmentationError("local_failed", msg.message));
        return;
      }

      const segments: WorkerSegment[] = msg.segments ?? [];
      resolve(
        buildGarments(
          segments.map((s) => ({
            label: s.label,
            score: s.score,
            mask: maskFromGray(s.data, s.width, s.height, width, height)
          }))
        )
      );
    };

    const onError = (event: ErrorEvent) => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      reject(
        new SegmentationError(
          "worker_failed",
          event.message || "The segmenter worker crashed."
        )
      );
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, image: dataUrl });
  });
}
