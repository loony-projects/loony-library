import { inlineText } from "./text.js";

// A heading's text is expected to look like one of:
//   "6. The Adverbs"
//   "3.3 Nouns"
//   "10.1.2Inclusive Particle"        (source has a missing space)
//   "Foreword"                        (front matter, no numbering)
// The numbering is kept with the heading (it's part of the subheading text
// and of matching a contents entry like "3.1 ...").
//
// The missing-space form is only accepted for dotted numbering: a single
// number glued to a word ("3D Graphics", "64-bit Atomics") is a title, not
// section 3 titled "D Graphics".
const NUMBERING_RE = /^(\d+(?:\.\d+)*)(\.?)(\s*)(.*)$/;

export function parseHeadingText(raw) {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(NUMBERING_RE);
  if (match) {
    const [, numbering, dot, space, rest] = match;
    const separated = dot || space || (numbering.includes(".") && /^\p{L}/u.test(rest));
    if (rest && separated) return { numbering, title: rest.trim() };
  }
  return { numbering: null, title: cleaned };
}

/**
 * Heading item for the parsed page: numbering/title split out of the
 * heading's plain text, plus its markdown level. Headings never create
 * chapters or sections (see buildOutlineByToc.js); they're used to locate
 * the chapters a contents page lists, and are otherwise kept as subheadings.
 */
export function headingItem(node, { position } = {}) {
  const { numbering, title } = parseHeadingText(inlineText(node));
  return { kind: "heading", level: node.depth, numbering, title, position };
}
