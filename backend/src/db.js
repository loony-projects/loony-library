import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Looked up on every request (slug is uniquely indexed): a book reloaded by
// book-import gets a new id, and an editor can rename a slug, so a cached id
// would go stale until a restart. Throws on an unknown slug so routes can
// turn it into a 404.
export async function getBookIdBySlug(slug) {
  const { rows } = await pool.query("select id from books where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`No book with slug "${slug}"`);
  return rows[0].id;
}

// Express middleware: resolves req.params.slug to req.bookId, or responds
// 404 if it doesn't match a loaded book. Used by every book-scoped route.
export async function resolveBookId(req, res, next) {
  try {
    req.bookId = await getBookIdBySlug(req.params.slug);
    next();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}
