import { Router } from "express";
import { pool, resolveBookId } from "../db.js";
import { slugify } from "../slugify.js";

export const router = Router();

router.get("/books", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select b.id, b.slug, b.title, b.author, b.published_year,
              count(c.id) filter (where c.number is not null)::int as chapter_count
       from books b
       left join chapters c on c.book_id = b.id
       group by b.id
       order by b.title`
    );
    res.json({ books: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/books/:slug", resolveBookId, async (req, res, next) => {
  try {
    const { rows } = await pool.query("select * from books where id = $1", [req.bookId]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get("/books/:slug/toc", resolveBookId, async (req, res, next) => {
  try {
    const { rows: chapters } = await pool.query(
      `select id, number, slug, title, sort_order
       from chapters where book_id = $1 order by sort_order`,
      [req.bookId]
    );

    const { rows: sections } = await pool.query(
      `select s.id, s.chapter_id, s.parent_id, s.numbering, s.title, s.depth, s.sort_order
       from sections s
       join chapters c on c.id = s.chapter_id
       where c.book_id = $1
       order by s.sort_order`,
      [req.bookId]
    );

    const byId = new Map();
    for (const s of sections) byId.set(s.id, { ...s, children: [] });

    const byChapter = new Map(chapters.map((c) => [c.id, { ...c, sections: [] }]));
    for (const s of sections) {
      const node = byId.get(s.id);
      if (s.parent_id && byId.has(s.parent_id)) {
        byId.get(s.parent_id).children.push(node);
      } else {
        byChapter.get(s.chapter_id)?.sections.push(node);
      }
    }

    res.json({ chapters: [...byChapter.values()] });
  } catch (err) {
    next(err);
  }
});

// Creates a new chapter, appended after the book's existing chapters, along
// with one empty top-level section titled after the chapter - every chapter
// needs at least one section to be navigable/editable, mirroring how the
// migration tool always gives a chapter its first section up front.
router.post("/books/:slug/chapters", resolveBookId, async (req, res, next) => {
  const { title, number } = req.body;
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title (string) is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const {
      rows: [{ next_order }],
    } = await client.query(
      "select coalesce(max(sort_order), -1) + 1 as next_order from chapters where book_id = $1",
      [req.bookId]
    );

    const {
      rows: [chapter],
    } = await client.query(
      `insert into chapters (book_id, number, slug, title, sort_order)
       values ($1,$2,$3,$4,$5) returning *`,
      [req.bookId, number || null, slugify(title), title, next_order]
    );

    const {
      rows: [section],
    } = await client.query(
      `insert into sections (chapter_id, parent_id, numbering, title, depth, sort_order)
       values ($1, null, null, $2, 1, 0) returning *`,
      [chapter.id, title]
    );

    await client.query("commit");
    res.status(201).json({ chapter, section });
  } catch (err) {
    await client.query("rollback");
    next(err);
  } finally {
    client.release();
  }
});
