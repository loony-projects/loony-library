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

// Replaces a section's content_blocks wholesale from markdown. Every heading
// in the submitted text becomes a `subheading` block, same as unnumbered
// headings during migration (see migration/src/buildOutlineByNumbering.js) -
// writing a section's text never restructures the book's section tree.
// Shared by the create and update routes below; must run inside a
// transaction the caller controls (it doesn't begin/commit itself).
async function replaceContentBlocks(client, sectionId, markdown) {
  const items = parseMarkdown(markdown);

  await client.query("delete from content_blocks where section_id = $1", [sectionId]);

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
      [sectionId, blockType, sortOrder++, content]
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
}

// Creates a new section - either a top-level section of a chapter
// (parent_id omitted) or a subsection nested under an existing one
// (parent_id given). depth and sort_order are derived, not caller-supplied:
// depth follows the parent's (or 1 for top-level), and sort_order appends
// after the last existing sibling under the same chapter_id + parent_id.
router.post("/sections", async (req, res, next) => {
  const { chapter_id, parent_id, title, markdown } = req.body;
  if (!chapter_id) return res.status(400).json({ error: "chapter_id is required" });
  if (!title || typeof title !== "string") return res.status(400).json({ error: "title (string) is required" });

  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: chapterRows } = await client.query("select id from chapters where id = $1", [chapter_id]);
    if (!chapterRows[0]) {
      await client.query("rollback");
      return res.status(404).json({ error: "Chapter not found" });
    }

    let depth = 1;
    if (parent_id) {
      const { rows: parentRows } = await client.query("select depth from sections where id = $1", [parent_id]);
      if (!parentRows[0]) {
        await client.query("rollback");
        return res.status(404).json({ error: "Parent section not found" });
      }
      depth = parentRows[0].depth + 1;
    }

    const {
      rows: [{ next_order }],
    } = await client.query(
      `select coalesce(max(sort_order), -1) + 1 as next_order from sections
       where chapter_id = $1 and parent_id is not distinct from $2`,
      [chapter_id, parent_id ?? null]
    );

    const {
      rows: [section],
    } = await client.query(
      `insert into sections (chapter_id, parent_id, numbering, title, depth, sort_order)
       values ($1,$2,null,$3,$4,$5) returning *`,
      [chapter_id, parent_id ?? null, title, depth, next_order]
    );

    if (typeof markdown === "string" && markdown.trim()) {
      await replaceContentBlocks(client, section.id, markdown);
    }

    await client.query("commit");
    res.status(201).json({ section });
  } catch (err) {
    await client.query("rollback");
    next(err);
  } finally {
    client.release();
  }
});

router.put("/sections/:id", async (req, res, next) => {
  const { id } = req.params;
  const { markdown } = req.body;
  if (typeof markdown !== "string") {
    return res.status(400).json({ error: "markdown (string) is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows } = await client.query("select id from sections where id = $1 for update", [id]);
    if (!rows[0]) {
      await client.query("rollback");
      return res.status(404).json({ error: "Section not found" });
    }

    await replaceContentBlocks(client, id, markdown);

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

// Deletes a section and everything under it - child sections cascade
// recursively (parent_id references sections(id) on delete cascade), and
// their content_blocks/figures/tables cascade in turn.
router.delete("/sections/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("delete from sections where id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Section not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
