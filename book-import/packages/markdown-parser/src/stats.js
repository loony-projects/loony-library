import { countBySeverity } from "./diagnostics.js";

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
