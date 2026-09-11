import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const bookIdBySlug = new Map();

// Book ids don't change once loaded - resolve each slug once per process
// lifetime and reuse it instead of hitting the DB on every request. Throws
// on an unknown slug so routes can turn it into a 404.
export function getBookIdBySlug(slug) {
  if (!bookIdBySlug.has(slug)) {
    bookIdBySlug.set(
      slug,
      pool.query("select id from books where slug = $1", [slug]).then((r) => {
        if (!r.rows[0]) {
          bookIdBySlug.delete(slug); // don't cache a miss - the book may load later
          throw new Error(`No book with slug "${slug}"`);
        }
        return r.rows[0].id;
      })
    );
  }
  return bookIdBySlug.get(slug);
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
