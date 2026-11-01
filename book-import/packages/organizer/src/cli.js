#!/usr/bin/env node
// npm run organize [-- --apply] [--contents <path>] [--show]
//
// Splits the chapter folders of the book in UPLOAD_BOOK_PATH (book-import/.env)
// into section folders. Without --apply it only prints the plan.
//   --apply           back up the Markdown folder, split, verify byte-for-byte
//   --contents <p>    the contents list, relative to the Markdown folder, when
//                     it isn't a Chapters/ or Contents/ folder or file
//   --pdf-contents <first>-<last>
//                     read the contents list from those pages of the book's PDF
//                     (for a contents page that lost its indentation)
//   --show            list every section found, not just the counts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { bookDirFromEnv, UsageError } from "@loony-library/markdown-parser";
import { planSections } from "./plan.js";
import { applyPlan } from "./apply.js";

function parseArgs(argv) {
  const args = { apply: false, contents: null, pdfPages: null, show: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--show") args.show = true;
    else if (argv[i] === "--contents") args.contents = argv[++i];
    else if (argv[i] === "--pdf-contents") {
      const m = String(argv[++i]).match(/^(\d+)-(\d+)$/);
      if (!m) throw new UsageError("--pdf-contents takes PDF pages as <first>-<last>, e.g. 7-12");
      args.pdfPages = { first: Number(m[1]), last: Number(m[2]) };
    }
    else throw new UsageError(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// The book folder or its markdown/ subfolder, like the parser.
function markdownDir(dir) {
  const sub = path.join(dir, "markdown");
  return fs.existsSync(sub) && fs.statSync(sub).isDirectory() ? sub : dir;
}

function printPlan(plan, show) {
  console.log(`Book: ${plan.root}`);
  console.log(plan.contentsFiles.length ? `Contents list: ${plan.contentsFiles[0]}${plan.contentsFiles.length > 1 ? ` (+${plan.contentsFiles.length - 1} pages)` : ""}${plan.offset != null ? `, PDF page = printed page + ${plan.offset}` : ""}` : "No contents list found: sections from numbered N.M headings");
  if (!plan.chapters.length) console.log("No chapter folders to split (each needs page files and no section folders yet).");
  for (const c of plan.chapters) {
    const what = c.source === "contents" ? `${c.sections.length}/${c.listed} listed sections found (+${c.subsections} subsections stay inside them)` : `${c.sections.length} numbered sections from headings`;
    console.log(`  ${c.dir.padEnd(60).slice(0, 60)} ${String(c.pages).padStart(3)} pages  ${what}`);
    if (show) for (const s of c.sections) console.log(`      ${[s.number, s.title].filter(Boolean).join(" ").slice(0, 60).padEnd(60)} ${s.file} @ line ${s.line}`);
  }
  const total = plan.chapters.reduce((n, c) => n + c.sections.length, 0);
  console.log(`\n${total} section folders in ${plan.chapters.filter((c) => c.sections.length).length} chapters.`);
  if (plan.problems.length) console.log(`\nNot found (${plan.problems.length}):\n  ${plan.problems.join("\n  ")}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = markdownDir(bookDirFromEnv());
  let pdfContents = null;
  if (args.pdfPages) {
    const bookDir = path.basename(root) === "markdown" ? path.dirname(root) : root;
    const pdf = fs.readdirSync(bookDir).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw new UsageError(`--pdf-contents: no PDF in ${bookDir}`);
    pdfContents = { pdf: path.join(bookDir, pdf), ...args.pdfPages };
  }
  const plan = planSections(root, { contents: args.contents, pdfContents });
  printPlan(plan, args.show);
  if (!args.apply) {
    console.log("\nNothing changed. Run with --apply to split.");
  } else {
    const { backupFile, results } = applyPlan(plan);
    if (backupFile) console.log(`\nBackup: ${backupFile}`);
    for (const r of results) {
      console.log(r.ok ? `  ok   ${r.dir}: ${r.folders} sections (pages moved ${r.moved}, split ${r.split}, kept in the opening ${r.opening})` : `  FAIL ${r.dir}: restored as it was - ${r.problems.slice(0, 3).join("; ")}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    if (!results.length) console.log("\nNothing to split.");
    else console.log(failed ? `\n${failed} chapters failed verification and were restored.` : `\nSplit and verified: every page rejoins byte-for-byte.`);
    if (failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof UsageError ? error.message : error);
  process.exitCode = 1;
}
