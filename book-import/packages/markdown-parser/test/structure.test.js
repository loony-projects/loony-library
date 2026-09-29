import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseBookMarkdown } from "../src/index.js";

const fixture = fs.readFileSync(new URL("./fixtures/realistic-book.md", import.meta.url), "utf8");

const codes = (result) => result.diagnostics.map((d) => d.code);
const byTitle = (sections, title) => sections.find((s) => s.title === title);

test("realistic book: front matter, parts, chapters, appendix and back matter in source order", () => {
  const result = parseBookMarkdown(fixture, { file: "book.md", metadata: { title: "Systems" } });
  assert.deepEqual(
    result.chapters.map((c) => [c.role, c.title]),
    [
      ["front_matter", "Front Matter"],
      ["copyright", "Copyright"],
      ["preface", "Preface"],
      ["part", "Part I: Foundations"],
      ["chapter", "Getting Started"],
      ["chapter", "Memory"],
      ["part", "Part II: Practice"],
      ["chapter", "Concurrency"],
      ["interlude", "Interlude"],
      ["appendix", "Appendix A: Tools"],
      ["glossary", "Glossary"],
      ["about_author", "About the Author"],
    ]
  );
  const [partOne, partTwo] = result.chapters.filter((c) => c.role === "part");
  const partOf = (title) => result.chapters.find((c) => c.title === title).partId;
  assert.equal(partOf("Getting Started"), partOne.id);
  assert.equal(partOf("Memory"), partOne.id);
  assert.equal(partOf("Concurrency"), partTwo.id);
  assert.equal(partOf("Interlude"), partTwo.id);
  assert.equal(partOf("Appendix A: Tools"), null, "back matter closes the part");
  assert.equal(result.chapters[4].number, "1");
  assert.equal(result.book.title, "Systems");
});

test("content before the first heading and directly under a chapter heading has an owner", () => {
  const result = parseBookMarkdown(fixture, { file: "book.md" });
  const [front] = result.chapters;
  assert.equal(front.sections[0].blocks[0].content.text, "Published by Example Press. All rights reserved.");
  assert.ok(codes(result).includes("structure.content_before_first_heading"));

  const chapter = result.chapters.find((c) => c.title === "Getting Started");
  const body = chapter.sections[0];
  assert.equal(body.role, "body");
  assert.equal(body.title, "Getting Started");
  assert.deepEqual(body.blocks.map((b) => b.block_type), ["paragraph"]);
  assert.match(body.blocks[0].content.text, /^This paragraph sits directly under the chapter heading/);

  const part = result.chapters.find((c) => c.title === "Part I: Foundations");
  assert.equal(part.sections[0].blocks[0].content.text, "The first part covers the basics.");
});

test("skipped heading levels nest one step deeper and are reported; repeated titles keep distinct ids", () => {
  const result = parseBookMarkdown(fixture, { file: "book.md" });
  const chapter = result.chapters.find((c) => c.title === "Getting Started");
  const installing = chapter.sections.filter((s) => s.title === "Installing");
  assert.equal(installing.length, 2);
  assert.notEqual(installing[0].id, installing[1].id);
  assert.deepEqual(installing.map((s) => s.numbering), ["1.1", "1.2"]);
  assert.equal(installing[1].blocks[0].content.text, "Repeated title, different section.");

  const level4 = byTitle(installing[0].children, "Skipped straight to level four");
  assert.equal(level4.level, 4);
  assert.equal(level4.depth, installing[0].depth + 1);
  assert.equal(level4.blocks[0].content.text, "Still owned by the level-four section.");

  const skipped = result.diagnostics.filter((d) => d.code === "heading.skipped_level");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 30);
  assert.equal(skipped[0].file, "book.md");
  assert.ok(codes(result).includes("structure.duplicate_title"));
});

test("ids are unique across the book and stable across repeated parses", () => {
  const first = parseBookMarkdown(fixture, { file: "book.md" });
  const second = parseBookMarkdown(fixture, { file: "book.md" });
  const ids = [];
  const walk = (sections) => {
    for (const s of sections) {
      ids.push(s.id, ...s.blocks.map((b) => b.id));
      walk(s.children);
    }
  };
  first.chapters.forEach((c) => {
    ids.push(c.id);
    walk(c.sections);
  });
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(JSON.stringify(first.chapters), JSON.stringify(second.chapters));
  assert.deepEqual(first.diagnostics, second.diagnostics, "no state leaks between parses");
});

