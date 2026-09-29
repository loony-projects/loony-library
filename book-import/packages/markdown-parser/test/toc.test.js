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
  assert.equal(result.book.strategy, "toc");
  assert.deepEqual(outline(result), [
    ["front_matter", null, "Front Matter", "p1.md"],
    ["front_matter", null, "Introduction", "p3.md"],
    ["chapter", "1", "Setting Up", "p4.md"],
    ["chapter", "2", "Understanding Node.js", "p6.md"],
    ["back_matter", null, "Index", "p8.md"],
    ["back_matter", null, "About the Author", "p9.md"],
  ]);
});

test("a chapter's pages, headings and content stay together; its title heading is consumed", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  const setUp = result.chapters.find((c) => c.title === "Setting Up");
  const [body, listing, linux] = setUp.sections;
  assert.deepEqual(body.blocks.map((b) => b.content.text), ["Install things."]);
  assert.equal(listing.title, "Listing 1-1. hello.js", "a # heading inside a chapter is a section, not a chapter");
  assert.equal(linux.title, "Installing on Linux");
  assert.equal(linux.source_file, "book_page_0005.md", "the chapter continues onto the next page");

  const two = result.chapters.find((c) => c.number === "2");
  assert.deepEqual(two.sections.map((s) => s.title), ["Understanding Node.js", "Understanding Node.js Performance"]);
  assert.equal(two.sections[1].blocks.at(-1).content.text, "More chapter two.");
});

test("the contents page itself, and pages before the first entry, are front matter", () => {
  const result = parseBookDirectory(pagesDir(apressBook()));
  const [front] = result.chapters;
  assert.deepEqual(front.sections.map((s) => s.title), ["Front Matter", "Contents at a Glance"]);
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
  assert.equal(byTitle("Structured Query Language").sections[1].title, "Some of the Code", "sub-entries are sections, not chapters");
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

test("no contents page, or one whose chapters can't be placed, falls back to headings", () => {
  const plain = parseBookDirectory(pagesDir(["# One\n\nA.", "# Two\n\nB."]));
  assert.equal(plain.book.strategy, "headings");

  const unplaceable = parseBookDirectory(pagesDir(["# Contents\n\n**1 Alpha** 1\n\n**2 Beta** 2", "# One\n\nA."]));
  assert.equal(unplaceable.book.strategy, "headings");
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
