// Deterministic placeholder cover design for books without a real cover
// image - a curated cloth-binding palette picked from the book's own slug,
// so the same book always gets the same look across visits/reloads.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Muted, bookbinding-inspired tones; each has a paper-coloured ink and an
// accent used for the rule and ornament.
const PALETTES = [
  { bg: "oklch(0.36 0.06 160)", ink: "oklch(0.95 0.02 90)", accent: "oklch(0.8 0.09 85)" },
  { bg: "oklch(0.33 0.07 255)", ink: "oklch(0.95 0.015 90)", accent: "oklch(0.78 0.1 70)" },
  { bg: "oklch(0.4 0.11 30)", ink: "oklch(0.96 0.02 80)", accent: "oklch(0.85 0.07 80)" },
  { bg: "oklch(0.78 0.08 80)", ink: "oklch(0.26 0.03 60)", accent: "oklch(0.45 0.11 35)" },
  { bg: "oklch(0.3 0.02 250)", ink: "oklch(0.94 0.01 90)", accent: "oklch(0.72 0.12 40)" },
  { bg: "oklch(0.37 0.07 330)", ink: "oklch(0.95 0.02 60)", accent: "oklch(0.82 0.08 70)" },
  { bg: "oklch(0.45 0.07 200)", ink: "oklch(0.97 0.01 90)", accent: "oklch(0.86 0.08 85)" },
  { bg: "oklch(0.88 0.03 85)", ink: "oklch(0.28 0.03 60)", accent: "oklch(0.5 0.12 30)" },
  { bg: "oklch(0.52 0.1 55)", ink: "oklch(0.97 0.015 80)", accent: "oklch(0.3 0.04 50)" },
];

export function coverPalette(seed) {
  return PALETTES[hashString(seed) % PALETTES.length];
}
