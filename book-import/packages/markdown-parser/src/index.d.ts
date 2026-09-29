// Public types of @loony-library/markdown-parser. The package is plain
// JavaScript; this file documents (and lets editors check) the result shape.

export interface SourcePoint {
  line: number;
  column: number;
  offset?: number;
}

export interface SourcePosition {
  file: string | null;
  start: SourcePoint;
  end: SourcePoint;
}

export type Severity = "error" | "warning" | "info";

export interface ParseDiagnostic {
  severity: Severity;
  /** Stable identifier, e.g. "heading.empty", "glossary.conflict" (see docs/migration.md). */
  code: string;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  elementId?: string;
}

export type FrontMatterRole =
  | "front_matter" | "cover" | "half_title" | "title_page" | "copyright" | "dedication" | "epigraph"
  | "toc" | "foreword" | "preface" | "introduction" | "prologue" | "acknowledgments";
export type MainMatterRole = "part" | "chapter" | "interlude";
export type BackMatterRole =
  | "conclusion" | "epilogue" | "afterword" | "appendix" | "notes" | "glossary" | "symbols"
  | "bibliography" | "index" | "about_author" | "also_by" | "back_matter";
export type ElementRole = FrontMatterRole | MainMatterRole | BackMatterRole;
export type SectionRole = "body" | "section" | ElementRole;

// ---- content blocks (stored as content_blocks rows: block_type + content) ----

interface BlockBase<T extends string, C> {
  kind: "block";
  /** "ch3.s0.b4" - unique in the book, deterministic for unchanged source. */
  id: string;
  block_type: T;
  content: C & { text: string };
  position?: SourcePosition;
}

export type ParagraphBlock = BlockBase<"paragraph", { markdown: string }>;
export type ImageBlock = BlockBase<"image", { src: string; alt: string | null; caption: string | null }>;
export type TableBlock = BlockBase<"table", { headers: string[]; rows: string[][]; markdown: string }>;
export type ListBlock = BlockBase<"list", { ordered: boolean; items: string[]; markdown: string }>;
export type BlockquoteBlock = BlockBase<"blockquote", { markdown: string }>;
export type SubheadingBlock = BlockBase<"subheading", {}>;
export interface CodeContent {
  code: string;
  /** Fence label exactly as written (first word of the info string), never rewritten. */
  lang: string | null;
  /** Rest of the fence info string, e.g. 'title="a.js"'. */
  meta: string | null;
  /** Normalized language id ("rust" for rs / rust,editable), null if unlabelled or unrecognized. */
  language: string | null;
  fenced: boolean;
}
export type CodeBlock = BlockBase<"code", CodeContent>;
export type HtmlBlock = BlockBase<
  "html",
  { html: string } | { openTag: string; closeTag: string; children: ContentBlock[] }
>;
export type ThematicBreakBlock = BlockBase<"thematic_break", { markdown: string }>;
export type FootnoteBlock = BlockBase<"footnote", { identifier: string; label: string; markdown: string }>;
export type DefinitionBlock = BlockBase<
  "definition",
  { identifier: string; label: string; url: string; title: string | null; markdown: string }
>;
export type UnknownBlock = BlockBase<"unknown", { nodeType: string; markdown: string }>;

export type ContentBlock =
  | ParagraphBlock | ImageBlock | TableBlock | ListBlock | BlockquoteBlock | SubheadingBlock
  | CodeBlock | HtmlBlock | ThematicBreakBlock | FootnoteBlock | DefinitionBlock | UnknownBlock;

// ---- structure ---------------------------------------------------------------

export interface Section {
  id: string;
  role: SectionRole;
  numbering: string | null;
  title: string;
  /** Markdown heading level, when the section came from a heading. */
  level?: number | null;
  /** Depth in the section tree (1 = chapter body / top level). */
  depth: number;
  sort_order: number;
  source_file: string | null;
  position?: SourcePosition;
  blocks: ContentBlock[];
  children: Section[];
}

/** A top-level book element. Every block lives in one of its sections. */
export interface Chapter {
  id: string;
  role: ElementRole;
  number: string | null;
  slug: string;
  title: string;
  level?: number | null;
  sort_order: number;
  position?: SourcePosition;
  /** For chapters/interludes inside a part: the part's chapter id. */
  partId: string | null;
  sections: Section[];
}

// ---- references ----------------------------------------------------------------

interface TermSource {
  /** Normalized lookup key (NFKC, whitespace-collapsed; lower-cased for glossary terms). */
  key: string;
  position?: SourcePosition;
  /** Section / block / chapter the {.glossary}/{.symbols} element entry came from. */
  ownerId: string | null;
  blockId: string | null;
  chapterId: string | null;
  conflictingDefinitions?: { expansion: string; position?: SourcePosition }[];
}
export interface GlossaryEntry extends TermSource {
  term: string;
  expansion: string;
}
export interface SymbolEntry extends Omit<TermSource, "conflictingDefinitions"> {
  symbol: string;
  description: string;
  conflictingDefinitions?: { expansion: string; position?: SourcePosition }[];
}

// ---- code ----------------------------------------------------------------------

export type AnalysisStatus = "unanalysed" | "analysed" | "unsupported" | "parse_error";

