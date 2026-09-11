import { Router } from "express";
import { pool } from "../db.js";
import { parseMarkdown } from "../parseMarkdown.js";

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

// Replaces a section's content_blocks wholesale from edited markdown. Every
// heading in the submitted text becomes a `subheading` block, same as
// unnumbered headings during migration (see migration/src/buildOutlineByNumbering.js)
// - editing a section's text doesn't restructure the book's section tree.
router.put("/sections/:id", async (req, res, next) => {
  const { id } = req.params;
  const { markdown } = req.body;
  if (typeof markdown !== "string") {
    return res.status(400).json({ error: "markdown (string) is required" });
  }

  const items = parseMarkdown(markdown);

  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows } = await client.query("select id from sections where id = $1 for update", [id]);
    if (!rows[0]) {
      await client.query("rollback");
      return res.status(404).json({ error: "Section not found" });
    }

    await client.query("delete from content_blocks where section_id = $1", [id]);

    let sortOrder = 0;
    for (const item of items) {
      const blockType = item.kind === "heading" ? "subheading" : item.block_type;
      const content =
        item.kind === "heading"
          ? { text: item.numbering ? `${item.numbering}. ${item.title}` : item.title }
          : item.content;

      const {
        rows: [{ id: blockId }],
      } = await client.query(
        `insert into content_blocks (section_id, block_type, sort_order, content)
         values ($1,$2,$3,$4) returning id`,
        [id, blockType, sortOrder++, content]
      );

      if (blockType === "image") {
        await client.query(
          `insert into figures (content_block_id, image_path, caption, alt_text) values ($1,$2,$3,$4)`,
          [blockId, content.src, content.caption, content.alt]
        );
      }

      if (blockType === "table") {
        await client.query(`insert into tables (content_block_id, headers, rows) values ($1,$2,$3)`, [
          blockId,
          JSON.stringify(content.headers),
          JSON.stringify(content.rows),
        ]);
      }
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    return next(err);
  } finally {
    client.release();
  }

  const { rows: blocks } = await pool.query(
    `select id, block_type, sort_order, content from content_blocks where section_id = $1 order by sort_order`,
    [id]
  );
  res.json({ blocks });
});
