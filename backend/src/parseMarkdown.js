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

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// An "html" node whose entire value is one opening tag and nothing else
// ("<div style=\"...\">", not "<h2>Title</h2>" or "<div/>") - a candidate to
// wrap whatever comes after it, up to its matching close tag.
function matchSoloOpenTag(value) {
  const trimmed = value.trim();
  if (trimmed.endsWith("/>")) return null;
  const match = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>$/);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  return VOID_ELEMENTS.has(tag) ? null : tag;
}

// An "html" node whose entire value is one closing tag ("</div>") and
// nothing else.
function matchSoloCloseTag(value) {
  const match = value.trim().match(/^<\/([a-zA-Z][a-zA-Z0-9-]*)>$/);
  return match ? match[1].toLowerCase() : null;
}

function flattenChildrenText(children) {
  return children.map((c) => c.content?.text || "").join(" ");
}

/**
 * Merges a block-level HTML opening tag with its matching closing tag - even
 * when separated by blank lines and ordinary markdown content in between -
 * into one compound `html` block carrying `children`, instead of leaving
 * the opening tag, its content, and the closing tag as disconnected sibling
 * blocks that each render independently (see routes/sections.js and
 * Blocks.jsx). Stack-based, so a wrapper can nest inside another.
 *
 * A markdown heading always closes every currently open wrapper first
 * rather than becoming a child of one - headings drive the book's section
 * tree upstream of this function (see buildOutlineByNumbering.js /
 * buildOutlineFlatChapters.js), and merging one into an arbitrary HTML
 * wrapper would tangle that up for no real benefit, since the motivating
 * case (a `<div>` wrapping a raw `<h2>`) already works without it - a
 * self-contained "<h2>...</h2>" html node isn't a heading in this list at
 * all, just another block-kind item.
 */
function mergeHtmlWrappers(items) {
  const stack = []; // { tagName, openValue, children }[]
  const top = () => (stack.length ? stack[stack.length - 1].children : null);

  function flushAll(into) {
    while (stack.length) {
      const frame = stack.pop();
      const target = stack.length ? stack[stack.length - 1].children : into;
      target.push(
        { kind: "block", block_type: "html", content: { html: frame.openValue, text: frame.openValue } },
        ...frame.children
      );
    }
  }

  const result = [];
  for (const item of items) {
    if (item.kind === "heading") {
      flushAll(result);
      result.push(item);
      continue;
    }

    if (item.block_type === "html") {
      const openTag = matchSoloOpenTag(item.content.html);
      if (openTag) {
        stack.push({ tagName: openTag, openValue: item.content.html, children: [] });
        continue;
      }
      const closeTag = matchSoloCloseTag(item.content.html);
      if (closeTag && stack.length && stack[stack.length - 1].tagName === closeTag) {
        const frame = stack.pop();
        const wrapped = {
          kind: "block",
          block_type: "html",
          content: {
            openTag: frame.openValue,
            closeTag: item.content.html,
            children: frame.children,
            text: flattenChildrenText(frame.children),
          },
        };
        (top() ?? result).push(wrapped);
        continue;
      }
    }

    (top() ?? result).push(item);
  }

  flushAll(result); // unclosed wrappers (malformed/mismatched markup) - flush unwrapped rather than losing content
  return result;
}

/**
 * Parses markdown source into a flat list of nodes tagged as either
 * `heading` (numbering/title) or a content block (paragraph/list/image/
 * table/blockquote/html). Used to turn an edited section's markdown back
 * into content_blocks rows - every heading becomes a `subheading` block
 * (see routes/sections.js), since editing a section's text doesn't change
 * the book's section tree. A matching block-level HTML open/close tag pair
 * is merged into one compound block before this returns - see
 * mergeHtmlWrappers, below.
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

    if (node.type === "html") {
      // A standalone raw-HTML block (CommonMark HTML block, not inline
      // markup inside a paragraph). Sanitized at render time, not here -
      // see Blocks.jsx - since this is stored as-is and rendered to every
      // future viewer. Blank lines inside the source split what looks like
      // one wrapping tag into several sibling "html" nodes here (an opening
      // <div>, its content, and the closing </div>) - mergeHtmlWrappers,
      // below, re-merges a matching open/close pair (and everything between
      // them) into one compound block before this function returns.
      if (!node.value.trim()) continue;
      items.push({
        kind: "block",
        block_type: "html",
        content: { html: node.value, text: node.value },
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

    // thematicBreak, etc. - not meaningful content, skip.
  }

  return mergeHtmlWrappers(items);
}
