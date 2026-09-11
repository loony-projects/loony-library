import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

const processor = unified().use(remarkParse).use(remarkGfm);

// Same numbering convention as migration/src/parseFile.js - kept in sync by
// hand since this is a separate npm project (see docs/dev_setup.md).
const NUMBERING_RE = /^(\d+(?:\.\d+)*)\.?\s*(.*)$/;

function parseHeadingText(raw) {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(NUMBERING_RE);
  if (match && match[2]) {
    return { numbering: match[1], title: match[2].trim() };
  }
  return { numbering: null, title: cleaned };
}

function rawSlice(source, node) {
  return source.slice(node.position.start.offset, node.position.end.offset).trim();
}

function tableToRows(node, source) {
  return node.children.map((row) =>
    row.children.map((cell) => mdastToString(cell).trim() || rawSlice(source, cell))
  );
}

function isImageOnlyParagraph(node) {
  return node.type === "paragraph" && node.children.length === 1 && node.children[0].type === "image";
}

function isCaptionParagraph(node) {
  return (
    node.type === "paragraph" &&
    node.children.length === 1 &&
    node.children[0].type === "emphasis"
  );
}

/**
 * Parses markdown source into a flat list of nodes tagged as either
 * `heading` (numbering/title) or a content block (paragraph/list/image/
 * table/blockquote). Used to turn an edited section's markdown back into
 * content_blocks rows - every heading becomes a `subheading` block (see
 * routes/sections.js), since editing a section's text doesn't change the
 * book's section tree.
 */
export function parseMarkdown(source) {
  const tree = processor.parse(source);
  const nodes = tree.children;
  const items = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (node.type === "heading") {
      const { numbering, title } = parseHeadingText(mdastToString(node));
      items.push({ kind: "heading", level: node.depth, numbering, title });
      continue;
    }

    if (isImageOnlyParagraph(node)) {
      const img = node.children[0];
      let caption = null;
      const next = nodes[i + 1];
      if (next && isCaptionParagraph(next)) {
        caption = mdastToString(next).trim();
        i++; // consume the caption line
      }
      items.push({
        kind: "block",
        block_type: "image",
        content: { src: img.url, alt: img.alt || null, caption, text: caption || img.alt || "" },
      });
      continue;
    }

    if (node.type === "table") {
      const rows = tableToRows(node, source);
      items.push({
        kind: "block",
        block_type: "table",
        content: {
          headers: rows[0] ?? [],
          rows: rows.slice(1),
          markdown: rawSlice(source, node),
          text: rows.flat().join(" "),
        },
      });
      continue;
    }

    if (node.type === "list") {
      items.push({
        kind: "block",
        block_type: "list",
        content: {
          ordered: !!node.ordered,
          items: node.children.map((li) => mdastToString(li).trim()),
          markdown: rawSlice(source, node),
          text: mdastToString(node),
        },
      });
      continue;
    }

    if (node.type === "blockquote") {
      items.push({
        kind: "block",
        block_type: "blockquote",
        content: { markdown: rawSlice(source, node), text: mdastToString(node) },
      });
      continue;
    }

    if (node.type === "code") {
      items.push({
        kind: "block",
        block_type: "code",
        content: { code: node.value, lang: node.lang || null, text: node.value },
      });
      continue;
    }

    if (node.type === "paragraph") {
      const text = mdastToString(node).trim();
      if (!text) continue; // stray empty paragraph
      items.push({
        kind: "block",
        block_type: "paragraph",
        content: { markdown: rawSlice(source, node), text },
      });
      continue;
    }

    // thematicBreak, html, etc. - not meaningful content, skip.
  }

  return items;
}
