import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planSections, applyPlan, readContentsList, findContentsFiles } from "../src/index.js";

function bookTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "organize-"));
  const root = path.join(dir, "markdown");
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

const contents = [
  "# Table of Contents",
  "- **Preface** — xiii",
  "## Part I. Basics",
  "1. **Threads** — 1",
  "   - 1.1 Spawning — 2",
  "     - 1.1.1 Thread ID — 2",
  "   - 1.2 Scoped Threads — 3",
  "2. **Atomics** — 5",
  "   - Atomic Loads — 5",
  "",
].join("\n");

const book = () =>
  bookTree({
    "00_FrontPages/Chapters/b_page_0002.md": contents,
    "01_Threads/b_page_0011.md": "## CHAPTER 1 Threads\n\nIntro.\n\n## 1.1 Spawning\n\nSpawn.\n",
    "01_Threads/b_page_0012.md": "## Thread ID\n\nIds.\n\n## 1.2 Scoped Threads\n\nScoped.\n",
    "01_Threads/b_page_0013.md": "More scoped.\n",
    "02_Atomics/b_page_0015.md": "## Atomics\n\nWhy.\n\n## Atomic Loads\n\nLoad.\n",
    "03_Appendix_A_Tools/b_page_0020.md": "## Appendix A\n\n## A.1 Cargo\n\nBuild.\n\n### A.1.1 Flags\n\nF.\n\n## A.2 Clippy\n\nLint.\n",
  });

test("the contents list gives each chapter's sections; deeper entries stay inside them", () => {
  const root = book();
  const list = readContentsList(findContentsFiles(root));
  assert.deepEqual([...list.values()].map((c) => [c.number, c.title, c.page, c.sections.map((s) => [s.number, s.title]), c.subsections]), [
    [1, "Threads", 1, [["1.1", "Spawning"], ["1.2", "Scoped Threads"]], 1],
    [2, "Atomics", 5, [["", "Atomic Loads"]], 0],
  ]);
});

test("sections are found as headings near their printed page; chapters the contents list doesn't cover use N.M headings", () => {
  const plan = planSections(book());
  assert.equal(plan.offset, 10);
  assert.deepEqual(plan.chapters.map((c) => [c.dir, c.source, c.sections.map((s) => `${s.title}@${s.file}:${s.line}`)]), [
    ["01_Threads", "contents", ["Spawning@b_page_0011.md:5", "Scoped Threads@b_page_0012.md:5"]],
    ["02_Atomics", "contents", ["Atomic Loads@b_page_0015.md:5"]],
    ["03_Appendix_A_Tools", "headings", ["Cargo@b_page_0020.md:3", "Clippy@b_page_0020.md:11"]],
  ]);
  assert.deepEqual(plan.problems, []);
});

test("applying splits pages at section starts, keeps the opening in the chapter folder, and every page rejoins byte-for-byte", () => {
  const root = book();
  const original = fs.readFileSync(path.join(root, "01_Threads/b_page_0012.md"), "utf8");
  const { backupFile, results } = applyPlan(planSections(root));
  assert.ok(fs.existsSync(backupFile));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const ch = path.join(root, "01_Threads");
  assert.deepEqual(fs.readdirSync(ch).sort(), ["01_Spawning", "02_Scoped_Threads", "b_page_0011.md"]);
  assert.equal(fs.readFileSync(path.join(ch, "b_page_0011.md"), "utf8"), "## CHAPTER 1 Threads\n\nIntro.\n\n");
  assert.equal(fs.readFileSync(path.join(ch, "01_Spawning/b_page_0011.md"), "utf8"), "## 1.1 Spawning\n\nSpawn.\n");
  assert.equal(
    fs.readFileSync(path.join(ch, "01_Spawning/b_page_0012.md"), "utf8") + fs.readFileSync(path.join(ch, "02_Scoped_Threads/b_page_0012.md"), "utf8"),
    original
  );
  assert.deepEqual(fs.readdirSync(path.join(ch, "02_Scoped_Threads")).sort(), ["b_page_0012.md", "b_page_0013.md"]);
  // A second run finds nothing left to split.
  assert.equal(planSections(root).chapters.length, 0);
});

test("a chapter that fails verification is restored exactly; the others are kept", () => {
  const root = book();
  // A stray page in an unnumbered subfolder isn't part of any section: the
  // check after splitting reports it, so the chapter must be put back.
  fs.mkdirSync(path.join(root, "02_Atomics/notes"));
  fs.writeFileSync(path.join(root, "02_Atomics/notes/todo.md"), "stray\n");
  const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => [f, fs.statSync(path.join(dir, f)).isFile() ? fs.readFileSync(path.join(dir, f), "utf8") : null]);
  const before = snapshot(path.join(root, "02_Atomics"));
  const { results } = applyPlan(planSections(root), { backupFirst: false });
  const atomics = results.find((r) => r.dir === "02_Atomics");
  assert.equal(atomics.ok, false);
  assert.match(atomics.problems[0], /unexpected .*notes\/todo\.md/);
  assert.deepEqual(snapshot(path.join(root, "02_Atomics")), before);
  assert.ok(results.filter((r) => r.dir !== "02_Atomics").every((r) => r.ok));
});
