import test from "node:test";
import assert from "node:assert/strict";
import { parseBookMarkdown, analyzeCodeBlocks, renderBookMarkdown } from "../src/index.js";

test("book-output.md: metadata, contents, diagnostics, code index, glossary and the re-assembled book", async () => {
  const md = [
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
    "",
    "# Glossary {.glossary}",
    "",
    "API → Application Programming Interface",
  ].join("\n");
  const result = parseBookMarkdown(md, { file: "b.md", metadata: { title: "Tiny Book", slug: "tiny" } });
  await analyzeCodeBlocks(result);
  const out = renderBookMarkdown(result);

  assert.match(out, /^# Tiny Book\n/);
  assert.match(out, /- \*\*Slug:\*\* `tiny`/);
  assert.match(out, /- \*\*Chapter 1: Basics\*\* \(chapter\) — starts b\.md:1, 2 blocks\n  - Threads — 1 blocks/);
  assert.match(out, /\*\*info\*\* `heading\.skipped_level` \(b\.md:11:1\)/);
  assert.match(out, /\| ch0\.s1\.b0 \| rust → rust \| analysed \| b\.md:7 \| declares: function main \|/);
  assert.match(out, /- \*\*API\*\* — Application Programming Interface \(b\.md:15\)/);

  const book = out.slice(out.indexOf("\n# Book\n"));
  assert.match(book, /## Chapter 1: Basics\n\n<!-- ch0 · chapter · b\.md:1 -->\n\nIntro text\.\n\n### Threads/);
  assert.ok(book.includes('````rust title="main.rs"\nfn main() { println!("```"); }\n````'), "code keeps its fence info and a fence longer than its backticks");
  assert.ok(book.includes("#### Deep"));
});
