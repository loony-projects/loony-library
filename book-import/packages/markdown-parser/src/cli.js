#!/usr/bin/env node
import fs from "node:fs";
import "dotenv/config";
import { loadBookConfig, parseBook, summarize } from "./index.js";

function parseArgs(argv) {
  const args = { out: "outline.json", book: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--book") args.book = argv[++i];
  }
  if (!args.book) throw new Error("--book <path-to-config.json> is required");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outline = parseBook(loadBookConfig(args.book));
  console.log(summarize(outline));
  fs.writeFileSync(args.out, JSON.stringify(outline, null, 2));
  console.log(`Wrote ${args.out}`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
