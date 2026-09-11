import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

router.get("/sections/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows: sectionRows } = await pool.query(
      `select s.*, c.title as chapter_title, c.slug as chapter_slug, c.number as chapter_number
       from sections s join chapters c on c.id = s.chapter_id
       where s.id = $1`,
      [id]
    );
    const section = sectionRows[0];
    if (!section) return res.status(404).json({ error: "Section not found" });

    const { rows: breadcrumbs } = await pool.query(
      `with recursive ancestors as (
         select id, parent_id, numbering, title, 0 as lvl from sections where id = $1
         union all
         select s.id, s.parent_id, s.numbering, s.title, a.lvl + 1
         from sections s join ancestors a on s.id = a.parent_id
       )
       select id, numbering, title from ancestors order by lvl desc`,
      [id]
    );

    const { rows: children } = await pool.query(
      `select id, numbering, title, depth from sections where parent_id = $1 order by sort_order`,
      [id]
    );

    const { rows: blocks } = await pool.query(
      `select id, block_type, sort_order, content
       from content_blocks where section_id = $1 order by sort_order`,
      [id]
    );

    res.json({ section, breadcrumbs, children, blocks });
  } catch (err) {
    next(err);
  }
});
