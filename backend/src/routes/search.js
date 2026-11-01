import { publishedSQL } from "../features.js";
import { Router } from "express";
import { pool, resolveBookId } from "../db.js";
import { HEADLINE_OPTIONS, markedSnippet } from "../searchSnippet.js";

export const router = Router();

router.get("/books/:slug/search", resolveBookId, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 200);
    if (!q) return res.json({ results: [] });

    // One result per section - its best-matching block - best first.
    // websearch_to_tsquery: "quoted phrases", or, -excluded words.
    const { rows } = await pool.query(
      `with hits as (
         select distinct on (s.id) s.id as section_id, s.numbering, s.title,
                c.slug as chapter_slug, c.title as chapter_title,
                cb.content->>'text' as text, query,
                -- contents and index pages mention everything: rank them last
                ts_rank(cb.tsv, query) * case when s.role in ('toc', 'index') then 0.1 else 1 end as rank
         from content_blocks cb
         join sections s on s.id = cb.section_id
         join chapters c on c.id = s.chapter_id
         join books b on b.id = c.book_id
         cross join websearch_to_tsquery('english', $1) query
         where cb.tsv @@ query and c.book_id = $2 and (${publishedSQL} or $3)
         order by s.id, rank desc
       )
       select section_id, numbering, title, chapter_slug, chapter_title, rank,
              ts_headline('english', coalesce(text, ''), query, $4) as snippet
       from hits
       order by rank desc
       limit 20`,
      [q, req.bookId, req.user?.role === "editor", HEADLINE_OPTIONS],
    );
    for (const row of rows) row.snippet = markedSnippet(row.snippet);

    res.json({ results: rows });
  } catch (err) {
    next(err);
  }
});
