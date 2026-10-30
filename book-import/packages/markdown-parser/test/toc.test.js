import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory } from "../src/index.js";

function pagesDir(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-toc-"));
  pages.forEach((content, i) => {
    fs.writeFileSync(path.join(dir, `book_page_${String(i + 1).padStart(4, "0")}.md`), content);
  });
  return dir;
}

const codes = (result) => result.diagnostics.map((d) => d.code);
const outline = (result) => result.chapters.map((c) => [c.role, c.number, c.title, c.position?.file?.replace(/^book_page_0*/, "p")]);

// Shaped like pdf-to-md output of an Apress book: a "Contents at a Glance"
// table with dot leaders, bold chapter rows, roman front-matter pages, and
// headings whose levels say nothing about chapters (a "#" listing caption,
// a "##" chapter title). The PDF lacks some blank pages, so the printed ->
// PDF page offset drifts (+3 for chapter 1, +2 for chapter 2).
function apressBook() {
  return [
    "Cover",
    [
      "# Contents at a Glance",
      "",
      "| <b>About the Author .....</b>                   | <b>xi</b>   |",
      "|-------------------------------------------------|-------------|",
      "| <b>Introduction .....</b>                       | <b>xiii</b> |",
      "| ■ <b>Chapter 1: Setting Up .....</b>            | <b>1</b>    |",
      "| ■ <b>Chapter 2: Understanding Node.js .....</b> | <b>3</b>    |",
      "| <b>Index .....</b>                              | <b>6</b>    |",
    ].join("\n"),
    "## **Introduction**\n\nWhy this book.",
    "## **Setting Up**\n\nInstall things.\n\n# Listing 1-1. hello.js\n\nconsole.log(1)",
    "## Installing on Linux\n\nUse the package manager.",
    "## **Understanding Node.js**\n\nClosures.\n\n## Understanding Node.js Performance\n\nFast.",
    "More chapter two.",
    "## **Index**\n\nA, B, C",
    "## **About the Author**\n\nBio.",
  ];
}

test("chapters come from the contents page, not from heading levels", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  assert.deepEqual(outline(result), [
    ["front_matter", null, "Front Matter", "p1.md"],
    ["introduction", null, "Introduction", "p3.md"],
    ["chapter", "1", "Setting Up", "p4.md"],
    ["chapter", "2", "Understanding Node.js", "p6.md"],
    ["index", null, "Index", "p8.md"],
    ["about_author", null, "About the Author", "p9.md"],
  ]);
});

test("a chapter is one section: its title heading is consumed, other headings stay in place as subheadings", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  const setUp = result.chapters.find((c) => c.title === "Setting Up");
  assert.equal(setUp.sections.length, 1);
  const blocks = setUp.sections[0].blocks;
  assert.deepEqual(blocks.map((b) => [b.block_type, b.content.text]), [
    ["paragraph", "Install things."],
    ["subheading", "Listing 1-1. hello.js"],
    ["paragraph", "console.log(1)"],
    ["subheading", "Installing on Linux"],
    ["paragraph", "Use the package manager."],
  ]);
  assert.equal(blocks[3].position.file, "book_page_0005.md", "the chapter continues onto the next page");

  const two = result.chapters.find((c) => c.number === "2");
  assert.deepEqual(two.sections[0].blocks.map((b) => b.content.text), [
    "Closures.",
    "Understanding Node.js Performance",
    "Fast.",
    "More chapter two.",
  ]);
});

test("the contents page itself, and pages before the first entry, are front matter", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  const [front] = result.chapters;
  assert.equal(front.sections.length, 1);
  assert.deepEqual(front.sections[0].blocks.map((b) => b.block_type), ["paragraph", "subheading", "table"]);
  assert.equal(front.sections[0].blocks[1].content.text, "Contents at a Glance");
});

test("an entry listed out of book order is placed at its own heading and reported", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  const d = result.diagnostics.find((x) => x.code === "toc.out_of_order");
  assert.match(d.message, /About the Author/);
  assert.ok(codes(result).includes("toc.used"));
});

test("a chapter with no title heading is placed by printed page + the local offset", () => {
  const pages = [
    ["## Table of Contents", "", "**1. Basics** — 1", "", "**2. Threads** — 2", "", "**3. Atomics** — 4"].join("\n"),
    "## **Basics**\n\nIntro.",
    "## **Threads**\n\nSpawn.",
    "Threads continued.",
    "Atomics text whose heading was lost in conversion.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  assert.deepEqual(outline(result).slice(1), [
    ["chapter", "1", "Basics", "p2.md"],
    ["chapter", "2", "Threads", "p3.md"],
    ["chapter", "3", "Atomics", "p5.md"],
  ]);
  assert.ok(result.diagnostics.some((d) => d.code === "toc.placed_by_page" && d.message.includes("Atomics")));
});

