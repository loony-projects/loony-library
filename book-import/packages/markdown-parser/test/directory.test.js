import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory, extractTermList } from "../src/index.js";

function tempTree(files, { parent = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "md-parser-"));
  const dir = parent ? path.join(base, parent, "markdown") : base;
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const codes = (result) => result.diagnostics.map((d) => d.code);
const CONTENTS = "# Contents\n\n**1 Understanding Node.js** 2\n\n**2 Closures** 3\n";

test("pdf-to-md directory: pages in numeric order, chapters from the contents page, title from <name>_metadata.json", () => {
  const dir = tempTree(
    {
      "Beginning_Nodejs_metadata.json": JSON.stringify({ pdf: { name: "Beginning_Nodejs.pdf" } }),
      "Beginning_Nodejs_page_0001.md": CONTENTS,
      "Beginning_Nodejs_page_0002.md": "# Understanding Node.js\n\nText on page two.\n",
      "Beginning_Nodejs_page_0010.md": "Page ten comes after page three, so this is still chapter two.\n",
      "Beginning_Nodejs_page_0003.md": "## Closures\n\n### Listing 2-1\n\n```js\nconst f = () => 1;\n```\n",
      "images/_page_0_Picture_1.jpeg": "",
    },
    { parent: "Beginning_Nodejs" }
  );
  const result = parseBookDirectory(dir);
  const { slug, title, author, sourceDir, ...rest } = result.book;
  assert.deepEqual({ slug, title, author, sourceDir }, { slug: "beginning-nodejs", title: "Beginning Nodejs", author: null, sourceDir: dir });
  assert.ok(Object.values(rest).every((v) => v === null), "no book.json: no other metadata");
  assert.deepEqual(result.chapters.map((c) => [c.role, c.number, c.title]), [
    ["front_matter", null, "Front Matter"],
    ["chapter", "1", "Understanding Node.js"],
    ["chapter", "2", "Closures"],
  ]);
  const [, , closures] = result.chapters;
  assert.equal(closures.sections.length, 1, "one section per chapter - headings don't make sections");
  assert.deepEqual(closures.sections[0].blocks.map((b) => [b.block_type, b.content.text]), [
    ["subheading", "Listing 2-1"],
    ["code", "const f = () => 1;"],
    ["paragraph", "Page ten comes after page three, so this is still chapter two."],
  ]);
  assert.equal(result.codeBlocks[0].normalizedLanguage, "javascript");
  assert.equal(codes(result).includes("toc.not_found"), false);
});

test("no contents page: chapters weren't found - an error, and no chapters", () => {
  const dir = tempTree({ "book_page_0001.md": "# Chapter 1\n\nText.\n", "book_page_0002.md": "# Chapter 2\n\nMore.\n" });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters, []);
  const error = result.diagnostics.find((d) => d.code === "toc.not_found");
  assert.equal(error.severity, "error");
  assert.match(error.message, /Chapters weren't found: no page has a contents heading \(Contents, Table of Contents, Contents at a Glance, Brief Contents, Chapters\)/);
});

test("a contents page whose chapters can't be located, or that lists none, is an error too", () => {
  const unlocated = parseBookDirectory(tempTree({ "p1.md": "# Contents\n\n**1 Alpha** 1\n\n**2 Beta** 2\n", "p2.md": "# Something else\n\nText.\n" }));
  assert.deepEqual(unlocated.chapters, []);
  assert.match(unlocated.diagnostics.find((d) => d.code === "toc.insufficient").message, /lists chapters, but none of them could be located/);

  const noChapters = parseBookDirectory(tempTree({ "p1.md": "# Contents\n\n**Preface** v\n", "p2.md": "# Preface\n\nHi.\n" }));
  assert.deepEqual(noChapters.chapters, []);
  assert.match(noChapters.diagnostics.find((d) => d.code === "toc.insufficient").message, /has no chapter entries/);
});

test("a directory without Markdown is an error", () => {
  const result = parseBookDirectory(tempTree({ "notes.txt": "hi" }));
  assert.deepEqual(result.chapters, []);
  assert.equal(result.diagnostics.find((d) => d.code === "source.empty").severity, "error");
});

