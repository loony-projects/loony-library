// Stage 7 - validation. Ordinary authoring problems (an empty heading, a
// duplicate glossary term, a snippet that doesn't parse) are recorded here
// and returned with the result instead of thrown; parsing only throws for
// unreadable input or programmer errors. One collector per parse call, so
// concurrent or repeated parses never share state.
//
// Every diagnostic: { severity, code, message, file?, line?, column?, elementId? }
// Codes are stable identifiers documented in docs/migration.md.

export function createDiagnostics() {
  const list = [];

  function add(severity, code, message, where = {}) {
    const position = where.position;
    list.push({
      severity,
      code,
      message,
      file: where.file ?? position?.file ?? null,
      line: where.line ?? position?.start?.line ?? null,
      column: where.column ?? position?.start?.column ?? null,
      ...(where.elementId ? { elementId: where.elementId } : {}),
    });
  }

  return {
    list,
    error: (code, message, where) => add("error", code, message, where),
    warning: (code, message, where) => add("warning", code, message, where),
    info: (code, message, where) => add("info", code, message, where),
  };
}

export function formatDiagnostic(d) {
  const loc = [d.file, d.line, d.column].filter((x) => x !== null && x !== undefined).join(":");
  return `${d.severity.padEnd(7)} ${d.code}${loc ? ` (${loc})` : ""}: ${d.message}`;
}

export function countBySeverity(diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}

const PRINT_LIMIT = 20;

// Errors and warnings are printed (the first PRINT_LIMIT unless `all`);
// info-level diagnostics only with `all`. Callers keep the full list.
export function printDiagnostics(diagnostics, { all = false, log = console.log } = {}) {
  const shown = all ? diagnostics : diagnostics.filter((d) => d.severity !== "info");
  for (const d of shown.slice(0, all ? shown.length : PRINT_LIMIT)) log(`  ${formatDiagnostic(d)}`);
  if (!all && shown.length > PRINT_LIMIT) log(`  ... ${shown.length - PRINT_LIMIT} more (see "Diagnostics" in book-output.md)`);
}
