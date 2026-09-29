import { getAnalyzer } from "./registry.js";
import "./treeSitter.js"; // registers the built-in tree-sitter analyzers

export { registerAnalyzer, unregisterAnalyzer, getAnalyzer, hasAnalyzer } from "./registry.js";

// Stage 6c - optional language-specific analysis over the code-block index
// built by parseBookDirectory()/parseBookMarkdown(). Separate from (and after) parsing so that parsing
// stays synchronous and never depends on a parser being loadable.
//
// Per record, three independent facts:
//   recognizedLanguage      - the fence label maps to a registered language
//   syntaxAnalysisSupported - an analyzer exists for it and could be loaded
//   analysisStatus          - what happened to this snippet:
//     "unanalysed"  analysis not run (or the analyzer crashed - see diagnostics)
//     "unsupported" no analyzer for this language (or unlabelled / unknown label)
//     "analysed"    parsed without syntax errors
//     "parse_error" parsed with syntax errors; `analysis` holds partial facts
//                   (usual for book fragments - not a failure of the book)
// A snippet is never executed.

function isModuleMissing(err) {
  return err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND";
}

// Fact ranges are relative to the snippet; add the line in the source file.
function withFileLines(analysis, record) {
  const start = record.position?.start?.line;
  if (!start) return analysis;
  const firstCodeLine = start + (record.fenced ? 1 : 0);
  const map = (fact) => ({ ...fact, line: firstCodeLine + fact.range.startLine - 1 });
  return {
    ...analysis,
    imports: analysis.imports.map(map),
    declarations: analysis.declarations.map(map),
    syntaxErrors: analysis.syntaxErrors.map(map),
  };
}

export async function analyzeCodeBlocks(result, { diagnostics = null } = {}) {
  const push = (severity, code, message, record) => {
    const d = {
      severity,
      code,
      message,
      file: record?.position?.file ?? null,
      line: record?.position?.start?.line ?? null,
      column: record?.position?.start?.column ?? null,
      ...(record ? { elementId: record.id } : {}),
    };
    (diagnostics ?? result.diagnostics).push(d);
  };
  const unavailable = new Set();

  for (const record of result.codeBlocks) {
    const analyzer = record.normalizedLanguage ? getAnalyzer(record.normalizedLanguage) : null;
    if (!analyzer || unavailable.has(record.normalizedLanguage)) {
      record.syntaxAnalysisSupported = false;
      record.analysisStatus = "unsupported";
      delete record.analysis;
      continue;
    }
    try {
      const analysis = withFileLines(await analyzer.analyze(record.rawCode, { label: record.languageLabel }), record);
      record.analysis = analysis;
      record.analysisStatus = analysis.complete ? "analysed" : "parse_error";
      if (!analysis.complete) {
        const first = analysis.syntaxErrors[0];
        push(
          "info",
          "code.syntax_error",
          `${record.normalizedLanguage} snippet has ${analysis.syntaxErrors.length} syntax error(s)` +
            (first ? `, first at snippet line ${first.range.startLine}: ${first.message}` : "") +
            (analysis.truncated ? "; runs to the end of the snippet, likely truncated" : "") +
            " (partial facts kept).",
          { ...record, position: first?.line ? { ...record.position, start: { line: first.line, column: first.range.startColumn } } : record.position }
        );
      }
    } catch (err) {
      delete record.analysis;
      if (isModuleMissing(err)) {
        unavailable.add(record.normalizedLanguage);
        record.syntaxAnalysisSupported = false;
        record.analysisStatus = "unsupported";
        push("warning", "code.analyzer_unavailable", `Analyzer ${analyzer.id} could not be loaded (${err.message}); ${record.normalizedLanguage} snippets left unsupported.`, null);
        continue;
      }
      record.analysisStatus = "unanalysed";
      push("warning", "code.analyzer_failed", `Analyzer ${analyzer.id} failed: ${err.message}`, record);
    }
  }
  return result;
}
