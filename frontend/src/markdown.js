// Turns a section's content_blocks back into editable markdown source. Most
// block types already carry their original markdown (see
// backend/src/parseMarkdown.js); image and subheading blocks don't, so their
// markdown form is synthesized here.
function blockToMarkdown(block) {
  const { block_type, content } = block;

  if (block_type === "subheading") {
    return `## ${content.text}`;
  }

  if (block_type === "image") {
    const line = `![${content.alt || ""}](${content.src})`;
    return content.caption ? `${line}\n\n*${content.caption}*` : line;
  }

  if (block_type === "code") {
    // A fence must be longer than any backtick run inside the code, or a
    // "```" line in the sample would end the block early on re-parse. The
    // info string is written back exactly (label + meta, e.g.
    // `js title="a.js"`); indented code comes back as a fenced block, same
    // content.
    const longestRun = Math.max(
      0,
      ...(content.code.match(/`+/g) || []).map((run) => run.length),
    );
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const info = [content.lang, content.meta].filter(Boolean).join(" ");
    return `${fence}${info}\n${content.code}\n${fence}`;
  }

  if (block_type === "html") {
    if (content.children) {
      // A merged wrapper (see mergeHtmlWrappers in parseMarkdown.js) -
      // reassemble it with the same blank-line separation the original
      // source had, so re-parsing on save merges it back into one block
      // instead of leaving the tags disconnected again.
      return `${content.openTag}\n\n${blocksToMarkdown(content.children)}\n\n${content.closeTag}`;
    }
    return content.html;
  }

  return content.markdown || content.text || "";
}

export function blocksToMarkdown(blocks) {
  return blocks.map(blockToMarkdown).join("\n\n");
}
