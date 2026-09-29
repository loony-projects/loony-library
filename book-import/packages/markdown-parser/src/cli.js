#!/usr/bin/env node
import fs from "node:fs";
import "dotenv/config";
import { parseBookDirectory, analyzeCodeBlocks, summarize, printDiagnostics } from "./index.js";

// Usage: cli.js <markdown-dir> [--out outline.json] [--title T] [--slug S]
//                              [--no-analyze] [--all-diagnostics]
// <markdown-dir> defaults to UPLOAD_BOOK_PATH (see .env.example).
function parseArgs(argv) {
  const args = { dir: null, out: "outline.json", analyze: true, allDiagnostics: false, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--title") args.overrides.title = argv[++i];
    else if (arg === "--slug") args.overrides.slug = argv[++i];
    else if (arg === "--no-analyze") args.analyze = false;
    else if (arg === "--all-diagnostics") args.allDiagnostics = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else args.dir = arg;
  }
  args.dir ??= process.env.UPLOAD_BOOK_PATH || null;
  if (!args.dir) throw new Error("Pass the book's Markdown directory (or set UPLOAD_BOOK_PATH in .env)");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outline = parseBookDirectory(args.dir, args.overrides);
  if (args.analyze) await analyzeCodeBlocks(outline);
  console.log(`${outline.book.title} (${outline.book.slug}) from ${outline.book.sourceDir} [${outline.book.strategy}]`);
  console.log(summarize(outline));
  printDiagnostics(outline.diagnostics, { all: args.allDiagnostics });
  fs.writeFileSync(args.out, JSON.stringify(outline, null, 2));
  console.log(`Wrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
