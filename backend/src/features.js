import { imageType } from "./imageType.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import multer from "multer";
import { pool } from "./db.js";
import { editor, signedIn } from "./auth.js";
import { replaceContentBlocks } from "./routes/sections.js";
import { blocksToMarkdown } from "../../frontend/src/markdown.js";
export const featuresRouter = Router();
const r = featuresRouter;
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export async function visibleSection(id, user, db = pool) {
  const { rows } = await db.query(
    `with recursive chain as (select s.* from sections s where id=$1 union all select s.* from sections s join chain a on a.parent_id=s.id) select bool_and(chain.status='published') and bool_and(b.status='published') as visible from chain join chapters c on c.id=chain.chapter_id join books b on b.id=c.book_id`,
    [id],
  );
  return user?.role === "editor" || rows[0]?.visible === true;
}
export const visibility = wrap(async (req, res, next) => {
  if (req.user?.role === "editor") return next();
  const slug = req.path.match(/^\/books\/([^/]+)/)?.[1];
  if (slug) {
    const { rows } = await pool.query(
      "select id from books where slug=$1 and status='published'",
      [decodeURIComponent(slug)],
    );
    if (!rows.length) return res.status(404).json({ error: "Book not found" });
  }
  const id = req.path.match(/^\/sections\/([^/]+)/)?.[1];
  if (id && !(await visibleSection(id, req.user)))
    return res.status(404).json({ error: "Section not found" });
  next();
});
// Filter draft descendants at the SQL boundary, including search and exports.
export const publishedSQL = `s.status='published' and b.status='published' and not exists (with recursive parents as (select p.id,p.parent_id,p.status from sections p where p.id=s.parent_id union all select p.id,p.parent_id,p.status from sections p join parents a on p.id=a.parent_id) select 1 from parents where status<>'published')`;
r.get(
  "/discover",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select b.*,coalesce((select jsonb_agg(a order by a.name) from authors a join book_authors ba on ba.author_id=a.id where ba.book_id=b.id),'[]') authors,(select count(*)::int from chapters where book_id=b.id) chapter_count from books b where b.status='published' or $1 order by b.title`,
      [req.user?.role === "editor"],
    );
    res.json({
      books: rows.map((b) => ({
        ...b,
        author: b.authors.length
          ? b.authors.map((a) => a.name).join(", ")
          : b.author,
      })),
    });
  }),
);
r.get(
  "/authors/:id",
  wrap(async (req, res) => {
    const { rows } = await pool.query("select * from authors where id=$1", [
      req.params.id,
    ]);
    if (!rows.length) throw fail("Author not found", 404);
    res.json(rows[0]);
  }),
);
r.put(
  "/authors/:id",
  editor,
  wrap(async (req, res) => {
    const { name, bio = "", photo_url = null } = req.body;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof bio !== "string" ||
      (photo_url && !/^https?:\/\//.test(photo_url))
    )
      throw fail("Valid name, bio and HTTP photo URL required");
    const { rows } = await pool.query(
      "update authors set name=$2,bio=$3,photo_url=$4 where id=$1 returning *",
      [req.params.id, name.trim(), bio, photo_url],
    );
    if (!rows.length) throw fail("Author not found", 404);
    res.json(rows[0]);
  }),
);
r.get(
  "/search",
  wrap(async (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 200);
    if (!q) return res.json({ results: [] });
    const { rows } = await pool.query(
      `select distinct s.id section_id,s.title,b.slug book_slug,b.title book_title,left(cb.content->>'text',240) snippet from sections s join chapters c on c.id=s.chapter_id join books b on b.id=c.book_id left join content_blocks cb on cb.section_id=s.id where (${publishedSQL} or $2) and (cb.tsv @@ plainto_tsquery('english',$1) or s.title ilike '%'||$1||'%' or cb.content::text ilike '%'||$1||'%') limit 50`,
      [q, req.user?.role === "editor"],
    );
    res.json({ results: rows });
  }),
);
r.patch(
  "/books/:slug",
  editor,
  wrap(async (req, res) => {
    const {
      title,
      author_names = [],
      language = "und",
      genres = [],
      series = null,
      volume = null,
      status = "draft",
    } = req.body;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      !Array.isArray(author_names) ||
      author_names.some((n) => typeof n !== "string" || !n.trim()) ||
      !Array.isArray(genres) ||
      genres.some((g) => typeof g !== "string") ||
      typeof language !== "string" ||
      !language.trim() ||
      !["draft", "published"].includes(status) ||
      (volume !== null &&
        (!Number.isFinite(Number(volume)) || Number(volume) <= 0))
    )
      throw fail("Invalid book metadata");
    const metadata = ["publisher", "isbn", "edition", "price"];
    for (const key of metadata)
      if (req.body[key] != null && typeof req.body[key] !== "string")
        throw fail("Invalid metadata");
    if (
      req.body.published_year != null &&
      req.body.published_year !== "" &&
      !Number.isInteger(Number(req.body.published_year))
    )
      throw fail("Invalid publication year");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "update books set title=$2,author=$3,language=$4,genres=$5,series=$6,volume=$7,status=$8 where slug=$1 returning *",
        [
          req.params.slug,
          title.trim(),
          author_names.join(", "),
          language,
          genres,
          series,
          volume,
          status,
        ],
      );
      if (!rows.length) throw fail("Book not found", 404);
      const book = rows[0];
      await client.query(
        "update books set publisher=$2,isbn=$3,edition=$4,price=$5,published_year=$6 where id=$1",
        [
          book.id,
          ...metadata.map((k) => req.body[k] ?? book[k]),
          req.body.published_year === ""
            ? null
            : (req.body.published_year ?? book.published_year),
        ],
      );
      await client.query("delete from book_authors where book_id=$1", [
        book.id,
      ]);
      for (const name of new Set(author_names.map((n) => n.trim()))) {
        const a = await client.query(
          "insert into authors(name) values($1) on conflict(name) do update set name=excluded.name returning id",
          [name],
        );
        await client.query("insert into book_authors values($1,$2)", [
          book.id,
          a.rows[0].id,
        ]);
      }
      await client.query("commit");
      res.json(book);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);
r.patch(
  "/chapters/:id",
  editor,
  wrap(async (req, res) => {
    if (typeof req.body.title !== "string" || !req.body.title.trim())
      throw fail("Title required");
    const { rows } = await pool.query(
      "update chapters set title=$2,number=$3 where id=$1 returning *",
      [req.params.id, req.body.title.trim(), req.body.number || null],
    );
    if (!rows.length) throw fail("Chapter not found", 404);
    res.json(rows[0]);
  }),
);
r.patch(
  "/sections/:id",
  editor,
  wrap(async (req, res) => {
    if (typeof req.body.title !== "string" || !req.body.title.trim())
      throw fail("Title required");
    const { rows } = await pool.query(
      "update sections set title=$2 where id=$1 returning *",
      [req.params.id, req.body.title.trim()],
    );
    if (!rows.length) throw fail("Section not found", 404);
    res.json(rows[0]);
  }),
);
r.put(
  "/reorder",
  editor,
  wrap(async (req, res) => {
    const { kind, ids } = req.body;
    if (
      !["chapters", "sections"].includes(kind) ||
      !Array.isArray(ids) ||
      !ids.length ||
      new Set(ids).size !== ids.length
    )
      throw fail("Provide ordered sibling IDs");
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`lock table ${kind} in share row exclusive mode`);
      const { rows } = await db.query(
        `select * from ${kind} where id=any($1::uuid[])`,
        [ids],
      );
      if (rows.length !== ids.length) throw fail("Unknown item");
      const first = rows[0];
      if (
        rows.some((x) =>
          kind === "chapters"
            ? x.book_id !== first.book_id
            : x.chapter_id !== first.chapter_id ||
              x.parent_id !== first.parent_id,
        )
      )
        throw fail("Only siblings can be reordered");
      const all = await db.query(
        kind === "chapters"
          ? "select id from chapters where book_id=$1"
          : "select id from sections where chapter_id=$1 and parent_id is not distinct from $2",
        kind === "chapters"
          ? [first.book_id]
          : [first.chapter_id, first.parent_id],
      );
      if (all.rows.length !== ids.length) throw fail("Include every sibling");
      await db.query(
        `update ${kind} set sort_order=-sort_order-1000000 where id=any($1::uuid[])`,
        [ids],
      );
      for (let i = 0; i < ids.length; i++)
        await db.query(`update ${kind} set sort_order=$2 where id=$1`, [
          ids[i],
          i,
        ]);
      await db.query("commit");
      res.json({ ok: true });
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }),
);
r.get(
  "/sections/:id/editor",
  editor,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "select draft_markdown,status from sections where id=$1",
      [req.params.id],
    );
    if (!rows.length) throw fail("Section not found", 404);
    res.json(rows[0]);
  }),
);
async function saveDraft(req, res) {
  if (typeof req.body.markdown !== "string") throw fail("Markdown required");
  const db = await pool.connect();
  try {
    await db.query("begin");
    const { rows } = await db.query(
      "select * from sections where id=$1 for update",
      [req.params.id],
    );
    if (!rows.length) throw fail("Section not found", 404);
    await db.query(
      "insert into revisions(section_id,user_id,title,blocks,markdown) values($1,$2,$3,'[]'::jsonb,$4)",
      [req.params.id, req.user.id, rows[0].title, req.body.markdown],
    );
    await db.query("update sections set draft_markdown=$2 where id=$1", [
      req.params.id,
      req.body.markdown,
    ]);
    await db.query("commit");
    res.json({ ok: true });
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
r.put("/sections/:id/draft", editor, wrap(saveDraft));
r.put("/sections/:id", editor, wrap(saveDraft));

async function snapshot(db, id, user) {
  await db.query(
    `insert into revisions(section_id,user_id,title,blocks) select s.id,$2,s.title,coalesce((select jsonb_agg(jsonb_build_object('block_type',block_type,'sort_order',sort_order,'content',content) order by sort_order) from content_blocks where section_id=s.id),'[]'::jsonb) from sections s where s.id=$1`,
    [id, user],
  );
}
r.post(
  "/sections/:id/publish",
  editor,
  wrap(async (req, res) => {
    const db = await pool.connect();
    try {
      await db.query("begin");
      const { rows } = await db.query(
        "select * from sections where id=$1 for update",
        [req.params.id],
      );
      if (!rows.length) throw fail("Section not found", 404);
      await snapshot(db, req.params.id, req.user.id);
      if (rows[0].draft_markdown !== null)
        await replaceContentBlocks(db, req.params.id, rows[0].draft_markdown);
      await db.query(
        "update sections set status='published',draft_markdown=null where id=$1",
        [req.params.id],
      );
      await db.query("commit");
      res.json({ ok: true });
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }),
);
r.get(
  "/sections/:id/revisions",
  editor,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "select id,title,created_at from revisions where section_id=$1 order by created_at desc limit 100",
      [req.params.id],
    );
    res.json({ revisions: rows });
  }),
);
r.post(
  "/sections/:id/restore/:revision",
  editor,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "select * from revisions where id=$1 and section_id=$2",
      [req.params.revision, req.params.id],
    );
    if (!rows.length) throw fail("Revision not found", 404);
    await pool.query("update sections set draft_markdown=$2 where id=$1", [
      req.params.id,
      rows[0].markdown ?? blocksToMarkdown(rows[0].blocks),
    ]);
    res.json({ ok: true });
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
r.post(
  "/images",
  editor,
  upload.single("image"),
  wrap(async (req, res) => {
    const b = req.file?.buffer,
      ext = imageType(b);
    if (!ext) throw fail("Upload a PNG, JPEG or WebP image");
    const dir = new URL("../data/images/", import.meta.url);
    await fs.mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await fs.writeFile(new URL(name, dir), b);
    res.status(201).json({ path: name });
  }),
);
r.use("/me", signedIn);
r.get(
  "/me",
  signedIn,
  wrap(async (req, res) => {
    const [reading, shelves, annotations] = await Promise.all([
      pool.query(
        `select r.*,b.slug,b.title,s.title section_title from reading r join books b on b.id=r.book_id join sections s on s.id=r.section_id where user_id=$1 and ${publishedSQL} order by updated_at desc`,
        [req.user.id],
      ),
      pool.query(
        "select sh.*,b.slug,b.title from shelves sh join books b on b.id=sh.book_id where user_id=$1 and b.status='published'",
        [req.user.id],
      ),
      pool.query(
        `select a.*,b.slug,b.title book_title from annotations a join sections s on s.id=a.section_id join chapters c on c.id=s.chapter_id join books b on b.id=c.book_id where user_id=$1 and (${publishedSQL} or $2) order by created_at desc`,
        [req.user.id, req.user.role === "editor"],
      ),
    ]);
    res.json({
      reading: reading.rows,
      shelves: shelves.rows,
      annotations: annotations.rows,
    });
  }),
);
r.put(
  "/me/progress",
  wrap(async (req, res) => {
    const id = req.body.section_id;
    if (!(await visibleSection(id, req.user)))
      throw fail("Section not found", 404);
    await pool.query(
      "insert into reading(user_id,book_id,section_id) select $1,c.book_id,s.id from sections s join chapters c on c.id=s.chapter_id where s.id=$2 on conflict(user_id,book_id) do update set section_id=excluded.section_id,updated_at=now()",
      [req.user.id, id],
    );
    res.json({ ok: true });
  }),
);
r.put(
  "/me/shelves/:book",
  wrap(async (req, res) => {
    const {
      favorite = false,
      wishlist = false,
      rating = null,
      review = "",
    } = req.body;
    if (
      typeof favorite !== "boolean" ||
      typeof wishlist !== "boolean" ||
      (rating !== null &&
        (!Number.isInteger(rating) || rating < 1 || rating > 5)) ||
      typeof review !== "string" ||
      review.length > 10000
    )
      throw fail("Invalid review");
    const b = await pool.query(
      "select id from books where id=$1 and (status='published' or $2)",
      [req.params.book, req.user.role === "editor"],
    );
    if (!b.rows.length) throw fail("Book not found", 404);
    await pool.query(
      "insert into shelves values($1,$2,$3,$4,$5,$6) on conflict(user_id,book_id) do update set favorite=excluded.favorite,wishlist=excluded.wishlist,rating=excluded.rating,review=excluded.review",
      [req.user.id, req.params.book, favorite, wishlist, rating, review],
    );
    res.json({ ok: true });
  }),
);
r.post(
  "/me/annotations",
  wrap(async (req, res) => {
    const { section_id, kind, quote = "", note = "" } = req.body;
    if (
      !["bookmark", "highlight", "note"].includes(kind) ||
      typeof quote !== "string" ||
      typeof note !== "string" ||
      quote.length > 10000 ||
      note.length > 10000
    )
      throw fail("Invalid annotation");
    if (!(await visibleSection(section_id, req.user)))
      throw fail("Section not found", 404);
    const { rows } = await pool.query(
      "insert into annotations(user_id,section_id,kind,quote,note) values($1,$2,$3,$4,$5) returning *",
      [req.user.id, section_id, kind, quote, note],
    );
    res.status(201).json(rows[0]);
  }),
);
r.delete(
  "/me/annotations/:id",
  wrap(async (req, res) => {
    await pool.query("delete from annotations where id=$1 and user_id=$2", [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  }),
);
r.get(
  "/books/:slug/reviews",
  visibility,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "select u.name,s.rating,s.review from shelves s join users u on u.id=s.user_id join books b on b.id=s.book_id where b.slug=$1 and (s.rating is not null or s.review<>'')",
      [req.params.slug],
    );
    res.json({ reviews: rows });
  }),
);

r.get(
  "/books/:slug/export",
  visibility,
  wrap(async (req, res) => {
    const { rows } = await pool.query("select * from books where slug=$1", [
      req.params.slug,
    ]);
    const book = rows[0];
    if (!book) throw fail("Book not found", 404);
    const { rows: sections } = await pool.query(
      `with recursive outline as (select s.id,array[c.sort_order,s.sort_order] ordering from sections s join chapters c on c.id=s.chapter_id where c.book_id=$1 and s.parent_id is null union all select s.id,o.ordering||s.sort_order from sections s join outline o on o.id=s.parent_id) select s.*,c.title chapter_title,coalesce((select jsonb_agg(jsonb_build_object('block_type',block_type,'content',content) order by sort_order) from content_blocks where section_id=s.id),'[]') blocks from outline o join sections s on s.id=o.id join chapters c on c.id=s.chapter_id join books b on b.id=c.book_id where ${publishedSQL} or $2 order by o.ordering`,
      [book.id, req.user?.role === "editor"],
    );
    const format = req.query.format || "md";
    if (!["md", "epub"].includes(format)) throw fail("Choose md or epub");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${book.slug.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}"`,
    );
    if (format === "epub") {
      const { epub } = await import("./epub.js");
      res.type("application/epub+zip").send(await epub(book, sections));
    } else
      res
        .type("text/markdown")
        .send(
          `# ${book.title}\n\n${book.author || ""}\n\n` +
            sections
              .map(
                (s) =>
                  `## ${s.chapter_title} — ${s.title}\n\n${blocksToMarkdown(s.blocks)}`,
              )
              .join("\n\n"),
        );
  }),
);
