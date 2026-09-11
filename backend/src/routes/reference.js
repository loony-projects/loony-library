import { Router } from "express";
import { pool, resolveBookId } from "../db.js";

export const router = Router();

router.get("/books/:slug/glossary", resolveBookId, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "select term, expansion from glossary_terms where book_id = $1 order by term",
      [req.bookId]
    );
    res.json({ terms: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/books/:slug/symbols", resolveBookId, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "select symbol, description from symbols where book_id = $1 order by symbol",
      [req.bookId]
    );
    res.json({ symbols: rows });
  } catch (err) {
    next(err);
  }
});
