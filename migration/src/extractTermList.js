// The Abbreviations and Symbols pages are each a flat list of
// "TERM  → expansion" lines rather than prose, so they get their own
// small extractor instead of going through parseFile/buildOutline.
export function extractTermList(source) {
  return source
    .split("\n")
    .map((line) => line.split("→"))
    .filter((parts) => parts.length === 2)
    .map(([term, expansion]) => ({
      term: term.trim(),
      expansion: expansion.trim(),
    }))
    .filter((entry) => entry.term && entry.expansion);
}
