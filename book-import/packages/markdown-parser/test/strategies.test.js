import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBook, extractTermList } from "../src/index.js";

function tempTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-parser-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const codes = (result) => result.diagnostics.map((d) => d.code);

test("glossary and symbol files: arrow entries with positions, duplicates and conflicts reported", () => {
  const dir = tempTree({
    "glossary.md": [
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
    "symbols.md": "N → nasal\nn → any nasal\n",
    "001_Chapter/0001.md": "# 1. One\n\nText.\n",
  });
  const result = parseBook({
    slug: "g",
    strategy: "numbering",
    sourceDir: dir,
    glossaryFile: "glossary.md",
    symbolsFile: "symbols.md",
  });
  assert.deepEqual(
    result.glossary.map((g) => [g.term, g.expansion, g.key, g.position.start.line]),
    [
      ["ADJ", "adjective", "adj", 3],
      ["N", "noun", "n", 4],
    ]
  );
  assert.deepEqual(result.glossary[0].conflictingDefinitions.map((c) => c.expansion), ["describing word"]);
  assert.equal(result.glossary[0].ownerId, null, "file entries have no owning element");
  assert.deepEqual(result.symbols.map((s) => [s.symbol, s.description]), [["N", "nasal"], ["n", "any nasal"]], "symbols are case-sensitive");
  assert.ok(codes(result).includes("glossary.duplicate"));
  assert.ok(codes(result).includes("glossary.conflict"));
  const ambiguous = result.diagnostics.find((d) => d.code === "terms.invalid_entry");
  assert.deepEqual([ambiguous.file, ambiguous.line], ["glossary.md", 7]);
});

test("extractTermList keeps its old { term, expansion } shape", () => {
  const entries = extractTermList("API → Application Programming Interface\nnot an entry");
  assert.deepEqual(entries.map(({ term, expansion }) => ({ term, expansion })), [
    { term: "API", expansion: "Application Programming Interface" },
  ]);
});

test("a missing glossary file is an error diagnostic, not a crash", () => {
  const dir = tempTree({ "001_A/0001.md": "# 1. A\n" });
  const result = parseBook({ slug: "m", strategy: "numbering", sourceDir: dir, glossaryFile: "nope.md" });
  const error = result.diagnostics.find((d) => d.severity === "error");
  assert.equal(error.code, "source.missing_file");
});

test("numbering strategy: numbered tree, unnumbered headings as subheadings, front matter and config roles", () => {
  const dir = tempTree({
    "0001_CoverPage.md": "# Jane Author\n\nCover text.\n",
    "0006_Foreword.md": "# Foreword\n\nForeword text.\n",
    "0099_Stray.md": "Stray page.\n",
    "001_The_Nominals/0001.md": "Lead-in before any heading.\n\n# 1. Nouns\n\n## 1.1 Gender\n\n### a) Masculine:\n\nText.\n\n#### 1.1.1.1 Deep\n",
    "016_Appendix/0001.md": "# 16. Appendix\n\nMore.\n",
  });
  const result = parseBook({ slug: "n", strategy: "numbering", sourceDir: dir, roles: { Appendix: "appendix" } });
  const [front, nominals, appendix] = result.chapters;

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
  assert.equal(appendix.role, "appendix");
  assert.equal(nominals.role, "chapter");
});

test("flat-chapters (page files): chapter markers, dropped pages reported, content kept", () => {
  const dir = tempTree({
    "b_page_0001.md": "# Cover\n\nCover art.\n",
    "b_page_0002.md": "Blank-ish page nobody listed.\n",
    "b_page_0003.md": "# Chapter 1\n\n# Basics\n\nIntro text.\n\n## 1.1 Threads\n\nThread text.\n",
    "b_page_0004.md": "```rs\nfn main() {}\n```\n",
    "b_page_0005.md": "# Surprise heading\n\nChapter two text.\n",
  });
  const result = parseBook({
    slug: "f",
    strategy: "flat-chapters",
    sourceDir: dir,
    chapterSections: "numbered",
    frontMatter: [{ page: 1, title: "Cover", role: "cover" }],
    chapters: [
      { number: "1", slug: "basics", title: "Basics", startPage: 3 },
      { number: "2", slug: "two", title: "Two", startPage: 5, role: "appendix" },
    ],
  });
  const [front, one, two] = result.chapters;
  assert.deepEqual(front.sections.map((s) => [s.role, s.title, s.blocks.length]), [["cover", "Cover", 1]]);
  assert.ok(result.diagnostics.some((d) => d.code === "source.page_not_in_outline" && d.file === "b_page_0002.md"));

  const [intro, threads] = one.sections;
  assert.deepEqual([intro.role, threads.role], ["body", "section"]);
  assert.deepEqual(intro.blocks.map((b) => b.content.text), ["Intro text."], "marker and repeated title both consumed");
  assert.equal(threads.numbering, "1.1");
  assert.deepEqual(threads.blocks.map((b) => b.block_type), ["paragraph", "code"], "code on the next page stays in the open section");
  assert.equal(result.codeBlocks[0].normalizedLanguage, "rust");
  assert.equal(result.codeBlocks[0].position.file, "b_page_0004.md");

  assert.equal(two.role, "appendix");
  assert.deepEqual(two.sections[0].blocks.map((b) => [b.block_type, b.content.text]), [
    ["subheading", "Surprise heading"],
    ["paragraph", "Chapter two text."],
  ], "a first heading that isn't the chapter's marker is kept");
  assert.ok(codes(result).includes("structure.chapter_marker_kept"));
});

test("flat-chapters (single file): page markers are matched on headings, never inside code", () => {
  const dir = tempTree({
    "book.md": [
      "Preamble outside any page.",
      "",
      "## Start - PDF page 1",
      "",
      "# Chapter 1",
      "",
      "Text.",
      "",
      "```md",
      "## Fake marker - PDF page 2",
      "```",
      "",
      "## Next - PDF page 2",
      "",
      "Page two text.",
    ].join("\n"),
  });
  const result = parseBook({
    slug: "s",
    strategy: "flat-chapters",
    sourceFile: path.join(dir, "book.md"),
    chapters: [{ number: "1", slug: "one", title: "One", startPage: 1 }],
  });
  const blocks = result.chapters[0].sections[0].blocks;
  assert.deepEqual(blocks.map((b) => b.block_type), ["paragraph", "code", "paragraph"]);
  assert.equal(result.codeBlocks[0].rawCode, "## Fake marker - PDF page 2");
  assert.equal(blocks[2].position.start.line, 15, "positions point into the real file");
  assert.equal(result.chapters[0].sections[0].blocks[0].position.file, "book.md");
  const orphan = result.diagnostics.find((d) => d.code === "source.content_outside_outline");
  assert.deepEqual([orphan.file, orphan.line], ["book.md", 1]);
});

test("headings strategy from a config: sourceDir files in numeric order, glossary element", () => {
  const dir = tempTree({
    "2-two.md": "# Two\n\nSecond.\n",
    "10-ten.md": "# Glossary {.glossary}\n\n- **Arc**: atomically reference-counted pointer\n- Mutex → mutual exclusion lock\n",
    "1-one.md": "# One\n\nFirst.\n",
  });
  const result = parseBook({ slug: "h", strategy: "headings", sourceDir: dir });
  assert.deepEqual(result.chapters.map((c) => c.title), ["One", "Two", "Glossary"]);
  assert.deepEqual(result.glossary.map((g) => [g.term, g.expansion, g.ownerId, g.position.file]), [
    ["Arc", "atomically reference-counted pointer", "ch2.s0", "10-ten.md"],
    ["Mutex", "mutual exclusion lock", "ch2.s0", "10-ten.md"],
  ]);
  assert.equal(result.glossary[0].blockId, "ch2.s0.b0");
});
