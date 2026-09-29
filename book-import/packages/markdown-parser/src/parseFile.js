import { parseMarkdownTree, positionOf, sourceOf } from "./markdown.js";
import { plainText, inlineText } from "./text.js";
import { headingItem } from "./headings.js";
import { parseFenceInfo, normalizeLanguage } from "./languages.js";

// Stages 2 + 4 - AST traversal and ordered content extraction for one
// markdown source. Produces a flat, source-ordered list of items, each
// either a `heading` (for the outline builders to turn into structure) or a
// content `block` shaped the way content_blocks.content is stored and
// rendered (see frontend/src/components/Blocks.jsx).
//
// Invariant: every top-level mdast node yields exactly one item, except a
// figure caption (folded into its image block) and whitespace-only HTML.
// Node types with no dedicated block type become an `unknown` block that
// carries its raw markdown - content is never dropped for not fitting a
// known category.
//
// The mdast node behind each item stays reachable through astOf(item) for
// in-process stages (term extraction) without being serialized into the
// outline JSON or the database.

const astNodes = new WeakMap();

export function astOf(item) {
  return astNodes.get(item) ?? null;
}

function withAst(item, node) {
  astNodes.set(item, node);
  return item;
}

function isImageOnlyParagraph(node) {
  return node.type === "paragraph" && node.children.length === 1 && node.children[0].type === "image";
}

