// Every section of a book's table of contents in reading order
// (depth-first), as the previous/next cards and the j/k shortcuts use it.
export function sectionsInOrder(toc) {
  const sections = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      sections.push(n);
      walk(n.children || []);
    }
  };
  for (const c of toc?.chapters || []) walk(c.sections);
  return sections;
}
