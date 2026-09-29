// Turns an edited section's markdown back into content_blocks rows - the
// same block extraction the book import uses (no longer a hand-synced copy),
// so an edit round-trips into exactly the block shapes a fresh import would
// produce: paragraphs/lists/tables/code (with fence meta and normalized
// language)/html wrappers/thematic breaks/footnotes/link definitions, and
// `unknown` for anything else rather than dropping it. Every heading comes
// back as a heading item, which routes/sections.js stores as a `subheading`
// block, since editing a section's text doesn't change the book's section
// tree.
//
// Requires book-import's workspace to be installed (`cd book-import && npm
// install`) - see docs/dev_setup.md.
export { parseFile as parseMarkdown } from "@loony-library/markdown-parser";
