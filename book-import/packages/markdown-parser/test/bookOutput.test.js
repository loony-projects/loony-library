import test from "node:test";
import assert from "node:assert/strict";
import { parseBookPages, analyzeCodeBlocks, renderBookMarkdown } from "../src/index.js";

test("book-output.md: metadata, contents, diagnostics, code index, glossary and the re-assembled book", async () => {
  const chapter = [
    "# 1. Basics",
    "",
    "Intro text.",
    "",
    "## Threads",
    "",
    "````rust title=\"main.rs\"",
    "fn main() { println!(\"```\"); }",
    "````",
    "",
    "#### Deep",
  ].join("\n");
  const result = parseBookPages(
    [
      { file: "contents.md", source: "# Contents\n\n**1 Basics** 1\n\n**Glossary** 2\n" },
      { file: "b.md", source: chapter },
      { file: "g.md", source: "# Glossary\n\nAPI → Application Programming Interface\n" },
    ],
    { title: "Tiny Book", slug: "tiny" }
  );
  await analyzeCodeBlocks(result);
  const out = renderBookMarkdown(result);

  assert.match(out, /^# Tiny Book\n/);
  assert.match(out, /- \*\*Slug:\*\* `tiny`/);
  assert.match(out, /- \*\*Chapters from:\*\* the book's contents page/);
  assert.match(out, /- \*\*Front Matter\*\* \(front_matter\) — starts contents\.md:1, 3 blocks\n- \*\*Chapter 1: Basics\*\* \(chapter\) — starts b\.md:1, 4 blocks\n- \*\*Glossary\*\* \(glossary\) — starts g\.md:1, 1 blocks/);
  assert.match(out, /\*\*info\*\* `toc\.used` \(contents\.md\)/);
  assert.match(out, /\| ch1\.s0\.b2 \| rust → rust \| analysed \| b\.md:7 \| declares: function main \|/);
  assert.match(out, /- \*\*API\*\* — Application Programming Interface \(g\.md:3\)/);

  const book = out.slice(out.indexOf("\n# Book\n"));
  assert.match(book, /## Chapter 1: Basics\n\n<!-- ch1 · chapter · b\.md:1 -->\n\nIntro text\.\n\n### Threads/);
  assert.ok(book.includes('````rust title="main.rs"\nfn main() { println!("```"); }\n````'), "code keeps its fence info and a fence longer than its backticks");
  assert.ok(book.includes("### Deep"), "headings inside a chapter are subheadings at one level");
});
