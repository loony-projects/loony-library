#!/usr/bin/env node
// npm run import -- <folder> [--apply]
//
// Every book under <folder> - a directory with a book.json or a markdown/
// folder - parsed and checked; prints what would happen to each. With
// --apply, loads the new ones and reloads (in place) the ones already
// loaded. A book whose parse reports errors is skipped either way.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { parseBookDirectory, countBySeverity, UsageError } from "@loony-library/markdown-parser";
import { copyImages, loadIntoPostgres } from "./load.js";

function parseArgs(argv) {
  const args = { folder: null, apply: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
    else if (args.folder) throw new UsageError(`One folder only (got "${args.folder}" and "${arg}")`);
    else args.folder = arg;
  }
  if (!args.folder) throw new UsageError("Usage: npm run import -- <folder of books> [--apply]");
  if (!fs.existsSync(args.folder) || !fs.statSync(args.folder).isDirectory()) throw new UsageError(`Not a directory: ${args.folder}`);
  return args;
}

const isBook = (dir) => fs.existsSync(path.join(dir, "book.json")) || (fs.existsSync(path.join(dir, "markdown")) && fs.statSync(path.join(dir, "markdown")).isDirectory());

// Book folders under `root` (or root itself), not looking inside a book.
export function findBooks(root, depth = 4) {
  if (isBook(root)) return [root];
  if (depth === 0) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .flatMap((e) => findBooks(path.join(root, e.name), depth - 1));
}

const countSections = (chapters) => chapters.reduce((n, c) => n + c.sections.filter((s) => s.role === "section").length, 0);

function survey(dir, loaded) {
  const row = { dir, manifest: fs.existsSync(path.join(dir, "book.json")) };
  try {
    const data = parseBookDirectory(dir);
    const severity = countBySeverity(data.diagnostics);
    const images = copyImages(data.chapters, data.book, { dryRun: true });
    Object.assign(row, {
      data,
      slug: data.book.slug,
      title: data.book.title,
      chapters: data.chapters.length,
      sections: countSections(data.chapters),
      code: data.codeBlocks.length,
      errors: severity.error ?? 0,
      warnings: severity.warning ?? 0,
      missingImages: images.missing.length,
      action: severity.error ? "skip" : loaded.has(data.book.slug) ? "reload" : "load",
      problem: severity.error ? data.diagnostics.find((d) => d.severity === "error")?.message : null,
    });
  } catch (error) {
    Object.assign(row, { action: "skip", problem: error.message });
  }
  return row;
}

function printTable(rows, root) {
  const cell = (v, w) => String(v ?? "").slice(0, w).padEnd(w);
  console.log(`${cell("book", 44)} ${cell("action", 7)} ${"chap".padStart(4)} ${"sect".padStart(5)} ${"code".padStart(5)} ${"warn".padStart(4)} ${"err".padStart(3)} ${"img?".padStart(4)}  notes`);
  for (const r of rows) {
    const notes = [r.problem, r.manifest ? null : "no book.json: title from the folder, loads as a draft"].filter(Boolean).join("; ");
    console.log(
      `${cell(path.relative(root, r.dir) || path.basename(r.dir), 44)} ${cell(r.action, 7)} ${String(r.chapters ?? "-").padStart(4)} ${String(r.sections ?? "-").padStart(5)} ${String(r.code ?? "-").padStart(5)} ${String(r.warnings ?? "-").padStart(4)} ${String(r.errors ?? "-").padStart(3)} ${String(r.missingImages ?? "-").padStart(4)}  ${notes}`
    );
  }
  const by = (a) => rows.filter((r) => r.action === a).length;
  console.log(`\n${rows.length} books: ${by("load")} to load, ${by("reload")} to reload in place, ${by("skip")} skipped.`);
}

async function loadedSlugs() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return new Set((await client.query("select slug from books")).rows.map((r) => r.slug));
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new UsageError("DATABASE_URL is not set in book-import/.env (see .env.example)");
  const root = path.resolve(args.folder);
  const books = findBooks(root);
  if (!books.length) throw new UsageError(`No books under ${root} (a book is a folder with a book.json or a markdown/ folder).`);
  const loaded = await loadedSlugs();
  const rows = books.map((dir) => survey(dir, loaded));
  printTable(rows, root);
  if (!args.apply) {
    console.log("Nothing changed. Run with --apply to load and reload these.");
    return;
  }
  let failed = 0;
  for (const r of rows.filter((r) => r.action !== "skip")) {
    console.log(`\n== ${r.title} (${r.slug})`);
    try {
      copyImages(r.data.chapters, r.data.book);
      await loadIntoPostgres({ ...r.data, mode: r.action, publish: r.data.book.publish === true });
    } catch (error) {
      failed++;
      console.error(`   failed: ${error instanceof UsageError ? error.message : error.stack}`);
    }
  }
  console.log(failed ? `\n${failed} books failed (see above).` : "\nDone.");
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof UsageError ? `Error: ${err.message}` : err);
  process.exit(1);
});
