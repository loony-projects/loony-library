import fs from "node:fs";
import path from "node:path";
import { buildOutlineByNumbering } from "./buildOutlineByNumbering.js";
import { buildOutlineByHeadings, slugify } from "./buildOutlineByHeadings.js";
import { buildOutlineByToc } from "./buildOutlineByToc.js";
import { parseFile } from "./parseFile.js";
import { collectTerms } from "./extractTermList.js";
import { finalizeOutline } from "./finalize.js";
import { createDiagnostics, countBySeverity } from "./diagnostics.js";
import "./analysis/index.js"; // registers the built-in analyzers before any parse

// Pipeline (see docs/migration.md):
//   1 ingestion (markdown.js) -> 2+4 traversal/blocks (parseFile.js)
//   -> 3 structure (buildOutline*.js) -> 5 references (extractTermList.js)
//   -> 6 code index (finalize.js, languages.js) -> 7 diagnostics
//   -> 8 result { book, chapters, glossary, symbols, codeBlocks, diagnostics }
//   and, optionally and asynchronously, 6c analyzeCodeBlocks (analysis/).

export { parseFile, extractItems, astOf } from "./parseFile.js";
export { buildOutlineByNumbering, buildOutlineByHeadings, buildOutlineByToc, slugify };
export { readTableOfContents } from "./toc.js";
export { extractTermList, extractTermEntries, collectTerms, termKey } from "./extractTermList.js";
export { registerLanguage, normalizeLanguage, parseFenceInfo, getLanguage, listLanguages } from "./languages.js";
export { analyzeCodeBlocks, registerAnalyzer, unregisterAnalyzer, getAnalyzer, hasAnalyzer } from "./analysis/index.js";
export { formatDiagnostic, countBySeverity, printDiagnostics } from "./diagnostics.js";
export { ROLES, normalizeRole } from "./roles.js";
export { parseHeadingText } from "./headings.js";

// A book is a directory of Markdown - typically pdf-to-md output
// (<name>_page_NNNN.md files, <name>_metadata.json, images/). Everything
// about the book comes from that directory; there is no per-book config.
//
// Structure, in order of preference:
//   - NNN_Name/ chapter subdirectories -> "numbering" (buildOutlineByNumbering.js)
//   - otherwise every *.md directly in it, in numeric-aware name order
//     ("page_2" before "page_10"), and then:
//     - a contents page ("Contents", "Table of Contents", ...) whose
//       chapters can be placed -> "toc" (toc.js, buildOutlineByToc.js)
//     - else heading levels -> "headings" (buildOutlineByHeadings.js)
const CHAPTER_DIR_RE = /^\d{3}_.+/;

function readMetadataName(sourceDir, files, diagnostics) {
  const metaFile = files.find((f) => f.endsWith("_metadata.json"));
  if (!metaFile) return null;
  try {
    const name = JSON.parse(fs.readFileSync(path.join(sourceDir, metaFile), "utf8"))?.pdf?.name;
    return typeof name === "string" && name.trim() ? name.replace(/\.pdf$/i, "") : null;
  } catch (err) {
    diagnostics.warning("source.bad_metadata", `${metaFile} is not valid JSON (${err.message}); title taken from the folder name.`, {
      file: metaFile,
    });
    return null;
  }
}

// Title: the PDF name from <name>_metadata.json, else the folder name (its
// parent's when the folder is just "markdown"), underscores as spaces.
function bookMetadata(sourceDir, files, overrides, diagnostics) {
  const folder = path.basename(sourceDir).toLowerCase() === "markdown" ? path.basename(path.dirname(sourceDir)) : path.basename(sourceDir);
  const title = overrides.title ?? (readMetadataName(sourceDir, files, diagnostics) ?? folder).replace(/_+/g, " ").trim();
  return { slug: overrides.slug ?? slugify(title), title, author: overrides.author ?? null, sourceDir };
}