// Documented caption convention: an image paragraph immediately followed by
// a paragraph consisting solely of emphasis ("*Figure 3.1: ...*").
function isCaptionParagraph(node) {
  return node?.type === "paragraph" && node.children.length === 1 && node.children[0].type === "emphasis";
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Content of a `code` block, fenced or indented. `lang` and `meta` are
 * exactly what the fence said (remark splits the info string at the first
 * space); `language` is the normalized id, or null when the label is
 * missing or unrecognized.
 */
export function codeContent(node, { source, file, diagnostics }) {
  const raw = sourceOf(source, node);
  const opening = raw.match(FENCE_RE);
  const fenced = Boolean(opening);
  const info = parseFenceInfo(node.lang, node.meta);
  const language = normalizeLanguage(info.label);

  if (opening) {
    const lines = raw.split("\n");
    const last = lines.length > 1 ? lines[lines.length - 1].replace(/^[ \t>]*/, "") : "";
    const fenceChar = opening[1][0];
    const closes = new RegExp(`^\\${fenceChar}{${opening[1].length},}[ \\t]*$`).test(last.trim());
    if (!closes) {
      diagnostics?.warning(
        "code.unclosed_fence",
        "Code fence is never closed; everything to the end of the file or container was read as code.",
        { position: positionOf(node, file) }
      );
    }
  }
  if (info.label && !language) {
    diagnostics?.info("code.unknown_language", `Unrecognized code language label "${info.label}".`, {
      position: positionOf(node, file),
    });
  }

  return {
    code: node.value,
    lang: node.lang ?? null,
    meta: node.meta ?? null,
    language,
    fenced,
    text: node.value,
  };
}

// Code blocks nested inside a container block (list item, blockquote,
// footnote). The container's markdown still renders them; these entries let
// the code-block index reach them without re-parsing.
function collectNestedCode(node, ctx, path = []) {
  const found = [];
  (node.children ?? []).forEach((child, index) => {
    const childPath = [...path, `${child.type}[${index}]`];
    if (child.type === "code") {
      found.push({ content: codeContent(child, ctx), position: positionOf(child, ctx.file), path: childPath.join(">") });
    } else if (child.children) {
      found.push(...collectNestedCode(child, ctx, childPath));
    }
  });
  return found;
}

function block(blockType, content, node, ctx, extra = {}) {
  const item = { kind: "block", block_type: blockType, content, position: positionOf(node, ctx.file), ...extra };
  return withAst(item, node);
}

function tableToRows(node, source) {
  return node.children.map((row) =>
    row.children.map((cell) => plainText(cell).trim() || sourceOf(source, cell).trim())
  );
}

function blockForNode(node, ctx) {
  const { source } = ctx;
  const markdown = () => sourceOf(source, node).trim();

  switch (node.type) {
    case "heading":
      return withAst(headingItem(node, { position: positionOf(node, ctx.file), diagnostics: ctx.diagnostics }), node);

    case "table": {
      const rows = tableToRows(node, source);
      return block("table", {
        headers: rows[0] ?? [],
        rows: rows.slice(1),
        markdown: markdown(),
        text: rows.map((r) => r.join(" ")).join("\n"),
      }, node, ctx);
    }

    case "list": {
      const nestedCode = collectNestedCode(node, ctx);
      return block("list", {
        ordered: !!node.ordered,
        items: node.children.map((li) => plainText(li).trim()),
        markdown: markdown(),
        text: plainText(node).trim(),
      }, node, ctx, nestedCode.length ? { nestedCode } : {});
    }

    case "blockquote": {
      const nestedCode = collectNestedCode(node, ctx);
      return block("blockquote", { markdown: markdown(), text: plainText(node).trim() }, node, ctx,
        nestedCode.length ? { nestedCode } : {});
    }

    case "code":
      return block("code", codeContent(node, ctx), node, ctx);

    case "html":
      // A standalone raw-HTML block (CommonMark HTML block, not inline
      // markup inside a paragraph). Sanitized at render time, not here -
      // see frontend/src/components/Blocks.jsx - since this is stored as-is
      // and rendered to every future viewer. Blank lines inside the source
      // split what looks like one wrapping tag into several sibling "html"
      // nodes here (an opening <div>, its content, and the closing </div>)
      // - mergeHtmlWrappers, below, re-merges a matching open/close pair
      // (and everything between them) into one compound block.
      if (!node.value.trim()) return null;
      return block("html", { html: node.value, text: node.value }, node, ctx);

    case "paragraph": {
      const md = markdown();
      if (!md) return null;
      // Kept even when it has no plain text (e.g. only inline HTML).
      return block("paragraph", { markdown: md, text: plainText(node).trim() }, node, ctx);
    }

    case "thematicBreak":
      return block("thematic_break", { markdown: markdown(), text: "" }, node, ctx);

    case "footnoteDefinition": {
      const nestedCode = collectNestedCode(node, ctx);
      return block("footnote", {
        identifier: node.identifier,
        label: node.label ?? node.identifier,
        markdown: markdown(),
        text: plainText(node).trim(),
      }, node, ctx, nestedCode.length ? { nestedCode } : {});
    }

    case "definition":
      // A link reference definition ("[label]: url"). Kept so the source
      // round-trips through the editor and references stay resolvable.
      return block("definition", {
        identifier: node.identifier,
        label: node.label ?? node.identifier,
        url: node.url,
        title: node.title ?? null,
        markdown: markdown(),
        text: "",
      }, node, ctx);

    default:
      ctx.diagnostics?.info("block.unknown_node", `Markdown node "${node.type}" kept as an unknown block.`, {
        position: positionOf(node, ctx.file),
      });
      return block("unknown", { nodeType: node.type, markdown: markdown(), text: plainText(node).trim() }, node, ctx);
  }
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
 * blocks that each render independently (see migrate.js and
 * frontend/src/components/Blocks.jsx). Stack-based, so a wrapper can nest
 * inside another.
 *
 * A markdown heading always closes every currently open wrapper first
 * rather than becoming a child of one - headings drive the book's section
 * tree downstream of this function, and merging one into an arbitrary HTML
 * wrapper would tangle that up for no real benefit, since the motivating
 * case (a `<div>` wrapping a raw `<h2>`) already works without it - a
 * self-contained "<h2>...</h2>" html node isn't a heading in this list at
 * all, just another block-kind item.
 */
function mergeHtmlWrappers(items) {
  const stack = []; // { tagName, open, children }[]
  const top = () => (stack.length ? stack[stack.length - 1].children : null);

  function flushAll(into) {
    while (stack.length) {
      const frame = stack.pop();
      const target = stack.length ? stack[stack.length - 1].children : into;
      target.push(frame.open, ...frame.children);
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
        stack.push({ tagName: openTag, open: item, children: [] });
        continue;
      }
      const closeTag = matchSoloCloseTag(item.content.html);
      if (closeTag && stack.length && stack[stack.length - 1].tagName === closeTag) {
        const frame = stack.pop();
        const wrapped = {
          kind: "block",
          block_type: "html",
          content: {
            openTag: frame.open.content.html,
            closeTag: item.content.html,
            children: frame.children,
            text: flattenChildrenText(frame.children),
          },
          position: frame.open.position && item.position
            ? { ...frame.open.position, end: item.position.end }
            : frame.open.position,
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
 * Extracts items from a run of top-level mdast nodes (a whole file's
 * children, or one page's slice of a single consolidated file).
 * ctx: { source, file?, diagnostics? } - `source` is the full text the
 * nodes' offsets point into.
 */
export function extractItems(nodes, ctx) {
  const items = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (isImageOnlyParagraph(node)) {
      const img = node.children[0];
      let caption = null;
      let end = node;
      if (isCaptionParagraph(nodes[i + 1])) {
        end = nodes[i + 1];
        caption = inlineText(end);
        i++; // consume the caption line
      }
      const item = block("image", {
        src: img.url,
        alt: img.alt || null,
        caption,
        text: caption || img.alt || "",
      }, node, ctx);
      if (end !== node && item.position) item.position.end = positionOf(end, ctx.file).end;
      items.push(item);
      continue;
    }

    const item = blockForNode(node, ctx);
    if (item) items.push(item);
  }
  return mergeHtmlWrappers(items);
}

/**
 * Parses one markdown file's source into a flat, source-ordered list of
 * heading and content-block items (see extractItems). Also used by the
 * backend to turn an edited section's markdown back into content_blocks.
 */
export function parseFile(source, { file = null, diagnostics = null } = {}) {
  const tree = parseMarkdownTree(source);
  return extractItems(tree.children, { source, file, diagnostics });
}