test("role is independent of heading level; unknown role classes stay in the title", () => {
  const result = parseBookMarkdown(
    "# One\n\ntext\n\n### Appendix B: Tables {.appendix}\n\nrows\n\n# Two {.sidebar}\n\nmore\n",
    { file: "b.md" }
  );
  assert.deepEqual(
    result.chapters.map((c) => [c.role, c.title, c.level]),
    [
      ["chapter", "One", 1],
      ["appendix", "Appendix B: Tables", 3],
      ["chapter", "Two {.sidebar}", 1],
    ]
  );
  assert.ok(codes(result).includes("heading.unknown_role"));
});

test("an ordinary heading that merely mentions a role word stays a chapter", () => {
  const result = parseBookMarkdown("# Glossary of Terms Used Here\n\nAPI → thing\n\n# Appendix\n\nx\n");
  assert.deepEqual(result.chapters.map((c) => c.role), ["chapter", "chapter"]);
  assert.equal(result.glossary.length, 0, "arrow lines only count inside a glossary element or file");
});

test("front matter after main matter is reported, not reordered", () => {
  const result = parseBookMarkdown("# Chapter\n\nx\n\n# Preface {.preface}\n\ny\n");
  assert.deepEqual(result.chapters.map((c) => c.role), ["chapter", "preface"]);
  assert.ok(codes(result).includes("structure.matter_order"));
});

test("empty document and document without headings", () => {
  const empty = parseBookMarkdown("");
  assert.deepEqual(empty.chapters, []);
  assert.deepEqual(codes(empty), ["source.empty"]);

  const flat = parseBookMarkdown("Just a paragraph.\n\nAnd another.", { metadata: { title: "Notes" } });
  assert.equal(flat.chapters.length, 1);
  assert.equal(flat.chapters[0].title, "Notes");
  assert.equal(flat.chapters[0].role, "chapter");
  assert.equal(flat.chapters[0].sections[0].blocks.length, 2);
  assert.ok(codes(flat).includes("structure.no_headings"));
});

test("empty headings and empty sections are kept and reported", () => {
  const result = parseBookMarkdown("# Real\n\n## \n\n## Empty\n\n## Full\n\ntext\n", { file: "e.md" });
  const sections = result.chapters[0].sections;
  assert.deepEqual(sections.map((s) => s.title), ["Real", "Untitled", "Empty", "Full"]);
  const empty = result.diagnostics.filter((d) => d.code === "structure.empty_section").map((d) => d.line);
  assert.deepEqual(empty, [3, 5]);
  assert.ok(result.diagnostics.some((d) => d.code === "heading.empty" && d.line === 3 && d.file === "e.md"));
});

test("multiple source files: structure continues across files and positions name each file", () => {
  const result = parseBookMarkdown([
    { file: "01-intro.md", source: "# Intro\n\nHello.\n" },
    { file: "02-more.md", source: "## Continued\n\nStill the intro chapter.\n\n# Next\n\nBye.\n" },
  ]);
  assert.deepEqual(result.chapters.map((c) => c.title), ["Intro", "Next"]);
  const continued = result.chapters[0].sections[1];
  assert.equal(continued.title, "Continued");
  assert.equal(continued.source_file, "02-more.md");
  assert.equal(continued.blocks[0].position.file, "02-more.md");
  assert.equal(continued.blocks[0].position.start.line, 3);
});

test("chapterLevel option treats a lone H1 as the book title chapter only when asked", () => {
  const md = "# Book\n\n## One\n\na\n\n## Two\n\nb\n";
  assert.equal(parseBookMarkdown(md).chapters.length, 1);
  const leveled = parseBookMarkdown(md, { chapterLevel: 2 });
  assert.deepEqual(leveled.chapters.map((c) => c.title), ["Book", "One", "Two"]);
});
