import { inlineText } from "./text.js";
import { normalizeRole } from "./roles.js";

// A heading's text is expected to look like one of:
//   "6. The Adverbs"
//   "3.3 Nouns"
//   "10.1.2Inclusive Particle"        (source has a missing space)
//   "Foreword"                        (front matter, no numbering)
// Numbering drives tree depth in the numbering strategies.
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

// Pandoc-style trailing attribute block on a heading: "# Appendix A {.appendix}".
// Only `.class` tokens naming a known role are consumed; anything else is
// left in the title untouched (and reported), so an unrelated literal
// "{...}" at the end of a heading is never silently eaten.
const ATTRIBUTE_RE = /\s*\{\s*((?:\.[\w-]+\s*)+)\}\s*$/;

export function parseRoleAttribute(text) {
  const match = text.match(ATTRIBUTE_RE);
  if (!match) return { text, role: null, unknownClasses: [] };
  const classes = match[1].trim().split(/\s+/).map((c) => c.slice(1));
  const roles = classes.map(normalizeRole);
  if (roles.some((r) => !r) || new Set(roles).size !== 1) {
    return { text, role: null, unknownClasses: classes.filter((c, i) => !roles[i]), conflicting: roles.every(Boolean) };
  }
  return { text: text.slice(0, match.index).trim(), role: roles[0], unknownClasses: [] };
}

/**
 * Heading item for the outline builders: numbering/title split out of the
 * heading's plain text, an explicit role if one was given, and the markdown
 * heading level kept separately from the role.
 */
export function headingItem(node, { position, diagnostics } = {}) {
  const attr = parseRoleAttribute(inlineText(node));
  if (attr.unknownClasses.length) {
    diagnostics?.warning(
      "heading.unknown_role",
      `Heading attribute {${attr.unknownClasses.map((c) => `.${c}`).join(" ")}} is not a known role; kept as heading text.`,
      { position }
    );
  } else if (attr.conflicting) {
    diagnostics?.warning("heading.conflicting_roles", "Heading names more than one role; none applied.", { position });
  }
  const { numbering, title } = parseHeadingText(attr.text);
  if (!title) diagnostics?.warning("heading.empty", "Empty heading.", { position });
  return { kind: "heading", level: node.depth, numbering, title, role: attr.role, position };
}
