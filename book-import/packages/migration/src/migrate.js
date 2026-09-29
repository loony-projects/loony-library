import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";
import { parseBookDirectory, summarize, printDiagnostics, countBySeverity } from "@loony-library/markdown-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_IMAGES_DIR = path.resolve(__dirname, "..", "..", "..", "..", "backend", "data", "images");

// Usage: migrate.js <markdown-dir> [--title T] [--slug S] [--author A]
//                   [--category <slug>] [--reset] [--allow-errors] [--out outline.json]
// <markdown-dir> defaults to UPLOAD_BOOK_PATH (see .env.example). Title and
// slug are otherwise derived from the directory (see parseBookDirectory).
function parseArgs(argv) {
  const args = { dir: null, reset: false, out: null, allowErrors: false, category: null, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") args.reset = true;
    else if (arg === "--allow-errors") args.allowErrors = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--title") args.overrides.title = argv[++i];
    else if (arg === "--slug") args.overrides.slug = argv[++i];
    else if (arg === "--author") args.overrides.author = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else args.dir = arg;
  }
  args.dir ??= process.env.UPLOAD_BOOK_PATH || null;
  if (!args.dir) throw new Error("Pass the book's Markdown directory (or set UPLOAD_BOOK_PATH in .env)");
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

    if (data.reset) {
      await client.query("delete from books where title = $1", [data.book.title]);
    }

    let categoryId = null;
    if (data.book.category) {
      const {
        rows: [category],
      } = await client.query("select id from categories where slug = $1", [data.book.category]);
      if (!category) throw new Error(`Unknown category slug: ${data.book.category}`);
      categoryId = category.id;
    }

    const {
      rows: [{ id: bookId }],
    } = await client.query(
      `insert into books (slug, title, author, publisher, isbn, edition, price, published_year, category_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        data.book.slug,
        data.book.title,
        data.book.author,
        data.book.publisher,
        data.book.isbn,
        data.book.edition,
        data.book.price,
        data.book.published_year,
        categoryId,
      ]
    );

    for (const chapter of data.chapters) {
      const {
        rows: [{ id: chapterId }],
      } = await client.query(
        `insert into chapters (book_id, number, slug, title, sort_order, role)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [bookId, chapter.number, chapter.slug, chapter.title, chapter.sort_order, chapter.role]
      );

      const insertSection = async (section, parentId) => {
        const {
          rows: [{ id: sectionId }],
        } = await client.query(
          `insert into sections (chapter_id, parent_id, numbering, title, depth, sort_order, source_file, role)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [
            chapterId,
            parentId,
            section.numbering,
            section.title,
            section.depth,
            section.sort_order,
            section.source_file,
            section.role,
          ]
        );

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

    await client.query("commit");
    console.log(`Loaded book "${data.book.title}" (id=${bookId}, slug=${data.book.slug}) into Postgres.`);
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
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  const data = parseBookDirectory(args.dir, args.overrides);
  data.book.category = args.category;
  console.log(`${data.book.title} (${data.book.slug}) from ${data.book.sourceDir} [${data.book.strategy}]`);
  console.log(summarize(data));
  printDiagnostics(data.diagnostics);
  // Warnings and info are authoring issues the outline already works
  // around; an error means the parse is known to be incomplete, so don't
  // load it unless asked.
  if (countBySeverity(data.diagnostics).error && !args.allowErrors) {
    throw new Error("Parse reported errors (listed above); fix them or pass --allow-errors to load anyway.");
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(data, null, 2));
    console.log(`Wrote ${args.out}`);
  }

  resolveAndCopyImages(data.chapters, data.book);
  await loadIntoPostgres({ ...data, reset: args.reset });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
