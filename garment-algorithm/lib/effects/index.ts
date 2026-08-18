import type { GarmentEffect } from "../types";
import { asciiReconstruction } from "./asciiReconstruction";
import { halftone } from "./halftone";
import { contourLines } from "./contourLines";
import { scanline } from "./scanline";

/**
 * Effect registry. Every module implements `GarmentEffect` and receives the
 * same image / mask / params / analysis pipeline — registering here is the
 * only wiring an effect needs.
 */
export const effects: GarmentEffect[] = [
  asciiReconstruction,
  halftone,
  contourLines,
  scanline
];

export function getEffect(id: string): GarmentEffect {
  return effects.find((e) => e.id === id) ?? effects[0];
}
