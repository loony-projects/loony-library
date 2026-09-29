#!/usr/bin/env node
import fs from "node:fs";
import "dotenv/config";
import { parseBookDirectory, analyzeCodeBlocks, summarize, printDiagnostics, renderBookMarkdown, bookDirFromEnv, UsageError } from "./index.js";

// Usage: cli.js [--out book-output.md] [--title T] [--slug S] [--no-analyze] [--all-diagnostics]
// The book's Markdown directory is UPLOAD_BOOK_PATH in .env (see .env.example).
function parseArgs(argv) {
  const args = { out: "book-output.md", analyze: true, allDiagnostics: false, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--title") args.overrides.title = argv[++i];
    else if (arg === "--slug") args.overrides.slug = argv[++i];
    else if (arg === "--no-analyze") args.analyze = false;
    else if (arg === "--all-diagnostics") args.allDiagnostics = true;
    else if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
    else throw new UsageError(`Unexpected argument "${arg}". Set the book's Markdown directory as UPLOAD_BOOK_PATH in .env instead.`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outline = parseBookDirectory(bookDirFromEnv(), args.overrides);
  if (args.analyze) await analyzeCodeBlocks(outline);
  console.log(`${outline.book.title} (${outline.book.slug}) from ${outline.book.sourceDir} [${outline.book.strategy}]`);
  console.log(summarize(outline));
  printDiagnostics(outline.diagnostics, { all: args.allDiagnostics });
  fs.writeFileSync(args.out, renderBookMarkdown(outline));
  console.log(`Wrote ${args.out}`);
}

main().catch((err) => {
  console.error(err instanceof UsageError ? `Error: ${err.message}` : err);
  process.exit(1);
});
