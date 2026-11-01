import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory, UsageError } from "../src/index.js";

// A book folder: book.json next to markdown/ and markdown-cleaned/.
function bookFolder(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-manifest-"));
  for (const sub of ["markdown", "markdown-cleaned"]) {
    fs.mkdirSync(path.join(dir, sub, "01_Chapter_One"), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, "01_Chapter_One", "p1.md"), `## Chapter One\n\nFrom ${sub}.\n`);
  }
  if (manifest !== undefined) fs.writeFileSync(path.join(dir, "book.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  return dir;
}

const text = (result) => result.chapters[0].sections[0].blocks.map((b) => b.content.text).join(" ");

test("book.json gives the book's metadata and which Markdown folder to read", () => {
  const dir = bookFolder({
    title: "Natural Language Processing with Transformers",
    slug: "nlp-with-transformers",
    author: "Lewis Tunstall",
    year: 2022,
    language: "en",
    category: "computer-science",
    publish: true,
    source: "markdown-cleaned",
  });
  const result = parseBookDirectory(dir);
  assert.equal(result.book.title, "Natural Language Processing with Transformers");
  assert.equal(result.book.slug, "nlp-with-transformers");
  assert.equal(result.book.author, "Lewis Tunstall");
  assert.equal(result.book.published_year, 2022);
  assert.equal(result.book.language, "en");
  assert.equal(result.book.category, "computer-science");
  assert.equal(result.book.publish, true);
  assert.equal(path.basename(result.book.sourceDir), "markdown-cleaned");
  assert.equal(text(result), "From markdown-cleaned.");
  assert.ok(result.diagnostics.some((d) => d.code === "book.manifest"));
});

test("given the markdown/ folder itself, the book.json beside it still applies; flags win over it", () => {
  const dir = bookFolder({ title: "From the File", author: "File Author" });
  const result = parseBookDirectory(path.join(dir, "markdown"), { author: "Flag Author" });
  assert.equal(result.book.title, "From the File");
  assert.equal(result.book.author, "Flag Author");
  assert.equal(text(result), "From markdown.");
});

test("without book.json, metadata comes from the folder as before", () => {
  const result = parseBookDirectory(bookFolder());
  assert.equal(result.book.author, null);
  assert.equal(result.book.publish, null);
  assert.ok(!result.diagnostics.some((d) => d.code === "book.manifest"));
});

test("a bad book.json is a usage error naming the problem", () => {
  assert.throws(() => parseBookDirectory(bookFolder("{ not json")), (e) => e instanceof UsageError && /isn't valid JSON/.test(e.message));
  assert.throws(() => parseBookDirectory(bookFolder({ titel: "x" })), (e) => e instanceof UsageError && /unknown field "titel"/.test(e.message));
  assert.throws(() => parseBookDirectory(bookFolder({ year: "2022" })), /"year" must be a whole number/);
  assert.throws(() => parseBookDirectory(bookFolder({ source: "nope" })), /"source" is not a directory/);
});
