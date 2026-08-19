/**
 * Character-set presets.
 *
 * Built-ins ship with the app; anything the user saves lives in
 * localStorage, so presets survive reloads but stay on that browser —
 * there is no backend, and none is wanted for a tool that never uploads
 * anything.
 */

export interface CharsetPreset {
  name: string;
  charset: string;
}

/** Every set is ordered dense → light: the first glyph carries most ink. */
export const BUILTIN_PRESETS: CharsetPreset[] = [
  { name: "ASCII", charset: "#+=-:." },
  { name: "Blocks", charset: "☐☗❚-:." },
  { name: "Density", charset: "█▓▒░" },
  { name: "Long ramp", charset: "@%#*+=-:." },
  { name: "Dots", charset: "●◕◔○·" },
  { name: "Bars", charset: "▉▊▋▌▍▎▏" },
  { name: "Binary", charset: "10" }
];

const KEY = "kint.charsetPresets";

export function loadCustomPresets(): CharsetPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is CharsetPreset =>
        !!p &&
        typeof (p as CharsetPreset).name === "string" &&
        typeof (p as CharsetPreset).charset === "string"
    );
  } catch {
    // Corrupt or blocked storage is not worth crashing the panel over.
    return [];
  }
}

function persist(list: CharsetPreset[]): CharsetPreset[] {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode, quota, blocked storage: the preset still applies for
    // this session, it just will not come back.
  }
  return list;
}

/** Saves under `name`, replacing any custom preset that already uses it. */
export function saveCustomPreset(preset: CharsetPreset): CharsetPreset[] {
  const name = preset.name.trim();
  const charset = preset.charset.replace(/\s+/g, "");
  if (!name || !charset) return loadCustomPresets();
  const rest = loadCustomPresets().filter((p) => p.name !== name);
  return persist([...rest, { name, charset }]);
}

export function deleteCustomPreset(name: string): CharsetPreset[] {
  return persist(loadCustomPresets().filter((p) => p.name !== name));
}

/** Name of the preset matching `charset`, or null if it is a one-off. */
export function presetNameFor(
  charset: string,
  custom: CharsetPreset[]
): string | null {
  const all = [...BUILTIN_PRESETS, ...custom];
  return all.find((p) => p.charset === charset)?.name ?? null;
}
