import fs from "node:fs";
import "dotenv/config";
import { copyImages, describeImages, loadIntoPostgres } from "./load.js";
import { parseBookDirectory, summarize, printDiagnostics, countBySeverity, renderBookMarkdown, bookDirFromEnv, UsageError, unmangleBook, analyzeCodeBlocks } from "@loony-library/markdown-parser";

// Usage: migrate.js [--title T] [--slug S] [--author A] [--category <slug>]
//                   [--publish] [--reload | --reset] [--allow-errors] [--out book-output.md]
//   (none)    load a new book; stops if its slug is already loaded
//   --reload  replace an already loaded book's contents in place, keeping its
//             readers' shelves, reading positions, annotations and its
//             revisions and section publish states (see reload.js)
//   --reset   delete the book (and everything readers attached to it) and load
//             it fresh
// New books - and their sections - are drafts (hidden from readers) unless
// --publish is given.
// The book's Markdown directory is UPLOAD_BOOK_PATH in .env (see
// .env.example). Title and slug are otherwise derived from the directory
// (see parseBookDirectory).
function parseArgs(argv) {
  const args = { mode: "load", out: null, allowErrors: false, category: null, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") args.mode = "reset";
    else if (arg === "--reload") args.mode = "reload";
    else if (arg === "--allow-errors") args.allowErrors = true;
    else if (arg === "--publish") args.publish = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--title") args.overrides.title = argv[++i];
    else if (arg === "--slug") args.overrides.slug = argv[++i];
    else if (arg === "--author") args.overrides.author = argv[++i];
    else if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
    else throw new UsageError(`Unexpected argument "${arg}". Set the book's Markdown directory as UPLOAD_BOOK_PATH in .env instead.`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new UsageError("DATABASE_URL is not set in book-import/.env (see .env.example)");
  }
  const bookDir = bookDirFromEnv();
  const unmangled = unmangleBook(bookDir);
  if (unmangled) console.log(`Code unmangled into ${unmangled.output}\n  ${unmangled.summary.join("\n  ")}`);
  const data = parseBookDirectory(bookDir, args.overrides);
  // Flags win over the book's book.json.
  data.book.category = args.category ?? data.book.category;
  const publish = args.publish || data.book.publish === true;
  console.log(`${data.book.title} (${data.book.slug}) from ${data.book.sourceDir}`);
  console.log(summarize(data));
  printDiagnostics(data.diagnostics);
  // Warnings and info are authoring issues the outline already works
  // around; an error means the parse is known to be incomplete, so don't
  // load it unless asked.
  if (countBySeverity(data.diagnostics).error && !args.allowErrors) {
    throw new UsageError("Parse reported errors (listed above); fix them or pass --allow-errors to load anyway.");
  }

  if (args.out) {
    fs.writeFileSync(args.out, renderBookMarkdown(data));
    console.log(`Wrote ${args.out}`);
  }

  await analyzeCodeBlocks(data); // code syntax errors, for the import report
  const images = copyImages(data.chapters, data.book);
  console.log(describeImages(images));
  await loadIntoPostgres({ ...data, images, mode: args.mode, publish });
}

main().catch((err) => {
  console.error(err instanceof UsageError ? `Error: ${err.message}` : err);
  process.exit(1);
});
