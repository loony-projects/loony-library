import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory, extractTermList } from "../src/index.js";

function tempTree(files, { parent = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "md-parser-"));
  const dir = parent ? path.join(base, parent, "markdown") : base;
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const codes = (result) => result.diagnostics.map((d) => d.code);

test("pdf-to-md directory: pages in numeric order, title from <name>_metadata.json", () => {
  const dir = tempTree(
    {
      "Beginning_Nodejs_metadata.json": JSON.stringify({ pdf: { name: "Beginning_Nodejs.pdf" } }),
      "Beginning_Nodejs_page_0002.md": "# Understanding Node.js\n\nText on page two.\n",
      "Beginning_Nodejs_page_0010.md": "## Closures\n\nPage ten.\n\n```js\nconst f = () => 1;\n```\n",
      "Beginning_Nodejs_page_0001.md": "Cover page text.\n",
      "images/_page_0_Picture_1.jpeg": "",
    },
    { parent: "Beginning_Nodejs" }
  );
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.book, { slug: "beginning-nodejs", title: "Beginning Nodejs", author: null, sourceDir: dir, strategy: "headings" });
  assert.deepEqual(result.chapters.map((c) => [c.role, c.title]), [
    ["front_matter", "Front Matter"],
    ["chapter", "Understanding Node.js"],
  ]);
  const [, chapter] = result.chapters;
  assert.equal(chapter.sections[1].title, "Closures", "a heading on a later page continues the chapter");
  assert.equal(chapter.sections[1].blocks[0].position.file, "Beginning_Nodejs_page_0010.md");
  assert.equal(result.codeBlocks[0].normalizedLanguage, "javascript");
});

test("without metadata the title comes from the folder (its parent when it's called markdown); overrides win", () => {
  const dir = tempTree({ "a.md": "# A\n" }, { parent: "Rust_Atomics" });
  assert.equal(parseBookDirectory(dir).book.title, "Rust Atomics");
  const named = parseBookDirectory(dir, { title: "Atomics", slug: "atomics-book", author: "M. Bos" }).book;
  assert.deepEqual([named.title, named.slug, named.author], ["Atomics", "atomics-book", "M. Bos"]);
});

test("broken metadata JSON is a warning, not a crash", () => {
  const dir = tempTree({ "x_metadata.json": "{ nope", "x_page_0001.md": "# One\n" }, { parent: "Some_Book" });
  const result = parseBookDirectory(dir);
  assert.equal(result.book.title, "Some Book");
  assert.ok(codes(result).includes("source.bad_metadata"));
});

test("not a directory is an error for the caller", () => {
  assert.throws(() => parseBookDirectory("/definitely/not/here"), /Not a directory/);
  assert.throws(() => parseBookDirectory(""), /Markdown directory is required/);
});

test("glossary and symbols come from {.glossary} / {.symbols} elements, with duplicates and conflicts reported", () => {
  const dir = tempTree({
    "01.md": "# Chapter\n\nADJ → not a glossary entry in an ordinary chapter\n",
    "02.md": [
      "# Abbreviations {.glossary}",
      "",
      "ADJ → adjective",
      "**N** → noun",
      "ADJ → adjective",
      "adj → describing word",
      "A → B → C",
      "",
      "```",
      "x → y",
      "```",
      "",
      "# Symbols {.symbols}",
      "",
      "N → nasal",
      "n → any nasal",
    ].join("\n"),
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(
    result.glossary.map((g) => [g.term, g.expansion, g.key, g.position.file, g.position.start.line]),
    [
      ["ADJ", "adjective", "adj", "02.md", 3],
      ["N", "noun", "n", "02.md", 4],
    ]
  );
  assert.deepEqual(result.glossary[0].conflictingDefinitions.map((c) => c.expansion), ["describing word"]);
  assert.equal(result.glossary[0].ownerId, "ch1.s0");
  assert.deepEqual(result.symbols.map((s) => [s.symbol, s.description]), [["N", "nasal"], ["n", "any nasal"]], "symbols are case-sensitive");
  assert.ok(codes(result).includes("glossary.duplicate"));
  assert.ok(codes(result).includes("glossary.conflict"));
  const ambiguous = result.diagnostics.find((d) => d.code === "terms.invalid_entry");
  assert.deepEqual([ambiguous.file, ambiguous.line], ["02.md", 7]);
});

test("extractTermList keeps its { term, expansion } shape", () => {
  const entries = extractTermList("API → Application Programming Interface\nnot an entry");
  assert.deepEqual(entries.map(({ term, expansion }) => ({ term, expansion })), [
    { term: "API", expansion: "Application Programming Interface" },
  ]);
});

test("NNN_Name chapter folders select the numbering strategy: numbered tree, subheadings, front matter", () => {
  const dir = tempTree({
    "0001_CoverPage.md": "# Jane Author\n\nCover text.\n",
    "0006_Foreword.md": "# Foreword\n\nForeword text.\n",
    "0099_Stray.md": "Stray page.\n",
    "001_The_Nominals/0001.md": "Lead-in before any heading.\n\n# 1. Nouns\n\n## 1.1 Gender\n\n### a) Masculine:\n\nText.\n\n#### 1.1.1.1 Deep\n",
  });
  const result = parseBookDirectory(dir);
  assert.equal(result.book.strategy, "numbering");
  const [front, nominals] = result.chapters;

  assert.equal(front.role, "front_matter");
  assert.deepEqual(front.sections.map((s) => [s.role, s.title]), [["cover", "Cover Page"], ["foreword", "Foreword"]]);
  assert.deepEqual(front.sections[0].blocks.map((b) => [b.block_type, b.content.text]), [
    ["subheading", "Jane Author"],
    ["paragraph", "Cover text."],
  ], "a heading that isn't the section title is kept");
  assert.deepEqual(front.sections[1].blocks.map((b) => b.block_type), ["paragraph"], "a heading repeating the title is dropped");
  assert.ok(result.diagnostics.some((d) => d.code === "source.file_not_in_outline" && d.file === "0099_Stray.md"));
  assert.ok(result.diagnostics.some((d) => d.code === "source.missing_file" && d.file === "0002_Publication.md"));

  const [untitled, nouns] = nominals.sections;
  assert.equal(untitled.title, "Untitled");
  assert.equal(untitled.blocks[0].content.text, "Lead-in before any heading.");
  const gender = nouns.children[0];
  assert.deepEqual(gender.blocks.map((b) => [b.block_type, b.content.text]), [
    ["subheading", "a) Masculine:"],
    ["paragraph", "Text."],
  ]);
  assert.equal(gender.children[0].numbering, "1.1.1.1", "skipped depth attaches to nearest ancestor");
  assert.equal(nominals.role, "chapter");
});
