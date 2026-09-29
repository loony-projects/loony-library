import fs from "node:fs";
import path from "node:path";
import { buildOutlineByNumbering } from "./buildOutlineByNumbering.js";
import { buildOutlineFlatChapters } from "./buildOutlineFlatChapters.js";
import { buildOutlineByHeadings } from "./buildOutlineByHeadings.js";
import { parseFile } from "./parseFile.js";
import { extractTermList, collectTerms } from "./extractTermList.js";
import { finalizeOutline } from "./finalize.js";
import { createDiagnostics, countBySeverity } from "./diagnostics.js";
import { normalizeRole } from "./roles.js";
import "./analysis/index.js"; // registers the built-in analyzers before any parse

// Pipeline (see docs/migration.md):
//   1 ingestion (markdown.js) -> 2+4 traversal/blocks (parseFile.js)
//   -> 3 structure (buildOutline*.js) -> 5 references (extractTermList.js)
//   -> 6 code index (finalize.js, languages.js) -> 7 diagnostics
//   -> 8 result { book, chapters, glossary, symbols, codeBlocks, diagnostics }
//   and, optionally and asynchronously, 6c analyzeCodeBlocks (analysis/).

export { parseFile, extractItems, astOf } from "./parseFile.js";
export { buildOutlineByNumbering, buildOutlineFlatChapters, buildOutlineByHeadings };
export { extractTermList, extractTermEntries, collectTerms, termKey } from "./extractTermList.js";
export { registerLanguage, normalizeLanguage, parseFenceInfo, getLanguage, listLanguages } from "./languages.js";
export { analyzeCodeBlocks, registerAnalyzer, unregisterAnalyzer, getAnalyzer, hasAnalyzer } from "./analysis/index.js";
export { formatDiagnostic, countBySeverity, printDiagnostics } from "./diagnostics.js";
export { ROLES, normalizeRole } from "./roles.js";
export { parseHeadingText } from "./headings.js";

const STRATEGIES = ["numbering", "flat-chapters", "headings"];

export function loadBookConfig(bookPath) {
  const config = JSON.parse(fs.readFileSync(bookPath, "utf8"));
  if (!config.slug) throw new Error(`${bookPath}: missing "slug"`);
  if (!STRATEGIES.includes(config.strategy)) {
    throw new Error(`${bookPath}: "strategy" must be one of ${STRATEGIES.join(", ")} (got ${JSON.stringify(config.strategy)})`);
  }

  // A book's source is either a single consolidated markdown file
  // (sourceFile - see buildOutlineFlatChapters.js's splitSingleFile) or a
  // directory of *_page_NNNN.md files (sourceDir). sourceDir is optional in
  // the config itself when it's the latter - a new book's config can omit
  // it entirely and just rely on UPLOAD_BOOK_PATH (see .env.example), so
  // migrating a new book never means hand-editing an absolute path into its
  // JSON. An explicit sourceDir in the config still wins, so existing book
  // configs that already hardcode one keep working unchanged.
  if (config.sourceFile) {
    if (!fs.existsSync(config.sourceFile)) {
      throw new Error(`${bookPath}: sourceFile does not exist: ${config.sourceFile}`);
    }
    return config;
  }

  const sourceDir = config.sourceDir || process.env.UPLOAD_BOOK_PATH;
  if (!sourceDir) {
    throw new Error(`${bookPath}: missing "sourceDir"/"sourceFile" (and UPLOAD_BOOK_PATH is not set in .env)`);
  }
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`${bookPath}: sourceDir does not exist: ${sourceDir}`);
  }
  return { ...config, sourceDir };
}

// Markdown files of a "headings" book, in reading order: config.files if
// given (paths relative to sourceDir), else every *.md directly in sourceDir
// sorted by name with numeric awareness ("2-x.md" before "10-y.md").
function headingsSources(config) {
  if (config.sourceFile) {
    return [{ file: path.basename(config.sourceFile), source: fs.readFileSync(config.sourceFile, "utf8") }];
  }
  const files =
    config.files ??
    fs
      .readdirSync(config.sourceDir)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return files.map((file) => ({ file, source: fs.readFileSync(path.join(config.sourceDir, file), "utf8") }));
}

