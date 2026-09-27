import { Router } from "express";
import { pool } from "../db.js";
import { slugify } from "../slugify.js";

export const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function uniqueSlug(client, name) {
  const base = slugify(name);
  const { rows } = await client.query(
    "select slug from categories where slug = $1 or slug like $2",
    [base, `${base}-%`],
  );
  const taken = new Set(rows.map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

router.get("/categories", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select c.*, (select count(*)::int from books b where b.category_id = c.id) as book_count
     from categories c order by c.name`,
  );
  const byId = new Map(rows.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).children.push(c);
    else roots.push(c);
  }
  res.json({ categories: roots });
}));

// A top-level category has parent_id: null; a subcategory names one. Books
// are only ever placed on a subcategory (see PATCH /books/:slug and POST
// /books) - the top level exists purely to group subcategories for browsing.
router.post("/categories", wrap(async (req, res) => {
  const { name, parent_id = null } = req.body;
  if (typeof name !== "string" || !name.trim()) throw fail("name is required");
  if (parent_id != null) {
    const { rows } = await pool.query("select id from categories where id = $1", [parent_id]);
    if (!rows.length) throw fail("Unknown parent category", 404);
  }
  const client = await pool.connect();
  try {
    const slug = await uniqueSlug(client, name.trim());
    const { rows } = await client.query(
      "insert into categories (slug, name, parent_id) values ($1,$2,$3) returning *",
      [slug, name.trim(), parent_id],
    );
    res.status(201).json(rows[0]);
  } finally {
    client.release();
  }
}));

router.patch("/categories/:id", wrap(async (req, res) => {
  const { name } = req.body;
  if (typeof name !== "string" || !name.trim()) throw fail("name is required");
  const { rows } = await pool.query(
    "update categories set name = $2 where id = $1 returning *",
    [req.params.id, name.trim()],
  );
  if (!rows.length) throw fail("Category not found", 404);
  res.json(rows[0]);
}));

// Refuses rather than cascades: a category with subcategories or assigned
// books needs those reassigned first, so deleting one never silently
// orphans a book's placement or wipes out a whole subtree by accident.
router.delete("/categories/:id", wrap(async (req, res) => {
  const { rows: children } = await pool.query("select 1 from categories where parent_id = $1", [req.params.id]);
  if (children.length) throw fail("Delete its subcategories first");
  const { rows: books } = await pool.query("select 1 from books where category_id = $1", [req.params.id]);
  if (books.length) throw fail("Reassign its books first");
  const { rowCount } = await pool.query("delete from categories where id = $1", [req.params.id]);
  if (!rowCount) throw fail("Category not found", 404);
  res.status(204).end();
}));
