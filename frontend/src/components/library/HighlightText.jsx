// Wraps case-insensitive occurrences of `query` in <mark>, without HTML.
export default function HighlightText({ text = "", query = "" }) {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "gi")).map((part, i) =>
    i % 2 ? <mark key={i}>{part}</mark> : part,
  );
}
