import { parseBookPages } from "../src/index.js";

// A one-chapter book around some Markdown: a contents page listing the
// chapter, then the chapter's page - "# <title>" followed by `md`. The
// chapter heading takes two lines, so a block on line N of `md` is on line
// N + 2 of `file`.
export function oneChapterBook(md, { file = "chapter.md", title = "Test Chapter", metadata } = {}) {
  return parseBookPages(
    [
      { file: "contents.md", source: `# Contents\n\n**1 ${title}** 1\n` },
      { file, source: `# ${title}\n\n${md}` },
    ],
    metadata
  );
}

export const chapterOf = (result, n = 1) => result.chapters.filter((c) => c.role === "chapter")[n - 1];
export const bodyOf = (result, n = 1) => chapterOf(result, n).sections[0];
