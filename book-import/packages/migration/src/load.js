import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { UsageError } from "@loony-library/markdown-parser";
import { snapshot, restore, describeReport, readingOrder } from "./reload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_IMAGES_DIR = path.resolve(__dirname, "..", "..", "..", "..", "backend", "data", "images");

// Image blocks reference files inconsistently (no "images/" prefix, another
// extension than the file Marker wrote, a different folder). Each is matched
// by base name - first in <sourceDir>/images, then anywhere under the book's
// folder - and copied into a book-namespaced folder under the backend's
// static image root, so two books' identically named page images
// (`_page_0_Picture_10.*`) don't collide. Returns what was copied and every
// image that wasn't found, with the page it's on.
// dryRun: only resolve and report, copy nothing and leave the blocks as they are.
export function copyImages(chapters, book, { destRoot = BACKEND_IMAGES_DIR, dryRun = false } = {}) {
  const bookDir = /^markdown(?:[-_].*)?$/i.test(path.basename(book.sourceDir)) ? path.dirname(book.sourceDir) : book.sourceDir;
  const baseName = (f) => path.basename(f).replace(/\.[^.]+$/, "").toLowerCase();
  const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
  const found = new Map(); // base name -> absolute path; images/ first, then the rest of the book folder
  const add = (file) => found.has(baseName(file)) || found.set(baseName(file), file);
  const imagesDir = path.join(book.sourceDir, "images");
  if (fs.existsSync(imagesDir)) for (const f of fs.readdirSync(imagesDir)) if (IMAGE.test(f)) add(path.join(imagesDir, f));
  const walkFiles = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 6) walkFiles(full, depth + 1);
      else if (e.isFile() && IMAGE.test(e.name)) add(full);
    }
  };
  walkFiles(bookDir, 0);

  const destDir = path.join(destRoot, book.slug);
  const copied = new Set();
  const missing = [];
  const walk = (sections) => {
    for (const s of sections) {
      for (const block of s.blocks) {
        if (block.block_type !== "image" || /^(https?:|data:)/i.test(block.content.src ?? "")) continue;
        const real = block.content.src ? found.get(baseName(block.content.src)) : null;
        if (!real) {
          missing.push({ src: block.content.src || "(an image with no source: ![]())", file: block.position?.file ?? s.source_file ?? null, line: block.position?.start?.line ?? null });
          continue;
        }
        if (dryRun) {
          copied.add(real);
          continue;
        }
        block.content.src = `${book.slug}/${path.basename(real)}`;
        if (!copied.has(real)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(real, path.join(destDir, path.basename(real)));
          copied.add(real);
        }
      }
      walk(s.children);
    }
  };
  chapters.forEach((c) => walk(c.sections));
  return { destDir, copied: copied.size, missing };
}

