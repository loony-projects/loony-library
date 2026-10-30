// Structural roles a book element can have. Roles come from the book's
// contents page (buildOutlineByToc.js): its "Chapter N" / "Part N" /
// "Appendix A" labels, or an unnumbered entry whose whole title names one
// of these ("Preface", "Glossary", "About the Author", ...). Headings in the
// pages never assign a role.
//
// division: which part of the book the role belongs to.
export const ROLES = {
  // front matter
  front_matter: "front",
  cover: "front",
  half_title: "front",
  title_page: "front",
  copyright: "front",
  dedication: "front",
  epigraph: "front",
  toc: "front",
  foreword: "front",
  preface: "front",
  introduction: "front",
  prologue: "front",
  acknowledgments: "front",
  // main matter
  part: "main",
  chapter: "main",
  interlude: "main",
  // back matter
  conclusion: "back",
  epilogue: "back",
  afterword: "back",
  appendix: "back",
  notes: "back",
  glossary: "back",
  symbols: "back",
  bibliography: "back",
  index: "back",
  about_author: "back",
  also_by: "back",
  back_matter: "back",
};

// Roles below the top level: the leading section that holds a chapter's
// (or part's) own content before its first subheading, and ordinary
// subsections.
export const SECTION_ROLES = ["body", "section"];

// Alternative spellings accepted in `{.role}` classes and config values.
const ALIASES = {
  acknowledgements: "acknowledgments",
  acknowledgement: "acknowledgments",
  acknowledgment: "acknowledgments",
  contents: "toc",
  "table-of-contents": "toc",
  "half-title": "half_title",
  "title-page": "title_page",
  "front-matter": "front_matter",
  "back-matter": "back_matter",
  "about-the-author": "about_author",
  "about-author": "about_author",
  "also-by": "also_by",
  references: "bibliography",
  endnotes: "notes",
  abbreviations: "glossary",
};

export function normalizeRole(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  const role = ALIASES[key] ?? key.replace(/-/g, "_");
  return Object.hasOwn(ROLES, role) ? role : null;
}
