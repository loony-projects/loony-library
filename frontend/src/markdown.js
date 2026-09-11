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

  return content.markdown || content.text || "";
}

export function blocksToMarkdown(blocks) {
  return blocks.map(blockToMarkdown).join("\n\n");
}