function parseSources(sources, diagnostics) {
  return sources.map(({ file, source }) => ({ file, items: parseFile(source, { file, diagnostics }) }));
}

function buildChapters(config, ctx) {
  if (config.strategy === "flat-chapters") return buildOutlineFlatChapters(config.sourceDir, config, ctx);
  if (config.strategy === "numbering") return buildOutlineByNumbering(config.sourceDir, ctx);
  return buildOutlineByHeadings(parseSources(headingsSources(config), ctx.diagnostics), config, ctx);
}

// config.roles: { "<chapter slug>": "<role>" } - explicit per-book roles for
// strategies whose source has no role syntax (e.g. { "016_Appendix": "appendix" }).
function applyConfigRoles(chapters, config, diagnostics) {
  for (const [slug, value] of Object.entries(config.roles ?? {})) {
    const role = normalizeRole(value);
    const chapter = chapters.find((c) => c.slug === slug);
    if (!role) diagnostics.warning("config.unknown_role", `roles["${slug}"]: "${value}" is not a known role.`, {});
    else if (!chapter) diagnostics.warning("config.unknown_chapter", `roles["${slug}"]: no chapter with that slug.`, {});
    else chapter.role = role;
  }
}

function termFileEntries(config, key, diagnostics) {
  const name = config[key];
  if (!name) return [];
  const baseDir = config.sourceDir ?? path.dirname(config.sourceFile ?? ".");
  const filePath = path.resolve(baseDir, name);
  if (!fs.existsSync(filePath)) {
    diagnostics.error("source.missing_file", `${key} ${name} does not exist.`, { file: name });
    return [];
  }
  return extractTermList(fs.readFileSync(filePath, "utf8"), { file: name, diagnostics }).map((entry) => ({
    ...entry,
    ownerId: null,
    blockId: null,
    chapterId: null,
  }));
}

function buildReferences(config, termSources, diagnostics) {
  const glossary = collectTerms([...termFileEntries(config, "glossaryFile", diagnostics), ...termSources.glossary], {
    kind: "glossary",
    diagnostics,
  });
  // Symbols are compared case-sensitively ("N" and "n" are different symbols).
  const symbols = collectTerms([...termFileEntries(config, "symbolsFile", diagnostics), ...termSources.symbols], {
    kind: "symbols",
    caseSensitive: true,
    diagnostics,
  }).map(({ term, expansion, ...rest }) => ({ symbol: term, description: expansion, ...rest }));
  return { glossary, symbols };
}

function assemble(config, chapters, diagnostics) {
  applyConfigRoles(chapters, config, diagnostics);
  const { codeBlocks, termSources } = finalizeOutline(chapters, { diagnostics });
  const { glossary, symbols } = buildReferences(config, termSources, diagnostics);
  return { book: config, chapters, glossary, symbols, codeBlocks, diagnostics: diagnostics.list };
}

/**
 * Parses a loaded book config (see loadBookConfig) into the outline the
 * migration package loads into Postgres. Synchronous; code blocks come back
 * with analysisStatus "unanalysed" - run analyzeCodeBlocks() for syntax
 * analysis.
 */
export function parseBook(config) {
  const diagnostics = createDiagnostics();
  const chapters = buildChapters(config, { diagnostics });
  return assemble(config, chapters, diagnostics);
}

/**
 * Parses Markdown directly (no config file, no filesystem) with the
 * "headings" strategy.
 *   input:   a Markdown string, or [{ file, source }] in reading order
 *   options: { metadata?: object, chapterLevel?: number, roles?: object }
 */
export function parseBookMarkdown(input, options = {}) {
  const diagnostics = createDiagnostics();
  const sources = typeof input === "string" ? [{ file: options.file ?? null, source: input }] : input;
  const config = { strategy: "headings", ...options.metadata, chapterLevel: options.chapterLevel, roles: options.roles };
  const chapters = buildOutlineByHeadings(parseSources(sources, diagnostics), config, { diagnostics });
  const result = assemble(config, chapters, diagnostics);
  result.book = options.metadata ?? {};
  return result;
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
