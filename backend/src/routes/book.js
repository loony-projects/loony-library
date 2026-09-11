import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { pool, resolveBookId } from "../db.js";
import { slugify } from "../slugify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = path.resolve(__dirname, "..", "..", "data", "covers");

// Kept in memory rather than written straight to disk: the cover's final
// filename is derived from the book's (uniquified) slug, which isn't known
// until the route handler runs - multer's own storage callbacks fire before
// that, while the multipart stream is still being parsed.
const uploadCover = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Cover must be an image"));
    cb(null, true);
  },
});

export const router = Router();

router.get("/books", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select b.id, b.slug, b.title, b.author, b.published_year, b.cover_image,
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

// Creates a new book, optionally with cover art and/or an opening batch of
// chapters (see POST /books/:slug/chapters below, called separately by the
// frontend's creation wizard for each one) - a book with zero chapters is
// still a valid, navigable (if empty) state, same as one whose last chapter
// was just deleted. multipart/form-data rather than JSON, since a cover
// image may be attached. The slug is derived from the title and uniquified
// automatically (title-2, title-3, ...) rather than asked for, matching how
// chapter/section titles don't require the user to think about slugs either.
router.post("/books", uploadCover.single("cover"), async (req, res, next) => {
  const { title, author, publisher, isbn, edition, price } = req.body;
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title (string) is required" });
  }

  let publishedYear = null;
  if (req.body.published_year) {
    publishedYear = parseInt(req.body.published_year, 10);
    if (Number.isNaN(publishedYear)) {
      return res.status(400).json({ error: "published_year must be a number" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const baseSlug = slugify(title);
    const { rows: clashes } = await client.query("select slug from books where slug = $1 or slug like $2", [
      baseSlug,
      `${baseSlug}-%`,
    ]);
    const taken = new Set(clashes.map((r) => r.slug));
    let slug = baseSlug;
    for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`;

    let coverImage = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      coverImage = `${slug}${ext}`;
      fs.mkdirSync(COVERS_DIR, { recursive: true });
      fs.writeFileSync(path.join(COVERS_DIR, coverImage), req.file.buffer);
    }

    const {
      rows: [book],
    } = await client.query(
      `insert into books (slug, title, author, publisher, isbn, edition, price, published_year, cover_image)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        slug,
        title,
        author || null,
        publisher || null,
        isbn || null,
        edition || null,
        price || null,
        publishedYear,
        coverImage,
      ]
    );

    await client.query("commit");
    res.status(201).json({ book });
  } catch (err) {
    await client.query("rollback");
    next(err);
  } finally {
    client.release();
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

// Deletes a chapter and everything in it - cascades to its sections
// (recursively, through their own parent_id self-reference), content_blocks,
// figures, and tables via the schema's ON DELETE CASCADE chain.
router.delete("/chapters/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("delete from chapters where id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Chapter not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