test("parts group their chapters; ordered-list contents keep their numbers", () => {
  const pages = [
    [
      "## **Contents**",
      "",
      "### Part I: Basics (1)",
      "",
      "1. **Structured Query Language** — 2",
      "   - 1.1 Some of the Code — 3",
      "2. **Software Architecture** — 4",
      "",
      "### Part II: Practice (5)",
      "",
      "3. **Business Logic** — 6",
    ].join("\n"),
    "# Part I: Basics",
    "## Structured Query Language\n\nSQL.\n\n### 1.1 Some of the Code\n\nCode.",
    "More SQL.",
    "## Software Architecture\n\nLayers.",
    "# Part II: Practice",
    "## Business Logic\n\nRules.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  const byTitle = (t) => result.chapters.find((c) => c.title === t);
  assert.deepEqual(
    result.chapters.slice(1).map((c) => [c.role, c.number, c.title]),
    [
      ["part", "I", "Basics"],
      ["chapter", "1", "Structured Query Language"],
      ["chapter", "2", "Software Architecture"],
      ["part", "II", "Practice"],
      ["chapter", "3", "Business Logic"],
    ]
  );
  assert.equal(byTitle("Structured Query Language").partId, byTitle("Basics").id);
  assert.equal(byTitle("Business Logic").partId, byTitle("Practice").id);
  const sql = byTitle("Structured Query Language").sections;
  assert.equal(sql.length, 1);
  assert.ok(sql[0].blocks.some((b) => b.block_type === "subheading" && b.content.text === "1.1 Some of the Code"), "sub-entries stay as subheadings, not chapters or sections");
});

test("entries beyond the converted pages are reported as an incomplete conversion", () => {
  const pages = [
    ["# Contents", "", "**1 Intro** 1", "", "**2 Middle** 2", "", "**3 Missing** 90"].join("\n"),
    "## Intro\n\nA.",
    "## Middle\n\nB.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  assert.deepEqual(result.chapters.slice(1).map((c) => c.title), ["Intro", "Middle"]);
  assert.ok(result.diagnostics.some((d) => d.code === "toc.beyond_source" && d.message.includes("Missing")));
});

test("no contents page, or one whose chapters can't be placed, means chapters weren't found", () => {
  const plain = parseBookDirectory(pagesDir(["# One\n\nA.", "# Two\n\nB."]));
  assert.deepEqual(plain.chapters, []);
  assert.ok(codes(plain).includes("toc.not_found"));

  const unplaceable = parseBookDirectory(pagesDir(["# Contents\n\n**1 Alpha** 1\n\n**2 Beta** 2", "# One\n\nA."]));
  assert.deepEqual(unplaceable.chapters, []);
  assert.ok(codes(unplaceable).includes("toc.insufficient"));
});

test("chapter numbers that go backwards in the contents are ignored as noise", () => {
  const pages = [
    ["# Contents", "", "**1 Alpha** 1", "", "**2 Beta** 2", "", "**1 – variables** 3"].join("\n"),
    "## Alpha\n\nA.",
    "## Beta\n\nB.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  assert.deepEqual(result.chapters.slice(1).map((c) => c.title), ["Alpha", "Beta"]);
  assert.ok(codes(result).includes("toc.ignored_entry"));
});

test("a contents page that is only a list of titles: its items are the chapters, in order", () => {
  const pages = [
    [
      "## **CHAPTERS**",
      "",
      "* Understanding Large Language Models ",
      "* Working with Text Data ",
      "* Finetuning to Follow Instructions*",
      "",
      "* Appendix A. Introduction to PyTorch*",
    ].join("\n"),
    "## [1](https://example.com/chapter-1) Understanding Large Language Models\n\nLLMs are...\n\n## 1[.2](https://example.com) Applications of LLMs\n\nMany.",
    "## [2](https://example.com/chapter-2) Working with Text Data\n\nTokens.",
    "More about tokens.",
    "## [3](https://example.com/chapter-3) Finetuning to Follow Instructions\n\nInstructions.",
    "## Appendix A. Introduction to PyTorch\n\nTensors.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  assert.deepEqual(outline(result), [
    ["front_matter", null, "Front Matter", "p1.md"],
    ["chapter", "1", "Understanding Large Language Models", "p2.md"],
    ["chapter", "2", "Working with Text Data", "p3.md"],
    ["chapter", "3", "Finetuning to Follow Instructions", "p5.md"],
    ["appendix", "A", "Introduction to PyTorch", "p6.md"],
  ]);
  const one = result.chapters[1].sections[0].blocks;
  assert.deepEqual(one.map((b) => [b.block_type, b.content.text]), [
    ["paragraph", "LLMs are..."],
    ["subheading", "1.2 Applications of LLMs"],
    ["paragraph", "Many."],
  ]);
  assert.equal(result.chapters[2].sections[0].blocks.at(-1).content.text, "More about tokens.");
});

test("list items without page numbers are not chapters when the contents page has page numbers", () => {
  const pages = [
    ["# Contents", "", "**1 Alpha** 2", "", "- just a note", "- another note"].join("\n"),
    "## Alpha\n\nA.",
  ];
  const result = parseBookDirectory(pagesDir(pages));
  assert.deepEqual(result.chapters.map((c) => c.title), ["Front Matter", "Alpha"]);
});
