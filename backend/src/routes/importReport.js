import path from "node:path";
import { Router } from "express";
import { pool, resolveBookId } from "../db.js";
import { editor } from "../auth.js";

// Editors' "Import health" for a book: what book-import found the last time
// it loaded it (import_reports), each issue linked to the section its page
// belongs to, plus sections that ended up with no content.
export const router = Router();

router.get("/books/:slug/import-report", editor, resolveBookId, async (req, res, next) => {
  try {
    const {
      rows: [report],
    } = await pool.query(
      "select loaded_at, mode, source_dir, stats, diagnostics, missing_images, reader_data from import_reports where book_id = $1",
      [req.bookId],
    );
    const { rows: sections } = await pool.query(
      `select s.id, s.title, s.numbering, s.source_file, s.depth, c.title as chapter_title, c.number as chapter_number,
              c.sort_order as chapter_order, s.sort_order,
              not exists (select 1 from content_blocks cb where cb.section_id = s.id) as empty,
              exists (select 1 from sections ch where ch.parent_id = s.id) as has_children
       from sections s join chapters c on c.id = s.chapter_id
       where c.book_id = $1
       order by c.sort_order, s.sort_order`,
      [req.bookId],
    );

    // A page file belongs to the section that starts with it, else to the
    // section whose folder it's in (a section folder holds its pages).
    const byFile = new Map();
    const byFolder = new Map();
    for (const s of sections) {
      if (!s.source_file) continue;
      if (!byFile.has(s.source_file)) byFile.set(s.source_file, s);
      const folder = path.posix.dirname(s.source_file);
      if (!byFolder.has(folder)) byFolder.set(folder, s);
    }
    const sectionOf = (file) => {
      if (!file) return null;
      const s = byFile.get(file) ?? byFolder.get(path.posix.dirname(file));
      return s ? { id: s.id, title: s.title, chapter: s.chapter_title } : null;
    };

    res.json({
      report: report
        ? {
            loadedAt: report.loaded_at,
            mode: report.mode,
            sourceDir: report.source_dir,
            stats: report.stats,
            readerData: report.reader_data,
          }
        : null,
      issues: (report?.diagnostics ?? []).map((d) => ({ ...d, section: sectionOf(d.file) })),
      missingImages: (report?.missing_images ?? []).map((m) => ({ ...m, section: sectionOf(m.file) })),
      emptySections: sections
        .filter((s) => s.empty && !s.has_children)
        .map((s) => ({ id: s.id, title: s.title, numbering: s.numbering, chapter: s.chapter_title })),
    });
  } catch (err) {
    next(err);
  }
});
