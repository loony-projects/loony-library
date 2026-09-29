// Plain-text extraction for search (content_blocks.tsv indexes content.text)
// and for term matching. mdast-util-to-string concatenates children with no
// separator, which fused words across list items, blockquote paragraphs and
// hard line breaks ("item oneitem two"); this keeps the same leaf handling
// but puts a newline between block-level children and at hard breaks.

const BLOCK_CONTAINERS = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "footnoteDefinition",
  "table",
  "tableRow",
]);

export function plainText(node) {
  if (!node) return "";
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    // Inline HTML keeps its source text, as mdast-util-to-string does: prose
    // like "Rc<T>" parses "<T>" as an HTML node, and dropping it would lose
    // real words from search.
    case "html":
      return node.value;
    case "break":
      return "\n";
    case "image":
    case "imageReference":
      return node.alt || "";
    case "footnoteReference":
    case "definition":
    case "thematicBreak":
      return "";
    default:
      break;
  }
  if (!node.children) return node.value ?? "";
  const parts = node.children.map(plainText);
  if (node.type === "tableRow") return parts.map((p) => p.trim()).join(" | ");
  if (BLOCK_CONTAINERS.has(node.type)) return parts.filter((p) => p.trim()).join("\n");
  return parts.join("");
}

// Collapses runs of whitespace (including the newlines above) to single
// spaces - for one-line labels such as headings and captions.
export function inlineText(node) {
  return plainText(node).replace(/\s+/g, " ").trim();
}
