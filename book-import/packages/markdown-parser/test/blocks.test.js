import test from "node:test";
import assert from "node:assert/strict";
import { parseFile, parseBookMarkdown, parseHeadingText, astOf } from "../src/index.js";

const blocks = (md) => parseFile(md).filter((i) => i.kind === "block");

test("multiline paragraph keeps its inline markdown for rendering and gets separated plain text", () => {
  const md = "Read [the docs](https://x.dev \"Docs\"), use **bold**, `code()`,\nand ![alt text](a.png) inline.\\\nAfter a hard break.";
  const [p] = blocks(md);
  assert.equal(p.block_type, "paragraph");
  assert.equal(p.content.markdown, md, "exact source kept for the renderer");
  assert.equal(p.content.text, "Read the docs, use bold, code(),\nand alt text inline.\nAfter a hard break.");
  assert.equal(astOf(p).type, "paragraph", "mdast node reachable in-process");
  assert.equal(JSON.stringify(p).includes('"children"'), false, "mdast not serialized into the outline");
});

test("list and blockquote text no longer fuses words across items and paragraphs", () => {
  const [list, quote] = blocks("- alpha\n- beta\n  - gamma\n\n> first para\n>\n> second para");
  assert.deepEqual(list.content.items, ["alpha", "beta\ngamma"]);
  assert.equal(list.content.text, "alpha\nbeta\ngamma");
  assert.equal(quote.content.text, "first para\nsecond para");
});

test("inline HTML-like prose such as Rc<T> stays in the search text", () => {
  const [p] = blocks("Pointers (Rc<T> and Arc<T>) share ownership.");
  assert.equal(p.content.text, "Pointers (Rc<T> and Arc<T>) share ownership.");
});

test("thematic breaks, footnotes, link definitions and unknown nodes are kept, not dropped", () => {
  const md = "See the docs[^1] and [spec][s].\n\n---\n\n[^1]: The footnote text.\n\n[s]: https://example.com \"Spec\"";
  const types = blocks(md).map((b) => b.block_type);
  assert.deepEqual(types, ["paragraph", "thematic_break", "footnote", "definition"]);
  const [, , footnote, definition] = blocks(md);
  assert.equal(footnote.content.label, "1");
  assert.equal(footnote.content.text, "The footnote text.");
  assert.deepEqual(
    { url: definition.content.url, title: definition.content.title, label: definition.content.label },
    { url: "https://example.com", title: "Spec", label: "s" }
  );
});

test("paragraphs made only of inline HTML are kept", () => {
  const [p] = blocks('<span id="anchor"></span> <br>');
  assert.equal(p.block_type, "paragraph");
  assert.equal(p.content.markdown, '<span id="anchor"></span> <br>');
});

test("GFM table and figure caption convention", () => {
  const [table, image] = blocks("| a | b |\n|---|---|\n| 1 | `2` |\n\n![Fig](f.png)\n\n*Figure 1: A caption*");
  assert.deepEqual(table.content.headers, ["a", "b"]);
  assert.deepEqual(table.content.rows, [["1", "2"]]);
  assert.equal(image.content.caption, "Figure 1: A caption");
  assert.equal(image.position.start.line, 5);
  assert.equal(image.position.end.line, 7, "position spans the caption it consumed");
});

test("HTML wrapper split by blank lines is merged; unclosed wrapper keeps its content", () => {
  const [wrapped] = blocks('<div class="note">\n\nInside **bold**.\n\n</div>');
  assert.equal(wrapped.content.openTag, '<div class="note">');
  assert.deepEqual(wrapped.content.children.map((c) => c.block_type), ["paragraph"]);
  const unclosed = blocks('<div>\n\nOrphan paragraph.');
  assert.deepEqual(unclosed.map((b) => b.block_type), ["html", "paragraph"]);
});

test("heading numbering: dotted numbers may omit the space, a lone number glued to a word may not", () => {
  assert.deepEqual(parseHeadingText("6. The Adverbs"), { numbering: "6", title: "The Adverbs" });
  assert.deepEqual(parseHeadingText("3.3 Nouns"), { numbering: "3.3", title: "Nouns" });
  assert.deepEqual(parseHeadingText("10.1.2Inclusive Particle"), { numbering: "10.1.2", title: "Inclusive Particle" });
  assert.deepEqual(parseHeadingText("3D Graphics"), { numbering: null, title: "3D Graphics" });
  assert.deepEqual(parseHeadingText("64-bit Atomics"), { numbering: null, title: "64-bit Atomics" });
  assert.deepEqual(parseHeadingText("1984"), { numbering: null, title: "1984" });
});

test("code containing #, ##, backticks, links and arrows never becomes structure or glossary", () => {
  const md = [
    "# Glossary {.glossary}",
    "",
    "Real → entry",
    "",
    "````md",
    "# Not a chapter",
    "## Not a section",
    "```",
    "[link](http://x) and API → nope",
    "````",
    "",
    "    ## indented code, also not a heading",
    "    TERM → not an entry",
  ].join("\n");
  const result = parseBookMarkdown(md);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].sections.length, 1);
  assert.deepEqual(result.chapters[0].sections[0].blocks.map((b) => b.block_type), ["paragraph", "code", "code"]);
  assert.deepEqual(result.glossary.map((g) => g.term), ["Real"]);
  assert.equal(result.codeBlocks[0].rawCode, "# Not a chapter\n## Not a section\n```\n[link](http://x) and API → nope");
});

test("every block records file and position", () => {
  const result = parseBookMarkdown("# A\n\ntext\n\n```go\npackage main\n```\n", { file: "a.md" });
  const [text, code] = result.chapters[0].sections[0].blocks;
  assert.deepEqual(text.position.start, { line: 3, column: 1, offset: 5 });
  assert.equal(code.position.file, "a.md");
  assert.equal(code.position.start.line, 5);
  assert.equal(code.position.end.line, 7);
});
