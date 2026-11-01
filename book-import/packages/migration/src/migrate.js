import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";
import { snapshot, restore, describeReport, readingOrder } from "./reload.js";
import { parseBookDirectory, summarize, printDiagnostics, countBySeverity, renderBookMarkdown, bookDirFromEnv, UsageError } from "@loony-library/markdown-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_IMAGES_DIR = path.resolve(__dirname, "..", "..", "..", "..", "backend", "data", "images");

// Usage: migrate.js [--title T] [--slug S] [--author A] [--category <slug>]
//                   [--publish] [--reload | --reset] [--allow-errors] [--out book-output.md]
//   (none)    load a new book; stops if its slug is already loaded
//   --reload  replace an already loaded book's contents in place, keeping its
//             readers' shelves, reading positions, annotations and its
//             revisions and section publish states (see reload.js)
//   --reset   delete the book (and everything readers attached to it) and load
//             it fresh
// New books - and their sections - are drafts (hidden from readers) unless
// --publish is given.
// The book's Markdown directory is UPLOAD_BOOK_PATH in .env (see
// .env.example). Title and slug are otherwise derived from the directory
// (see parseBookDirectory).
function parseArgs(argv) {
  const args = { mode: "load", out: null, allowErrors: false, category: null, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") args.mode = "reset";
    else if (arg === "--reload") args.mode = "reload";
    else if (arg === "--allow-errors") args.allowErrors = true;
    else if (arg === "--publish") args.publish = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--title") args.overrides.title = argv[++i];
    else if (arg === "--slug") args.overrides.slug = argv[++i];
    else if (arg === "--author") args.overrides.author = argv[++i];
    else if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
    else throw new UsageError(`Unexpected argument "${arg}". Set the book's Markdown directory as UPLOAD_BOOK_PATH in .env instead.`);
  }
  return args;
}

// This book's raw markdown references images inconsistently (missing
// "images/" prefix, wrong extension vs. the file Marker actually wrote) -
// resolve each image block against what's really in <sourceDir>/images
// rather than trusting the literal src, then copy it into a book-namespaced
// folder under the backend's static image root so two books' identically-
// named page images (`_page_0_Picture_10.*`) don't collide.
function resolveAndCopyImages(chapters, book) {
  const sourceImagesDir = path.join(book.sourceDir, "images");
  if (!fs.existsSync(sourceImagesDir)) return;

  const byBasename = new Map();
  for (const f of fs.readdirSync(sourceImagesDir)) {
    byBasename.set(f.replace(/\.[^.]+$/, "").toLowerCase(), f);
  }

  const destDir = path.join(BACKEND_IMAGES_DIR, book.slug);
  fs.mkdirSync(destDir, { recursive: true });
  const copied = new Set();
  let missing = 0;

  const walk = (nodes) => {
    for (const s of nodes) {
      for (const block of s.blocks) {
        if (block.block_type !== "image") continue;
        const base = path.basename(block.content.src).replace(/\.[^.]+$/, "").toLowerCase();
        const real = byBasename.get(base);
        if (!real) {
          missing++;
          continue;
        }
        block.content.src = `${book.slug}/${real}`;
        if (!copied.has(real)) {
          fs.copyFileSync(path.join(sourceImagesDir, real), path.join(destDir, real));
          copied.add(real);
        }
      }
      walk(s.children);
    }
  };
  chapters.forEach((c) => walk(c.sections));

  console.log(`Images: copied ${copied.size} file(s) to ${destDir}${missing ? `, ${missing} unresolved` : ""}.`);
}

async function loadIntoPostgres(data) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new UsageError("DATABASE_URL is not set in book-import/.env (see .env.example)");
  }
  const data = parseBookDirectory(bookDirFromEnv(), args.overrides);
  // Flags win over the book's book.json.
  data.book.category = args.category ?? data.book.category;
  const publish = args.publish || data.book.publish === true;
  console.log(`${data.book.title} (${data.book.slug}) from ${data.book.sourceDir}`);
  console.log(summarize(data));
  printDiagnostics(data.diagnostics);
  // Warnings and info are authoring issues the outline already works
  // around; an error means the parse is known to be incomplete, so don't
  // load it unless asked.
  if (countBySeverity(data.diagnostics).error && !args.allowErrors) {
    throw new UsageError("Parse reported errors (listed above); fix them or pass --allow-errors to load anyway.");
  }

  if (args.out) {
    fs.writeFileSync(args.out, renderBookMarkdown(data));
    console.log(`Wrote ${args.out}`);
  }

  resolveAndCopyImages(data.chapters, data.book);
  await loadIntoPostgres({ ...data, mode: args.mode, publish });
}

main().catch((err) => {
  console.error(err instanceof UsageError ? `Error: ${err.message}` : err);
  process.exit(1);
});
