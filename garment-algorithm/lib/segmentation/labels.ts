/**
 * Label handling for clothes-parsing models.
 * Defaults target mattmdjaga/segformer_b2_clothes (18 classes), but any
 * model whose non-garment classes are listed below will work.
 */

export const NON_GARMENT_LABELS = new Set([
  "background",
  "hair",
  "face",
  "sunglasses",
  "left-arm",
  "right-arm",
  "left-leg",
  "right-leg"
]);

const FRIENDLY: Record<string, string> = {
  "upper-clothes": "Top",
  "skirt": "Skirt",
  "pants": "Pants",
  "dress": "Dress",
  "belt": "Belt",
  "hat": "Hat",
  "bag": "Bag",
  "scarf": "Scarf",
  "left-shoe": "Shoes",
  "right-shoe": "Shoes"
};

export function friendlyLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  return FRIENDLY[key] ?? titleCase(raw);
}

export function isGarment(raw: string): boolean {
  return !NON_GARMENT_LABELS.has(raw.trim().toLowerCase());
}

/** Labels that should be merged into a single garment (e.g. both shoes). */
export function mergeKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "left-shoe" || key === "right-shoe") return "shoes";
  return key;
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}