/**
 * Parses a book's Markdown directory into the outline the migration package
 * loads into Postgres. Synchronous; code blocks come back with
 * analysisStatus "unanalysed" - run analyzeCodeBlocks() for syntax analysis.
 *   overrides: { title?, slug?, author? } - otherwise derived from the directory.
 */
export function parseBookDirectory(dir, overrides = {}) {
  if (!dir) throw new Error("A Markdown directory is required");
  const sourceDir = path.resolve(dir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Not a directory: ${sourceDir}`);
  }
  const diagnostics = createDiagnostics();
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const book = bookMetadata(sourceDir, entries.map((e) => e.name), overrides, diagnostics);

  let chapters;
  if (entries.some((e) => e.isDirectory() && CHAPTER_DIR_RE.test(e.name))) {
    book.strategy = "numbering";
    chapters = buildOutlineByNumbering(sourceDir, { diagnostics });
  } else {
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const sources = files.map((file) => ({ file, source: fs.readFileSync(path.join(sourceDir, file), "utf8") }));
    const pages = parseSources(sources, diagnostics);
    chapters = buildOutlineByToc(pages, { diagnostics });
    book.strategy = chapters ? "toc" : "headings";
    chapters ??= buildOutlineByHeadings(pages, book, { diagnostics });
  }
  return assemble(book, chapters, diagnostics);
}

function parseSources(sources, diagnostics) {
  return sources.map(({ file, source }) => ({ file, items: parseFile(source, { file, diagnostics }) }));
}

// Glossary and symbol entries come from elements marked {.glossary} /
// {.symbols} (see finalize.js / extractTermList.js).
function buildReferences(termSources, diagnostics) {
  const glossary = collectTerms(termSources.glossary, { kind: "glossary", diagnostics });
  // Symbols are compared case-sensitively ("N" and "n" are different symbols).
  const symbols = collectTerms(termSources.symbols, { kind: "symbols", caseSensitive: true, diagnostics }).map(
    ({ term, expansion, ...rest }) => ({ symbol: term, description: expansion, ...rest })
  );
  return { glossary, symbols };
}

function assemble(book, chapters, diagnostics) {
  const { codeBlocks, termSources } = finalizeOutline(chapters, { diagnostics });
  const { glossary, symbols } = buildReferences(termSources, diagnostics);
  return { book, chapters, glossary, symbols, codeBlocks, diagnostics: diagnostics.list };
}

/**
 * Parses Markdown directly (no filesystem) with the "headings" strategy.
 *   input:   a Markdown string, or [{ file, source }] in reading order
 *   options: { file?, metadata?: object, chapterLevel?: number }
 */
export function parseBookMarkdown(input, options = {}) {
  const diagnostics = createDiagnostics();
  const sources = typeof input === "string" ? [{ file: options.file ?? null, source: input }] : input;
  const book = { ...options.metadata };
  const chapters = buildOutlineByHeadings(parseSources(sources, diagnostics), { ...book, chapterLevel: options.chapterLevel }, {
    diagnostics,
  });
  return assemble(book, chapters, diagnostics);
}

export function countBlocks(chapters) {
  let sections = 0;
  let blocks = 0;
  const walk = (nodes) => {
    for (const s of nodes) {
      sections++;
      blocks += s.blocks.length;
      walk(s.children);
    }
  };
  chapters.forEach((c) => walk(c.sections));
  return { sections, blocks };
}

export function summarize(outline) {
  const { sections, blocks } = countBlocks(outline.chapters);
  const counts = countBySeverity(outline.diagnostics ?? []);
  return (
    `Parsed ${outline.chapters.length} chapters, ${sections} sections, ${blocks} content blocks, ` +
    `${outline.codeBlocks?.length ?? 0} code blocks, ` +
    `${outline.glossary.length} glossary terms, ${outline.symbols.length} symbols. ` +
    `Diagnostics: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info.`
  );
}
