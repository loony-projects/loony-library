// Search snippets from ts_headline. ts_headline doesn't escape HTML, and
// book text contains literal markup (an HTML book's "<img onerror=...>"),
// so matches are marked with control characters, the text is escaped here,
// and only then do the markers become <mark>.
export const HEADLINE_OPTIONS = "StartSel=\u0002,StopSel=\u0003,MaxFragments=1,MaxWords=30,MinWords=10";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escaped HTML with the matches in <mark>.
export const markedSnippet = (raw) =>
  (raw ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]).replace(/\u0002/g, "<mark>").replace(/\u0003/g, "</mark>");

// Plain text, markers dropped (for a client that highlights by itself).
export const plainSnippet = (raw) => (raw ?? "").replace(/[\u0002\u0003]/g, "");
