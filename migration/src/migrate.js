import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";
import { buildOutlineByNumbering } from "./buildOutlineByNumbering.js";
import { buildOutlineFlatChapters } from "./buildOutlineFlatChapters.js";
import { extractTermList } from "./extractTermList.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_IMAGES_DIR = path.resolve(__dirname, "..", "..", "backend", "data", "images");

function parseArgs(argv) {
  const args = { load: false, reset: false, out: null, book: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--load") args.load = true;
    else if (argv[i] === "--reset") args.reset = true;
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--book") args.book = argv[++i];
  }
  if (!args.book) throw new Error("--book <path-to-config.json> is required");
  if (!args.load && !args.out) args.out = "outline.json";
  return args;
}

function loadBookConfig(bookPath) {
  const config = JSON.parse(fs.readFileSync(bookPath, "utf8"));
  if (!config.slug) throw new Error(`${bookPath}: missing "slug"`);
  if (!config.sourceDir) throw new Error(`${bookPath}: missing "sourceDir"`);
  if (!fs.existsSync(config.sourceDir)) {
    throw new Error(`${bookPath}: sourceDir does not exist: ${config.sourceDir}`);
  }
  return config;
}

function buildChapters(config) {
  if (config.strategy === "flat-chapters") {
    return buildOutlineFlatChapters(config.sourceDir, config);
  }
  if (config.strategy === "numbering") {
    return buildOutlineByNumbering(config.sourceDir);
  }
  throw new Error(`Unknown strategy "${config.strategy}"`);
}

function buildGlossaryAndSymbols(config) {
  if (!config.glossaryFile) return { glossary: [], symbols: [] };
  const glossary = extractTermList(fs.readFileSync(path.join(config.sourceDir, config.glossaryFile), "utf8"));
  const symbols = config.symbolsFile
    ? extractTermList(fs.readFileSync(path.join(config.sourceDir, config.symbolsFile), "utf8")).map((entry) => ({
        symbol: entry.term,
        description: entry.expansion,
      }))
    : [];
  return { glossary, symbols };
}

function buildEverything(config) {
  const chapters = buildChapters(config);
  const { glossary, symbols } = buildGlossaryAndSymbols(config);
  return { book: config, chapters, glossary, symbols };
}

function countBlocks(chapters) {
  let sections = 0;
  let blocks = 0;
  const walk = (nodes) => {
    for (const s of nodes) {
      sections++;
      blocks += s.blocks.length;
      walk(s.children);
    }
  };
  chapters.forEach((c) => walk(c.sections));
  return { sections, blocks };
}

// This book's raw markdown references images inconsistently (missing
// "images/" prefix, wrong extension vs. the file Marker actually wrote) -
// resolve each image block against what's really in <sourceDir>/images
// rather than trusting the literal src, then copy it into a book-namespaced
// folder under the backend's static image root so two books' identically-
// named page images (`_page_0_Picture_10.*`) don't collide.
function resolveAndCopyImages(chapters, config) {
  const sourceImagesDir = path.join(config.sourceDir, "images");
  if (!fs.existsSync(sourceImagesDir)) return;

  const byBasename = new Map();
  for (const f of fs.readdirSync(sourceImagesDir)) {
    byBasename.set(f.replace(/\.[^.]+$/, "").toLowerCase(), f);
  }

  const destDir = path.join(BACKEND_IMAGES_DIR, config.slug);
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
        block.content.src = `${config.slug}/${real}`;
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

    const {
      rows: [{ id: bookId }],
    } = await client.query(
      `insert into books (slug, title, author, publisher, isbn, edition, price, published_year)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        data.book.slug,
        data.book.title,
        data.book.author,
        data.book.publisher,
        data.book.isbn,
        data.book.edition,
        data.book.price,
        data.book.published_year,
      ]
    );

    for (const chapter of data.chapters) {
      const {
        rows: [{ id: chapterId }],
      } = await client.query(
        `insert into chapters (book_id, number, slug, title, sort_order)
         values ($1,$2,$3,$4,$5) returning id`,
        [bookId, chapter.number, chapter.slug, chapter.title, chapter.sort_order]
      );

      const insertSection = async (section, parentId) => {
        const {
          rows: [{ id: sectionId }],
        } = await client.query(
          `insert into sections (chapter_id, parent_id, numbering, title, depth, sort_order, source_file)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [
            chapterId,
            parentId,
            section.numbering,
            section.title,
            section.depth,
            section.sort_order,
            section.source_file,
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
  const config = loadBookConfig(args.book);
  const data = buildEverything(config);
  const { sections, blocks } = countBlocks(data.chapters);
  console.log(
    `Parsed ${data.chapters.length} chapters, ${sections} sections, ${blocks} content blocks, ` +
      `${data.glossary.length} glossary terms, ${data.symbols.length} symbols.`
  );

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(data, null, 2));
    console.log(`Wrote ${args.out}`);
  }

  if (args.load) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set (see .env.example)");
    }
    resolveAndCopyImages(data.chapters, config);
    await loadIntoPostgres({ ...data, reset: args.reset });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
