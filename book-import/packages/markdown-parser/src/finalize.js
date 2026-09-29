import { astOf } from "./parseFile.js";
import { parseFenceInfo, getLanguage } from "./languages.js";
import { hasAnalyzer } from "./analysis/registry.js";
import { extractTermEntries } from "./extractTermList.js";

// Stages 6b + 8 - turns a strategy's chapter/section tree into the public
// outline shape shared by every strategy:
//
// - ids: deterministic, positional, unique within the book -
//     chapter "ch3", section "ch3.s0", block "ch3.s0.b4",
//     block inside an HTML wrapper "ch3.s0.b4.1", nested code "ch3.s0.b5.code0".
//   Identical snippets at different places therefore never collide, and
//   re-parsing unchanged source yields the same ids.
// - sections are renumbered in pre-order per chapter (sort_order), which is
//   the order every strategy already created them in.
// - codeBlocks: an index over every code block in the tree, top-level or
//   nested in a list/blockquote/footnote/HTML wrapper, pointing back at its
//   block (blockId), section (ownerId) and chapter (chapterId). The tree is
//   the source of truth; a record's rawCode is a copy of that block's code.
// - term entries from elements whose role is glossary/symbols.

function codeRecord({ id, blockId, content, position, section, chapter, nested, blockIndex, siblings }) {
  const info = parseFenceInfo(content.lang, content.meta);
  const language = content.language;
  const prev = nested ? null : siblings[blockIndex - 1] ?? null;
  const next = nested ? null : siblings[blockIndex + 1] ?? null;
  return {
    id,
    blockId,
    ownerId: section.id,
    chapterId: chapter.id,
    nested,
    rawCode: content.code,
    originalLanguage: content.lang,
    languageLabel: info.label,
    languageAttributes: info.attributes,
    fenceMeta: content.meta,
    fenced: content.fenced,
    normalizedLanguage: language,
    recognizedLanguage: Boolean(language && getLanguage(language)),
    syntaxAnalysisSupported: Boolean(language && hasAnalyzer(language)),
    analysisStatus: "unanalysed",
    position: position ?? null,
    blockIndex: nested ? null : blockIndex,
    previousBlockId: prev?.id ?? null,
    nextBlockId: next?.id ?? null,
    // Documented relationship rule: a paragraph immediately before or after
    // a top-level code block in the same container is its lead-in /
    // follow-up. Adjacency only - no claim that the text explains the code.
    leadInParagraphId: prev?.block_type === "paragraph" ? prev.id : null,
    followUpParagraphId: next?.block_type === "paragraph" ? next.id : null,
  };
}

function titleKey(title) {
  return title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function reportDuplicateTitles(nodes, diagnostics, what) {
  const seen = new Map();
  for (const node of nodes) {
    if (node.role === "body") continue;
    const key = titleKey(node.title);
    if (seen.has(key)) {
      diagnostics.info("structure.duplicate_title", `${what} title "${node.title}" repeats "${seen.get(key)}"; both kept with distinct ids.`, {
        position: node.position,
        elementId: node.id,
      });
    } else seen.set(key, node.id);
  }
}

export function finalizeOutline(chapters, { diagnostics }) {
  const codeBlocks = [];
  const termSources = { glossary: [], symbols: [] };

  chapters.forEach((chapter, chapterIndex) => {
    chapter.sort_order = chapterIndex;
    chapter.id = `ch${chapterIndex}`;
    chapter.role ??= "chapter";
    if (chapter.partRef) {
      chapter.partId = chapter.partRef.id;
      delete chapter.partRef;
    } else chapter.partId ??= null;
  });
  reportDuplicateTitles(chapters, diagnostics, "Chapter");

  for (const chapter of chapters) {
    let sortOrder = 0;

    const visitBlocks = (blocks, section, idPrefix, termRole) => {
      // Ids first, so a code record can point at its following sibling.
      blocks.forEach((block, index) => {
        block.id = `${idPrefix}${idPrefix === section.id ? ".b" : "."}${index}`;
      });
      blocks.forEach((block, index) => {
        if (block.block_type === "code") {
          codeBlocks.push(
            codeRecord({ id: block.id, blockId: block.id, content: block.content, position: block.position, section, chapter, nested: false, blockIndex: index, siblings: blocks })
          );
        }
        (block.nestedCode ?? []).forEach((nested, k) => {
          codeBlocks.push(
            codeRecord({ id: `${block.id}.code${k}`, blockId: block.id, content: nested.content, position: nested.position, section, chapter, nested: true })
          );
        });
        delete block.nestedCode;
        if (termRole) {
          const node = astOf(block);
          if (node) {
            for (const entry of extractTermEntries(node, { file: block.position?.file ?? null, diagnostics, allowBoldLeadIn: true })) {
              termSources[termRole].push({ ...entry, ownerId: section.id, blockId: block.id, chapterId: chapter.id });
            }
          }
        }
        if (block.block_type === "html" && Array.isArray(block.content.children)) {
          visitBlocks(block.content.children, section, block.id, termRole);
        }
      });
    };

    const visitSection = (section, inheritedTermRole) => {
      section.sort_order = sortOrder++;
      section.id = `${chapter.id}.s${section.sort_order}`;
      section.role ??= "section";
      const termRole = ["glossary", "symbols"].includes(section.role)
        ? section.role
        : inheritedTermRole;
      visitBlocks(section.blocks, section, section.id, termRole);

      if (!section.blocks.length && !section.children.length && section.role !== "body") {
        diagnostics.info("structure.empty_section", `Section "${section.title}" has no content.`, {
          position: section.position,
          elementId: section.id,
        });
      }
      section.children.forEach((child) => visitSection(child, termRole));
      reportDuplicateTitles(section.children, diagnostics, "Section");
    };

    const chapterTermRole = ["glossary", "symbols"].includes(chapter.role) ? chapter.role : null;
    chapter.sections.forEach((section) => visitSection(section, chapterTermRole));
    reportDuplicateTitles(chapter.sections, diagnostics, "Section");

    const empty = chapter.sections.every((s) => !s.blocks.length && !s.children.length);
    if (empty && chapter.role !== "part") {
      diagnostics.info("structure.empty_element", `${chapter.role} "${chapter.title}" has no content.`, {
        position: chapter.position,
        elementId: chapter.id,
      });
    }
  }

  return { chapters, codeBlocks, termSources };
}
