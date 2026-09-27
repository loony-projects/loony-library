import { publishedSQL } from "../features.js";
import { Router } from "express";
import { pool, resolveBookId } from "../db.js";

export const router = Router();

router.get("/books/:slug/search", resolveBookId, async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    const { rows } = await pool.query(
      `select s.id as section_id, s.numbering, s.title,
              c.slug as chapter_slug, c.title as chapter_title,
              ts_headline('english', coalesce(cb.content->>'text', ''), query,
                'MaxFragments=1,MaxWords=25,MinWords=8,StartSel=<mark>,StopSel=</mark>') as snippet,
              ts_rank(cb.tsv, query) as rank
       from content_blocks cb
       join sections s on s.id = cb.section_id
       join chapters c on c.id = s.chapter_id
       join books b on b.id=c.book_id
       cross join plainto_tsquery('english', $1) query
       where cb.tsv @@ query and c.book_id = $2 and (${publishedSQL} or $3)
       order by rank desc
       limit 20`,
      [q, req.bookId, req.user?.role === "editor"],
    );

    res.json({ results: rows });
  } catch (err) {
    next(err);
  }
});