test("without metadata the title comes from the folder (its parent when it's called markdown); overrides win", () => {
  const dir = tempTree({ "a.md": CONTENTS }, { parent: "Rust_Atomics" });
  assert.equal(parseBookDirectory(dir).book.title, "Rust Atomics");
  const named = parseBookDirectory(dir, { title: "Atomics", slug: "atomics-book", author: "M. Bos" }).book;
  assert.deepEqual([named.title, named.slug, named.author], ["Atomics", "atomics-book", "M. Bos"]);
});

test("broken metadata JSON is a warning, not a crash", () => {
  const dir = tempTree({ "x_metadata.json": "{ nope", "x_page_0001.md": CONTENTS }, { parent: "Some_Book" });
  const result = parseBookDirectory(dir);
  assert.equal(result.book.title, "Some Book");
  assert.ok(codes(result).includes("source.bad_metadata"));
});

test("not a directory is an error for the caller", () => {
  assert.throws(() => parseBookDirectory("/definitely/not/here"), /Not a directory/);
  assert.throws(() => parseBookDirectory(""), /Markdown directory is required/);
});

test("contents entries titled Glossary / Abbreviations / Symbols hold the book's terms; duplicates and conflicts reported", () => {
  const dir = tempTree({
    "p1.md": "# Contents\n\n**1 Chapter** 1\n\n**Abbreviations** 2\n\n**Symbols** 3\n",
    "p2.md": "# Chapter\n\nADJ → not an entry: this is an ordinary chapter\n",
    "p3.md": [
      "# Abbreviations",
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
    ].join("\n"),
    "p4.md": "# Symbols\n\nN → nasal\nn → any nasal\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => c.role), ["front_matter", "chapter", "glossary", "symbols"]);
  assert.deepEqual(
    result.glossary.map((g) => [g.term, g.expansion, g.key, g.position.file, g.position.start.line]),
    [
      ["ADJ", "adjective", "adj", "p3.md", 3],
      ["N", "noun", "n", "p3.md", 4],
    ]
  );
  assert.deepEqual(result.glossary[0].conflictingDefinitions.map((c) => c.expansion), ["describing word"]);
  assert.equal(result.glossary[0].ownerId, result.chapters[2].sections[0].id);
  assert.deepEqual(result.symbols.map((s) => [s.symbol, s.description]), [["N", "nasal"], ["n", "any nasal"]], "symbols are case-sensitive");
  assert.ok(codes(result).includes("glossary.duplicate"));
  assert.ok(codes(result).includes("glossary.conflict"));
  const ambiguous = result.diagnostics.find((d) => d.code === "terms.invalid_entry");
  assert.deepEqual([ambiguous.file, ambiguous.line], ["p3.md", 7]);
});

test("extractTermList keeps its { term, expansion } shape", () => {
  const entries = extractTermList("API → Application Programming Interface\nnot an entry");
  assert.deepEqual(entries.map(({ term, expansion }) => ({ term, expansion })), [
    { term: "API", expansion: "Application Programming Interface" },
  ]);
});

test("given a pdf-to-md book folder, its markdown/ subfolder is read", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "md-parser-"));
  const book = path.join(base, "Build-LLM-1");
  fs.mkdirSync(path.join(book, "markdown"), { recursive: true });
  fs.mkdirSync(path.join(book, "pages"));
  fs.writeFileSync(path.join(book, "Build-LLM-1.pdf"), "");
  fs.writeFileSync(path.join(book, "markdown", "b_page_0001.md"), CONTENTS);
  fs.writeFileSync(path.join(book, "markdown", "b_page_0002.md"), "# Understanding Node.js\n\nText.\n");
  const result = parseBookDirectory(book);
  assert.equal(result.book.sourceDir, path.join(book, "markdown"));
  assert.equal(result.book.title, "Build-LLM-1");
  assert.equal(result.chapters.filter((c) => c.role === "chapter").length, 1);
});
