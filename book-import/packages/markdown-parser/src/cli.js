#!/usr/bin/env node
import fs from "node:fs";
import "dotenv/config";
import { loadBookConfig, parseBook, analyzeCodeBlocks, summarize, printDiagnostics } from "./index.js";

// Usage: cli.js --book books/<slug>.json [--out outline.json] [--no-analyze] [--all-diagnostics]
function parseArgs(argv) {
  const args = { out: "outline.json", book: null, analyze: true, allDiagnostics: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--book") args.book = argv[++i];
    else if (argv[i] === "--no-analyze") args.analyze = false;
    else if (argv[i] === "--all-diagnostics") args.allDiagnostics = true;
  }
  if (!args.book) throw new Error("--book <path-to-config.json> is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outline = parseBook(loadBookConfig(args.book));
  if (args.analyze) await analyzeCodeBlocks(outline);
  console.log(summarize(outline));
  printDiagnostics(outline.diagnostics, { all: args.allDiagnostics });
  fs.writeFileSync(args.out, JSON.stringify(outline, null, 2));
  console.log(`Wrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
