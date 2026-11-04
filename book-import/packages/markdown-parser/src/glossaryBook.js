// Glossary books ("glossary": true in book.json): dictionaries of English
// terms with Bodo meanings (and sometimes a Hindi column), in letter
// folders. Their pages came out of the PDF in three shapes:
//
//   | English | Bodo |           a proper table
//   | species | spontaneous... | a table whose header is the printed page's
//                                guide words (or, when its second cell is
//                                Devanagari, really the first entry)
//   slab / दाब्ले, गोबा / ...      paragraphs alternating term and meaning
//
// Tables get a real header and alternating paragraphs become tables: the
// script says which meaning belongs to which term, including a meaning
// wrapped over several lines. A page where that isn't certain - a column
// dump (all the English, then all the Bodo), two terms in a row - stays as
// printed and is reported: pairing it by position could print a wrong
// translation. Returns the book's term entries.

const DEVANAGARI = /\p{Script=Devanagari}/u;
const LATIN = /[A-Za-z]/;

const isTerm = (text) => LATIN.test(text) && !DEVANAGARI.test(text) && !text.includes("\n");
const isMeaning = (text) => DEVANAGARI.test(text);
// A meaning starting "1. ..." parsed as a list: its source keeps the number.
const textOf = (block) => ((block.block_type === "list" ? block.content.markdown : block.content.text) ?? "").trim();
const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

function tableBlock(columns, rows, position) {
  const line = (cells) => `| ${cells.map(cell).join(" | ")} |`;
  const markdown = [line(columns), line(columns.map(() => "---")), ...rows.map(line)].join("\n");
  return {
    kind: "block",
    block_type: "table",
    content: { headers: columns, rows, markdown, text: [columns, ...rows].map((r) => r.join(" ")).join("\n") },
    position,
  };
}

const HEADER_WORDS = new Set(["english", "hindi", "bodo", "अंग्रेजी", "हिंदी", "बोड़ो"]);
const columnsFor = (n) => (n === 3 ? ["English", "Hindi", "Bodo"] : ["English", "Bodo"]);

// A table with a real header, or null when its shape isn't a term table.
function normalizeTable(block, diagnostics) {
  const { headers, rows } = block.content;
  const n = headers.length;
  if ((n !== 2 && n !== 3) || rows.some((r) => r.length !== n)) {
    diagnostics.warning("glossary.odd_table", `A table with ${n} columns or uneven rows was left as printed; its terms aren't in the term list.`, { position: block.position });
    return null;
  }
  const isHeader = headers.every((h) => HEADER_WORDS.has(h.trim().toLowerCase()));
  // Not a header row: an entry (its meaning is Devanagari), else guide words.
  const entry = !isHeader && isMeaning(headers[n - 1]);
  return tableBlock(columnsFor(n), entry ? [headers, ...rows] : rows, block.position);
}

// Consecutive paragraphs of one page: [{ term, meanings: [] }] if they
// strictly alternate (a page may start with the meaning of the previous
// page's last term), else null.
function pairParagraphs(blocks, previous) {
  const pairs = [];
  let open = previous?.meanings.length === 0 ? previous : null;
  let last = null; // "term" | "meaning"
  for (const block of blocks) {
    const text = textOf(block);
    if (block.block_type === "paragraph" && isTerm(text)) {
      if (last === "term") return null; // two terms in a row: a column dump
      open = { term: text, meanings: [] };
      pairs.push(open);
      last = "term";
    } else if (isMeaning(text) && open) {
      open.meanings.push(text);
      last = "meaning";
    } else {
      return null;
    }
  }
  return pairs.length ? { pairs, open } : null;
}

const PAIRABLE = new Set(["paragraph", "list"]);
const fileOf = (block) => block.position?.file ?? null;

function normalizeSection(section, diagnostics) {
  const out = [];
  let run = null; // the table being built from paragraph pages
  let lastPair = null;
  const flush = () => {
    if (run) out.push(tableBlock(columnsFor(2), run.pairs.map((p) => [p.term, p.meanings.join(" ")]), run.position));
    run = null;
    lastPair = null;
  };
  const blocks = section.blocks;
  for (let i = 0; i < blocks.length; ) {
    const block = blocks[i];
    if (block.block_type === "table") {
      flush();
      out.push(normalizeTable(block, diagnostics) ?? block);
      i++;
      continue;
    }
    if (!PAIRABLE.has(block.block_type)) {
      if (block.block_type !== "image") flush();
      out.push(block);
      i++;
      continue;
    }
    // The paragraphs of this page, up to a table or heading.
    let end = i;
    while (end < blocks.length && PAIRABLE.has(blocks[end].block_type) && fileOf(blocks[end]) === fileOf(block)) end++;
    const page = blocks.slice(i, end);
    const paired = pairParagraphs(page, lastPair);
    if (paired) {
      run ??= { pairs: [], position: block.position };
      run.pairs.push(...paired.pairs);
      lastPair = paired.open;
    } else {
      flush();
      out.push(...page);
      if (page.some((b) => LATIN.test(textOf(b)) || isMeaning(textOf(b)))) {
        diagnostics.warning("glossary.unpaired_page", `Terms and meanings on this page can't be paired with certainty (a column dump or two terms in a row), so it is shown as printed and its terms aren't in the term list.`, { file: fileOf(block) });
      }
    }
    i = end;
  }
  flush();
  section.blocks = out;
}

// Normalizes the letter chapters in place; returns their term entries.
export function normalizeGlossary(chapters, diagnostics) {
  const entries = [];
  for (const chapter of chapters) {
    if (!chapter.isLetter) continue;
    for (const section of chapter.sections) {
      normalizeSection(section, diagnostics);
      for (const block of section.blocks) {
        if (block.block_type !== "table" || !["English"].includes(block.content.headers?.[0])) continue;
        for (const row of block.content.rows) {
          const [term, meaning] = [row[0]?.trim(), row[row.length - 1]?.trim()];
          if (term && meaning && LATIN.test(term) && isMeaning(meaning)) entries.push({ term, expansion: meaning, position: block.position });
        }
      }
    }
  }
  return entries;
}
