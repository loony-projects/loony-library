import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Splits each planned chapter folder into section folders. Text is never
// changed: a page moves whole, or is cut at the line where a section starts,
// both pieces keeping the page's file name. The chapter folder keeps what
// comes before the first section (the chapter's opening).

const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });

export function folderName(index, count, title) {
  let t = title.normalize("NFC").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_.-]+/gu, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (t.length > 80) t = t.slice(0, 80).replace(/_[^_]*$/, "");
  return `${String(index + 1).padStart(count > 99 ? 3 : 2, "0")}_${t || "Untitled"}`;
}

function splitChapter(root, chapter) {
  const dir = path.join(root, chapter.dir);
  const sectionDirs = chapter.sections.map((s, i) => path.join(dir, folderName(i, chapter.sections.length, s.title)));
  const starts = new Map();
  chapter.sections.forEach((s, i) => (starts.get(s.file) ?? starts.set(s.file, []).get(s.file)).push({ line: s.line, index: i }));
  // Pages in reading order: by PDF page number when the names carry one.
  const pageNo = (f) => Number(f.match(/_page_(\d+)\.md$/)?.[1] ?? NaN);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort(byName);
  if (files.every((f) => Number.isFinite(pageNo(f)))) files.sort((a, b) => pageNo(a) - pageNo(b));

  const stats = { moved: 0, split: 0, opening: 0 };
  let owner = -1; // -1 = the chapter folder itself
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split(/(?<=\n)/);
    const pieces = [];
    let from = 0;
    for (const start of (starts.get(file) ?? []).sort((a, b) => a.line - b.line)) {
      const at = start.line - 1;
      if (at > from) pieces.push({ owner, text: lines.slice(from, at).join("") });
      owner = start.index;
      from = at;
    }
    pieces.push({ owner, text: lines.slice(from).join("") });
    const kept = pieces.length === 1 ? pieces : pieces.filter((p) => p.text.length);
    if (kept.length === 1 && kept[0].owner === -1) {
      stats.opening++;
      continue;
    }
    stats[kept.length > 1 ? "split" : "moved"]++;
    for (const piece of kept) {
      const target = piece.owner === -1 ? dir : sectionDirs[piece.owner];
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, file) + (piece.owner === -1 ? ".tmp" : ""), piece.text);
    }
    fs.rmSync(path.join(dir, file));
    if (kept.some((p) => p.owner === -1)) fs.renameSync(path.join(dir, file) + ".tmp", path.join(dir, file));
  }
  return { ...stats, folders: sectionDirs.length };
}

// Every original page equals its pieces - chapter folder first, then the
// section folders in order - joined; and nothing else appeared.
export function verifyChapter(originalDir, dir) {
  const problems = [];
  const sectionDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(byName);
  const seen = new Set();
  for (const file of fs.readdirSync(originalDir).filter((f) => f.endsWith(".md"))) {
    const pieces = [path.join(dir, file), ...sectionDirs.map((s) => path.join(dir, s, file))].filter((p) => fs.existsSync(p));
    pieces.forEach((p) => seen.add(p));
    const joined = Buffer.concat(pieces.map((p) => fs.readFileSync(p)));
    if (!pieces.length || !joined.equals(fs.readFileSync(path.join(originalDir, file)))) problems.push(`${path.basename(dir)}/${file} doesn't rejoin to the original`);
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const p of walk(dir)) if (p.endsWith(".md") && !seen.has(p)) problems.push(`unexpected ${path.relative(path.dirname(dir), p)}`);
  return problems;
}

// A tar.gz of the whole Markdown folder next to it (the book folder when
// it's book/markdown), never overwriting an earlier backup.
export function backup(root) {
  const parent = path.dirname(root);
  let name = `${path.basename(root)}-backup-before-sections.tar.gz`;
  if (fs.existsSync(path.join(parent, name))) name = name.replace(".tar.gz", `-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`);
  execFileSync("tar", ["czf", path.join(parent, name), "-C", parent, path.basename(root)]);
  return path.join(parent, name);
}

// Applies a plan: backup, split, verify. A chapter that doesn't verify is
// put back exactly as it was. Returns per-chapter results.
export function applyPlan(plan, { backupFirst = true } = {}) {
  const root = plan.root;
  const todo = plan.chapters.filter((c) => c.sections.length);
  const backupFile = backupFirst && todo.length ? backup(root) : null;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "organize-"));
  const results = [];
  try {
    for (const chapter of todo) {
      const original = path.join(scratch, chapter.dir);
      fs.cpSync(path.join(root, chapter.dir), original, { recursive: true });
      let stats;
      let problems;
      try {
        stats = splitChapter(root, chapter);
        problems = verifyChapter(original, path.join(root, chapter.dir));
      } catch (error) {
        problems = [error.message];
      }
      if (problems.length) {
        fs.rmSync(path.join(root, chapter.dir), { recursive: true, force: true });
        fs.cpSync(original, path.join(root, chapter.dir), { recursive: true });
      }
      results.push({ dir: chapter.dir, ok: !problems.length, problems, ...stats });
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return { backupFile, results };
}
