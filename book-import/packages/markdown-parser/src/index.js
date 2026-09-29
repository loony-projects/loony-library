import fs from "node:fs";
import path from "node:path";
import { buildOutlineByNumbering } from "./buildOutlineByNumbering.js";
import { buildOutlineFlatChapters } from "./buildOutlineFlatChapters.js";
import { extractTermList } from "./extractTermList.js";

export { parseFile } from "./parseFile.js";
export { buildOutlineByNumbering, buildOutlineFlatChapters, extractTermList };

export function loadBookConfig(bookPath) {
  const config = JSON.parse(fs.readFileSync(bookPath, "utf8"));
  if (!config.slug) throw new Error(`${bookPath}: missing "slug"`);

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

function buildChapters(config) {
  if (config.strategy === "flat-chapters") {
    return buildOutlineFlatChapters(config.sourceDir, config);
  }
  if (config.strategy === "numbering") {
    return buildOutlineByNumbering(config.sourceDir);
  }
  throw new Error(`Unknown strategy "${config.strategy}"`);
}

function buildGlossaryAndSymbols(config) {
  if (!config.glossaryFile) return { glossary: [], symbols: [] };
  const glossary = extractTermList(fs.readFileSync(path.join(config.sourceDir, config.glossaryFile), "utf8"));
  const symbols = config.symbolsFile
    ? extractTermList(fs.readFileSync(path.join(config.sourceDir, config.symbolsFile), "utf8")).map((entry) => ({
        symbol: entry.term,
        description: entry.expansion,
      }))
    : [];
  return { glossary, symbols };
}

// Parses a loaded book config (see loadBookConfig) into the outline the
// migration package loads into Postgres: { book, chapters, glossary, symbols }.
export function parseBook(config) {
  const chapters = buildChapters(config);
  const { glossary, symbols } = buildGlossaryAndSymbols(config);
  return { book: config, chapters, glossary, symbols };
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
  return (
    `Parsed ${outline.chapters.length} chapters, ${sections} sections, ${blocks} content blocks, ` +
    `${outline.glossary.length} glossary terms, ${outline.symbols.length} symbols.`
  );
}
