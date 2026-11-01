// Reloading a book in place: the book row (and so its shelves, reviews,
// reading history, co-authors and cover) stays; its chapters and sections are
// replaced, and everything that pointed at an old section - annotations,
// revisions, the reading position - and each section's editorial state
// (publish status, saved draft) moves to the matching new section.
//
// A new section matches an old one by, in order:
//   1. title  - same chapter (by slug), same section title, same occurrence
//               of that title in the chapter
//   2. place  - same chapter, same position in it
//   3. chapter - the same chapter's first section
//   4. book   - the book's first section
// Editorial state only carries over on 1 and 2.

const tally = () => ({ title: 0, place: 0, chapter: 0, book: 0 });

// Sections of a chapter in reading order (depth-first by sort_order), as
// { id, title } - the shape both the old rows and the newly inserted ones
// are reduced to.
export function readingOrder(sections) {
  const children = new Map();
  for (const s of sections) (children.get(s.parent_id ?? null) ?? children.set(s.parent_id ?? null, []).get(s.parent_id ?? null)).push(s);
  for (const list of children.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  const out = [];
  const walk = (parent) => (children.get(parent) ?? []).forEach((s) => (out.push(s), walk(s.id)));
  walk(null);
  return out;
}

// chapter slug -> [{ id, title }] in reading order, with occurrence keys.
function index(chapters) {
  const byChapter = new Map();
  for (const { slug, sections } of chapters) {
    const seen = new Map();
    byChapter.set(
      slug,
      sections.map((s, position) => {
        const n = (seen.get(s.title) ?? 0) + 1;
        seen.set(s.title, n);
        return { id: s.id, key: `${s.title}\u0000${n}`, position };
      })
    );
  }
  return byChapter;
}

// old section id -> { id: new section id, how: "title" | "place" | "chapter" | "book" }
export function matchSections(oldChapters, newChapters) {
  const before = index(oldChapters);
  const after = index(newChapters);
  const firstOfBook = newChapters.find((c) => c.sections.length)?.sections[0]?.id ?? null;
  const matches = new Map();
  for (const [slug, sections] of before) {
    const now = after.get(slug) ?? [];
    const byKey = new Map(now.map((s) => [s.key, s.id]));
    for (const s of sections) {
      if (byKey.has(s.key)) matches.set(s.id, { id: byKey.get(s.key), how: "title" });
      else if (now[s.position] && now.length === sections.length) matches.set(s.id, { id: now[s.position].id, how: "place" });
      else if (now[0]) matches.set(s.id, { id: now[0].id, how: "chapter" });
      else if (firstOfBook) matches.set(s.id, { id: firstOfBook, how: "book" });
    }
  }
  return matches;
}

// Everything to carry over, read before the old chapters are deleted.
export async function snapshot(client, bookId) {
  const { rows: chapters } = await client.query("select id, slug from chapters where book_id = $1 order by sort_order", [bookId]);
  const { rows: sections } = await client.query(
    `select s.id, s.chapter_id, s.parent_id, s.title, s.sort_order, s.status, s.draft_markdown
       from sections s join chapters c on c.id = s.chapter_id where c.book_id = $1`,
    [bookId]
  );
  const ids = sections.map((s) => s.id);
  const { rows: annotations } = await client.query("select * from annotations where section_id = any($1)", [ids]);
  const { rows: revisions } = await client.query("select * from revisions where section_id = any($1)", [ids]);
  const { rows: reading } = await client.query("select user_id, section_id from reading where book_id = $1 and section_id is not null", [bookId]);
  return {
    chapters: chapters.map((c) => ({ slug: c.slug, sections: readingOrder(sections.filter((s) => s.chapter_id === c.id)) })),
    sectionState: new Map(sections.map((s) => [s.id, { status: s.status, draft: s.draft_markdown }])),
    annotations,
    revisions,
    reading,
  };
}

// Moves the snapshot onto the new sections. Returns counts for the report.
export async function restore(client, bookId, saved, newChapters) {
  const matches = matchSections(saved.chapters, newChapters);
  const report = { annotations: tally(), revisions: tally(), reading: tally(), lost: 0, editorial: 0 };

  for (const [oldId, state] of saved.sectionState) {
    const m = matches.get(oldId);
    if (!m || (m.how !== "title" && m.how !== "place")) continue;
    await client.query("update sections set status = $2, draft_markdown = $3 where id = $1", [m.id, state.status, state.draft]);
    report.editorial++;
  }
  for (const a of saved.annotations) {
    const m = matches.get(a.section_id);
    if (!m) { report.lost++; continue; }
    await client.query(
      "insert into annotations (id, user_id, section_id, kind, quote, note, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      [a.id, a.user_id, m.id, a.kind, a.quote, a.note, a.created_at]
    );
    report.annotations[m.how]++;
  }
  for (const r of saved.revisions) {
    const m = matches.get(r.section_id);
    if (!m) { report.lost++; continue; }
    await client.query(
      "insert into revisions (id, section_id, user_id, title, blocks, markdown, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      [r.id, m.id, r.user_id, r.title, r.blocks, r.markdown, r.created_at]
    );
    report.revisions[m.how]++;
  }
  for (const r of saved.reading) {
    const m = matches.get(r.section_id);
    if (!m) continue;
    await client.query("update reading set section_id = $3 where user_id = $1 and book_id = $2", [r.user_id, bookId, m.id]);
    report.reading[m.how]++;
  }
  return report;
}

export function describeReport(report) {
  const part = (name, t) => {
    const total = t.title + t.place + t.chapter + t.book;
    if (!total) return null;
    const rough = t.chapter + t.book;
    return `${total} ${name}${rough ? ` (${rough} moved to the chapter's or book's start: their section is gone)` : ""}`;
  };
  const parts = [part("annotations", report.annotations), part("revisions", report.revisions), part("reading positions", report.reading)].filter(Boolean);
  return [
    `Kept: ${parts.length ? parts.join(", ") : "no reader data to move"}; editorial state of ${report.editorial} sections.`,
    report.lost ? `Could not place ${report.lost} items (the book has no sections now).` : null,
  ].filter(Boolean).join("\n");
}
