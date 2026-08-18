import type { Garment } from "../types";
import { segmentLocally, type Stage } from "./local";
import { segmentRemotely } from "./remote";

export { SegmentationError } from "./errors";
export { preloadSegmenter } from "./local";
export type { Stage };

/**
 * Segmentation service boundary. The rest of the app only ever calls this
 * function.
 *
 * Default provider is the local one: the clothes-parsing model runs in a
 * Web Worker on this machine, with weights and runtime served from this
 * origin. No photograph leaves the computer and no credential is needed.
 *
 * `NEXT_PUBLIC_SEGMENTATION_PROVIDER=remote` switches to `/api/segment`
 * instead, for a hosted provider.
 */
export async function segmentImage(
  dataUrl: string,
  width: number,
  height: number,
  onStage?: (stage: Stage) => void
): Promise<Garment[]> {
  if (process.env.NEXT_PUBLIC_SEGMENTATION_PROVIDER === "remote") {
    return segmentRemotely(dataUrl, width, height);
  }
  return segmentLocally(dataUrl, width, height, onStage);
}
