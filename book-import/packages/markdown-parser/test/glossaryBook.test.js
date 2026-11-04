import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory } from "../src/index.js";

function glossary(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glossary-"));
  fs.writeFileSync(path.join(dir, "book.json"), JSON.stringify({ title: "Glossary", glossary: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, "markdown", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return parseBookDirectory(dir);
}
const tables = (chapter) => chapter.sections[0].blocks.filter((b) => b.block_type === "table");
const terms = (r) => Object.fromEntries(r.glossary.map((g) => [g.term, g.expansion]));

test("letter folders are unnumbered chapters; a parked images folder isn't one", () => {
  const r = glossary({
    "FrontPages/g_page_0001.md": "# Glossary\n",
    "00_images/x.md": "ignored\n",
    "a/g_page_0002.md": "## A\n\n| English | Bodo |\n| --- | --- |\n| abandon | आगारनाय |\n",
    "b/g_page_0003.md": "## B\n\n| English | Bodo |\n| --- | --- |\n| baby | गथ' |\n",
  });
  assert.deepEqual(r.chapters.map((c) => [c.role, c.number, c.title]), [["front_matter", null, "Front Matter"], ["chapter", null, "A"], ["chapter", null, "B"]]);
  assert.deepEqual(terms(r), { abandon: "आगारनाय", baby: "गथ'" });
});

test("guide words aren't a header or a term; a header row that is an entry becomes a row; a Hindi column stays", () => {
  const r = glossary({
    "s/g_page_0010.md": "| species | spontaneous combustion |\n|---|---|\n| species | हारिसा |\n",
    "t/g_page_0011.md": "| seniormost | गिबिसिनथार |\n|---|---|\n| set | साजायनाय |\n",
    "u/g_page_0012.md": "| English | Hindi | Bodo |\n| --- | --- | --- |\n| unit | इकाई | फान्दा |\n",
  });
  const [s, t, u] = r.chapters;
  assert.deepEqual(tables(s)[0].content.headers, ["English", "Bodo"]);
  assert.deepEqual(tables(s)[0].content.rows, [["species", "हारिसा"]]);
  assert.match(tables(s)[0].content.markdown, /\| English \| Bodo \|/);
  assert.deepEqual(tables(t)[0].content.rows, [["seniormost", "गिबिसिनथार"], ["set", "साजायनाय"]]);
  assert.deepEqual(tables(u)[0].content.headers, ["English", "Hindi", "Bodo"]);
  assert.deepEqual(terms(r), { species: "हारिसा", seniormost: "गिबिसिनथार", set: "साजायनाय", unit: "फान्दा" });
});

test("alternating paragraphs become a table, wrapped meanings joined, across a page break", () => {
  const r = glossary({
    "r/g_page_0020.md": "render\n\n1. हो, गथाय, 2. बाउ\n\nसोलायनाय\n\nrenewal\n\nफोदाननाय\n\nrent\n",
    "r/g_page_0021.md": "भाडा\n\nrepair\n\nफोसाबनाय\n",
  });
  const [table] = tables(r.chapters[0]);
  assert.deepEqual(table.content.rows, [
    ["render", "1. हो, गथाय, 2. बाउ सोलायनाय"],
    ["renewal", "फोदाननाय"],
    ["rent", "भाडा"],
    ["repair", "फोसाबनाय"],
  ]);
  assert.equal(r.glossary.length, 4);
});

test("a column dump is never paired by position: it stays as printed and is reported", () => {
  const r = glossary({ "s/g_page_0083.md": "social system\n\nsocialisation\n\nsocio-drama\n\nसमाज खान्थि\n\nरागाजलाहौनाय\n\nसोलोंथाय\n\nसमाजारि\n" });
  assert.equal(tables(r.chapters[0]).length, 0);
  assert.equal(r.glossary.length, 0);
  const d = r.diagnostics.find((x) => x.code === "glossary.unpaired_page");
  assert.equal(d.severity, "warning");
  assert.match(d.file, /g_page_0083/);
  assert.deepEqual(r.chapters[0].sections[0].blocks.map((b) => b.content.text)[0], "social system");
});