export function describeImages({ destDir, copied, missing }, { limit = 20 } = {}) {
  const lines = [`Images: copied ${copied} file(s) to ${destDir}${missing.length ? `; ${missing.length} not found in the book's folder:` : "."}`];
  for (const m of missing.slice(0, limit)) lines.push(`  ${m.src}  (${[m.file, m.line].filter(Boolean).join(":") || "unknown page"})`);
  if (missing.length > limit) lines.push(`  ... and ${missing.length - limit} more`);
  return lines.join("\n");
}

export async function loadIntoPostgres(data) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("begin");

    // By slug, which is unique: titles aren't (two editions of a book).
    const {
      rows: [existing],
    } = await client.query("select id, status from books where slug = $1", [data.book.slug]);
    if (existing && data.mode === "load") {
      throw new UsageError(`"${data.book.slug}" is already loaded. Use \`npm run reload\` to update it in place (keeps readers' data), or --reset to replace it.`);
    }
    if (existing && data.mode === "reset") await client.query("delete from books where id = $1", [existing.id]);
    const inPlace = existing && data.mode === "reload";

    let categoryId = null;
    if (data.book.category) {
      const {
        rows: [category],
      } = await client.query("select id from categories where slug = $1", [data.book.category]);
      if (!category) throw new Error(`Unknown category slug: ${data.book.category}`);
      categoryId = category.id;
    }

    const fields = [
      data.book.slug,
      data.book.title,
      data.book.author,
      data.book.publisher,
      data.book.isbn,
      data.book.edition,
      data.book.price,
      data.book.published_year,
      categoryId,
      // In place, a book stays published once published.
      data.publish || (inPlace && existing.status === "published") ? "published" : "draft",
      data.book.language,
      data.book.series,
      data.book.volume,
    ];
    let bookId;
    let saved = null;
    if (inPlace) {
      bookId = existing.id;
      saved = await snapshot(client, bookId);
      // Only what the source says is replaced: a cover, series or language set
      // in the app stays unless the source gives one.
      await client.query(
        `update books set title=$2, author=coalesce($3,author), publisher=coalesce($4,publisher), isbn=coalesce($5,isbn),
           edition=coalesce($6,edition), price=coalesce($7,price), published_year=coalesce($8,published_year),
           category_id=coalesce($9,category_id), status=$10, language=coalesce($11,language), series=coalesce($12,series),
           volume=coalesce($13,volume)
         where slug=$1`,
        fields
      );
      await client.query("delete from chapters where book_id = $1", [bookId]);
      await client.query("delete from glossary_terms where book_id = $1", [bookId]);
      await client.query("delete from symbols where book_id = $1", [bookId]);
    } else {
      ({
        rows: [{ id: bookId }],
      } = await client.query(
        `insert into books (slug, title, author, publisher, isbn, edition, price, published_year, category_id, status, language, series, volume)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'und'),$12,$13) returning id`,
        fields
      ));
    }
    const newChapters = [];

    for (const chapter of data.chapters) {
      const {
        rows: [{ id: chapterId }],
      } = await client.query(
        `insert into chapters (book_id, number, slug, title, sort_order, role)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [bookId, chapter.number, chapter.slug, chapter.title, chapter.sort_order, chapter.role]
      );
      const inserted = [];

      const insertSection = async (section, parentId) => {
        const {
          rows: [{ id: sectionId }],
        } = await client.query(
          `insert into sections (chapter_id, parent_id, numbering, title, depth, sort_order, source_file, role, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [
            chapterId,
            parentId,
            section.numbering,
            section.title,
            section.depth,
            section.sort_order,
            section.source_file,
            section.role,
            fields[9], // the book's status; a reload then restores each kept section's own

          ]
        );
        inserted.push({ id: sectionId, parent_id: parentId, title: section.title, sort_order: section.sort_order });

        for (let i = 0; i < section.blocks.length; i++) {
          const block = section.blocks[i];
          const {
            rows: [{ id: blockId }],
          } = await client.query(
            `insert into content_blocks (section_id, block_type, sort_order, content)
             values ($1,$2,$3,$4) returning id`,
            [sectionId, block.block_type, i, block.content]
          );

          if (block.block_type === "image") {
            await client.query(
              `insert into figures (content_block_id, image_path, caption, alt_text)
               values ($1,$2,$3,$4)`,
              [blockId, block.content.src, block.content.caption, block.content.alt]
            );
          }

          if (block.block_type === "table") {
            await client.query(
              `insert into tables (content_block_id, headers, rows) values ($1,$2,$3)`,
              [blockId, JSON.stringify(block.content.headers), JSON.stringify(block.content.rows)]
            );
          }
        }

        for (const child of section.children) {
          await insertSection(child, sectionId);
        }
      };

      for (const section of chapter.sections) {
        await insertSection(section, null);
      }
      newChapters.push({ slug: chapter.slug, sections: readingOrder(inserted) });
    }

    for (const entry of data.glossary) {
      await client.query(
        `insert into glossary_terms (book_id, term, expansion) values ($1,$2,$3)`,
        [bookId, entry.term, entry.expansion]
      );
    }

    for (const entry of data.symbols) {
      await client.query(`insert into symbols (book_id, symbol, description) values ($1,$2,$3)`, [
        bookId,
        entry.symbol,
        entry.description,
      ]);
    }

    const report = saved ? await restore(client, bookId, saved, newChapters) : null;

    await client.query("commit");
    const status = fields[9];
    console.log(
      `${inPlace ? "Reloaded" : "Loaded"} book "${data.book.title}" (id=${bookId}, slug=${data.book.slug}) into Postgres as ` +
        (status === "published" ? "published." : "a draft - publish it in the app, or reload with --publish.")
    );
    if (report) console.log(describeReport(report));
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}

