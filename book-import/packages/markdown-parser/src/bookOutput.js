import { formatDiagnostic, countBySeverity } from "./diagnostics.js";
import { countBlocks } from "./stats.js";

// Renders a parse result as one readable Markdown report (book-output.md):
// what was parsed and how, the parsed contents, diagnostics, the code-block
// index, glossary/symbols, and then the whole book re-assembled under its
// parsed structure - chapters as "##", sections one level deeper per depth -
// so chapter boundaries can be checked by reading.

const MAX_HEADING = 6;

function fenceFor(code) {
  const longest = Math.max(0, ...(code.match(/`+/g) || []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function blockMarkdown(block, depth) {
  const { block_type: type, content } = block;
  switch (type) {
    case "subheading":
      return `${"#".repeat(Math.min(depth + 1, MAX_HEADING))} ${content.text}`;
    case "image": {
      const line = `![${content.alt || ""}](${content.src})`;
      return content.caption ? `${line}\n\n*${content.caption}*` : line;
    }
    case "code": {
      const fence = fenceFor(content.code);
      const info = [content.lang, content.meta].filter(Boolean).join(" ");
      return `${fence}${info}\n${content.code}\n${fence}`;
    }
    case "html":
      if (Array.isArray(content.children)) {
        return [content.openTag, ...content.children.map((c) => blockMarkdown(c, depth)), content.closeTag].join("\n\n");
      }
      return content.html;
    default:
      return content.markdown || content.text || "";
  }
}

const where = (position, fallback = null) => {
  const file = position?.file ?? fallback;
  if (!file) return "";
  return position?.start?.line ? `${file}:${position.start.line}` : file;
};

const escapeCell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function label(el) {
  if (el.role === "chapter" && el.number) return `Chapter ${el.number}: ${el.title}`;
  if (el.role === "part" && el.number) return `Part ${el.number}: ${el.title}`;
  if (el.role === "appendix" && el.number) return `Appendix ${el.number}: ${el.title}`;
  return el.title;
}

function contentsList(result) {
  const lines = [];
  const sectionLines = (sections, indent) => {
    for (const s of sections) {
      if (s.role !== "body") {
        lines.push(`${"  ".repeat(indent)}- ${s.numbering ? `${s.numbering} ` : ""}${s.title} — ${s.blocks.length} blocks`);
      }
      sectionLines(s.children, s.role === "body" ? indent : indent + 1);
    }
  };
  for (const el of result.chapters) {
    const blocks = el.sections.reduce(function count(n, s) {
      return n + s.blocks.length + s.children.reduce(count, 0);
    }, 0);
    const inPart = el.partId ? "  " : "";
    lines.push(`${inPart}- **${label(el)}** (${el.role}) — starts ${where(el.position) || "?"}, ${blocks} blocks`);
    sectionLines(el.sections, inPart ? 2 : 1);
  }
  return lines.join("\n");
}

function diagnosticsSection(diagnostics) {
  if (!diagnostics.length) return "None.";
  const counts = countBySeverity(diagnostics);
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity]);
  return [
    `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info.`,
    "",
    ...sorted.map((d) => `- ${formatDiagnostic(d).replace(/^(\w+)\s+(\S+)/, "**$1** `$2`")}`),
  ].join("\n");
}

function codeSection(codeBlocks) {
  if (!codeBlocks.length) return "None.";
  const rows = codeBlocks.map((c) => {
    const facts = c.analysis
      ? [
          c.analysis.imports.length ? `imports: ${c.analysis.imports.map((i) => i.source).join(", ")}` : "",
          c.analysis.declarations.length
            ? `declares: ${c.analysis.declarations.map((d) => `${d.kind} ${d.name ?? "?"}${d.exported ? " (exported)" : ""}`).join(", ")}`
            : "",
          c.analysis.syntaxErrors.length ? `${c.analysis.syntaxErrors.length} syntax error(s)${c.analysis.truncated ? ", truncated" : ""}` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : "";
    return `| ${c.id} | ${escapeCell(c.originalLanguage ?? "—")} → ${c.normalizedLanguage ?? "—"} | ${c.analysisStatus} | ${escapeCell(where(c.position))} | ${escapeCell(facts)} |`;
  });
  return ["| Id | Language | Analysis | Where | Facts |", "|---|---|---|---|---|", ...rows].join("\n");
}

function termsSection(entries, termKey, defKey) {
  if (!entries.length) return "None.";
  return entries
    .map((e) => {
      const conflicts = e.conflictingDefinitions?.length
        ? ` *(also defined as: ${e.conflictingDefinitions.map((c) => c.expansion).join("; ")})*`
        : "";
      return `- **${e[termKey]}** — ${e[defKey]}${conflicts} (${where(e.position)})`;
    })
    .join("\n");
}

function bookBody(result) {
  const out = [];
  const renderSection = (section, depth) => {
    if (section.role !== "body") {
      const title = `${section.numbering ? `${section.numbering} ` : ""}${section.title}`;
      out.push(`${"#".repeat(Math.min(depth + 1, MAX_HEADING))} ${title}`);
    }
    for (const block of section.blocks) {
      const md = blockMarkdown(block, section.role === "body" ? depth : depth + 1);
      if (md.trim()) out.push(md);
    }
    for (const child of section.children) renderSection(child, section.role === "body" ? depth : depth + 1);
  };
  for (const el of result.chapters) {
    out.push(`## ${label(el)}`);
    out.push(`<!-- ${el.id} · ${el.role} · ${where(el.position) || "?"} -->`);
    for (const section of el.sections) renderSection(section, 2);
  }
  return out.join("\n\n");
}

export function renderBookMarkdown(result) {
  const { book } = result;
  const { sections, blocks } = countBlocks(result.chapters);
  const title = book.title || "Untitled book";
  const meta = [
    book.sourceDir ? `- **Source:** \`${book.sourceDir}\`` : null,
    book.slug ? `- **Slug:** \`${book.slug}\`` : null,
    book.author ? `- **Author:** ${book.author}` : null,
    book.strategy ? `- **Structure from:** ${book.strategy === "toc" ? "the book's contents page" : book.strategy === "numbering" ? "numbered chapter folders" : "heading levels"} (\`${book.strategy}\`)` : null,
    `- **Parsed:** ${result.chapters.length} chapters, ${sections} sections, ${blocks} content blocks, ${result.codeBlocks.length} code blocks, ${result.glossary.length} glossary terms, ${result.symbols.length} symbols`,
  ].filter(Boolean);

  return [
    `# ${title}`,
    meta.join("\n"),
    "## Contents",
    contentsList(result) || "No chapters.",
    "## Diagnostics",
    diagnosticsSection(result.diagnostics),
    "## Code blocks",
    codeSection(result.codeBlocks),
    "## Glossary",
    termsSection(result.glossary, "term", "expansion"),
    "## Symbols",
    termsSection(result.symbols, "symbol", "description"),
    "---",
    "# Book",
    bookBody(result),
    "",
  ].join("\n\n");
}
