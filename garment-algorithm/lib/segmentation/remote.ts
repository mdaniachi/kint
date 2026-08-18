import type { Garment } from "../types";
import { decodeMaskBase64 } from "../maskUtils";
import { SegmentationError } from "./errors";
import { buildGarments } from "./garments";

/**
 * Remote provider: whatever `app/api/segment/route.ts` is wired to.
 * Kept as an alternative to the local model — the response shape is the
 * contract, so a hosted provider can be swapped in without touching the UI.
 */
export async function segmentRemotely(
  dataUrl: string,
  width: number,
  height: number
): Promise<Garment[]> {
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl })
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new SegmentationError(
      payload?.code ?? "segmentation_failed",
      payload?.error ?? `Segmentation request failed (${res.status})`
    );
  }

  const segments: { label: string; score?: number; mask: string }[] =
    payload?.segments ?? [];

  const items = [];
  for (const seg of segments) {
    if (!seg?.mask) continue;
    items.push({
      label: seg.label,
      score: seg.score,
      mask: await decodeMaskBase64(seg.mask, width, height)
    });
  }
  return buildGarments(items);
}
