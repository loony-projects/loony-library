// Language analyzer registry. An analyzer is
//   { id, languages: string[], analyze(code, { label }) => Promise<LanguageAnalysis> }
// where LanguageAnalysis is
//   { parser, complete, imports[], declarations[], syntaxErrors[] }
// (see types.d.ts). analyze() must be deterministic, must never execute the
// snippet, and may throw only for internal failures - a snippet that
// doesn't parse is a normal result (complete: false, syntaxErrors).
//
// Registration is synchronous and loading is lazy (an analyzer loads its
// parser on first use), so parseBookDirectory() can report syntaxAnalysisSupported
// without loading any parser.

const analyzers = new Map(); // language id -> analyzer

export function registerAnalyzer(analyzer) {
  for (const language of analyzer.languages) analyzers.set(language, analyzer);
}

export function unregisterAnalyzer(language) {
  analyzers.delete(language);
}

export function getAnalyzer(language) {
  return analyzers.get(language) ?? null;
}

export function hasAnalyzer(language) {
  return analyzers.has(language);
}
