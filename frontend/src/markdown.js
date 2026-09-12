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
    const fence = "```";
    return `${fence}${content.lang || ""}\n${content.code}\n${fence}`;
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
