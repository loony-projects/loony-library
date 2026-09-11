// Deterministic placeholder "cover art" for books that don't have a real
// cover image - a two-tone gradient derived from the book's own slug, so
// the same book always gets the same look across visits/reloads.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function coverGradient(seed) {
  const hash = hashString(seed);
  const hue = hash % 360;
  const hue2 = (hue + 35 + (hash % 45)) % 360;
  return `linear-gradient(155deg, hsl(${hue}, 60%, 52%), hsl(${hue2}, 65%, 34%))`;
}