export interface SnippetRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}
export interface LanguageAnalysis {
  /** Parser that produced the facts, e.g. "tree-sitter-rust@0.24.0". */
  parser: string;
  /** False when the snippet has syntax errors; facts are then partial. */
  complete: boolean;
  /** An ERROR/MISSING node reaches the end of the snippet (cut-off example). */
  truncated: boolean;
  package?: string | null;
  imports: { source: string | null; range: SnippetRange; line?: number }[];
  declarations: { kind: string; name: string | null; exported: boolean | null; range: SnippetRange; line?: number }[];
  syntaxErrors: { message: string; range: SnippetRange; line?: number }[];
}

/** Index entry for one code block in the tree (top-level or nested). */
export interface CodeBlockRecord {
  /** Equal to blockId for a top-level code block; "<blockId>.code<n>" when nested. */
  id: string;
  blockId: string;
  /** Owning section id. */
  ownerId: string;
  chapterId: string;
  nested: boolean;
  rawCode: string;
  originalLanguage: string | null;
  languageLabel: string | null;
  languageAttributes: string[];
  fenceMeta: string | null;
  fenced: boolean;
  normalizedLanguage: string | null;
  recognizedLanguage: boolean;
  syntaxAnalysisSupported: boolean;
  analysisStatus: AnalysisStatus;
  analysis?: LanguageAnalysis;
  position: SourcePosition | null;
  blockIndex: number | null;
  previousBlockId: string | null;
  nextBlockId: string | null;
  leadInParagraphId: string | null;
  followUpParagraphId: string | null;
}

/** Derived from the Markdown directory (see parseBookDirectory); empty-ish for parseBookMarkdown. */
export interface BookMetadata {
  slug?: string;
  title?: string;
  author?: string | null;
  /** Absolute path of the Markdown directory. */
  sourceDir?: string;
  /** Structure strategy chosen from the directory's shape. */
  strategy?: "toc" | "headings" | "numbering";
  [key: string]: unknown;
}

export interface BookParseResult {
  book: BookMetadata;
  chapters: Chapter[];
  glossary: GlossaryEntry[];
  symbols: SymbolEntry[];
  codeBlocks: CodeBlockRecord[];
  diagnostics: ParseDiagnostic[];
}

// ---- API -----------------------------------------------------------------------

export interface HeadingItem {
  kind: "heading";
  level: number;
  numbering: string | null;
  title: string;
  role: ElementRole | null;
  position?: SourcePosition;
}
export type ParsedItem = HeadingItem | (Omit<ContentBlock, "id"> & { id?: string });

export interface Diagnostics {
  list: ParseDiagnostic[];
  error(code: string, message: string, where?: object): void;
  warning(code: string, message: string, where?: object): void;
  info(code: string, message: string, where?: object): void;
}

/** Parses a book's Markdown directory (e.g. pdf-to-md output). Throws only if it isn't a directory. */
export function parseBookDirectory(dir: string, overrides?: { title?: string; slug?: string; author?: string }): BookParseResult;
export function parseBookMarkdown(
  input: string | { file: string | null; source: string }[],
  options?: { file?: string; metadata?: Record<string, unknown>; chapterLevel?: number }
): BookParseResult;
export function slugify(text: string): string;
export function analyzeCodeBlocks<R extends BookParseResult>(result: R, options?: { diagnostics?: ParseDiagnostic[] }): Promise<R>;
export function parseFile(source: string, options?: { file?: string | null; diagnostics?: Diagnostics | null }): ParsedItem[];
export function astOf(item: object): unknown;
export function summarize(result: BookParseResult): string;
/** The readable report the CLI writes to book-output.md. */
export function renderBookMarkdown(result: BookParseResult): string;
export function countBlocks(chapters: Chapter[]): { sections: number; blocks: number };
export function formatDiagnostic(diagnostic: ParseDiagnostic): string;
export function countBySeverity(diagnostics: ParseDiagnostic[]): Record<Severity, number>;
export function printDiagnostics(diagnostics: ParseDiagnostic[], options?: { all?: boolean; log?: (line: string) => void }): void;
export function extractTermList(
  source: string,
  options?: { file?: string | null; diagnostics?: Diagnostics | null }
): { term: string; expansion: string; position?: SourcePosition }[];

export function registerLanguage(language: { id: string; name?: string; aliases?: string[] }): { id: string; name: string; aliases: string[] };
export function normalizeLanguage(label: string | null | undefined): string | null;
export function parseFenceInfo(lang: string | null, meta: string | null): { label: string | null; attributes: string[]; meta: string | null };
export function getLanguage(id: string): { id: string; name: string; aliases: string[] } | null;
export function listLanguages(): { id: string; name: string; aliases: string[] }[];

export interface Analyzer {
  id: string;
  languages: string[];
  analyze(code: string, options: { label: string | null }): Promise<LanguageAnalysis>;
}
export function registerAnalyzer(analyzer: Analyzer): void;
export function unregisterAnalyzer(language: string): void;
export function getAnalyzer(language: string): Analyzer | null;
export function hasAnalyzer(language: string): boolean;

export const ROLES: Record<ElementRole, "front" | "main" | "back">;
export function normalizeRole(value: string): ElementRole | null;
export function parseHeadingText(raw: string): { numbering: string | null; title: string };
