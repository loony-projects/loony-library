import { Router } from "express";
import { pool, resolveBookId } from "../db.js";

export const router = Router();

router.get("/books", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "select id, slug, title, author, published_year from books order by title"
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
