import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBookMarkdown,
  analyzeCodeBlocks,
  normalizeLanguage,
  parseFenceInfo,
  registerLanguage,
  registerAnalyzer,
  unregisterAnalyzer,
} from "../src/index.js";

const fence = (lang, code, meta = "") => `\`\`\`${lang}${meta ? ` ${meta}` : ""}\n${code}\n\`\`\``;

const SAMPLES = {
  javascript: ['import fs from "node:fs";', "export function read(p) { return fs.readFileSync(p); }", "class Cache {}", "const limit = 10;"].join("\n"),
  cpp: ["#include <vector>", "namespace demo {", "template <typename T> class Stack { T top(); };", "}", "static int helper(int x) { return x; }"].join("\n"),
  c: ["#include <stdio.h>", "#define MAX 10", "struct point { int x, y; };", "typedef unsigned long ulong;", "static int count;", "int main(void) { printf(\"hi\"); return 0; }"].join("\n"),
  go: ["package main", "", 'import (\n\t"fmt"\n\t"os"\n)', "", "type Server struct{}", "func (s *Server) Start() {}", "func helper() {}", "var Version = \"1\""].join("\n"),
  rust: ["use std::sync::Arc;", "pub struct Counter { n: u32 }", "impl Counter { pub fn new() -> Self { Counter { n: 0 } } }", "fn private() {}", "pub(crate) const LIMIT: u32 = 3;"].join("\n"),
  java: ["package demo;", "import java.util.List;", "public class Box { private int v; public int get() { return v; } }", "interface Shape {}"].join("\n"),
};

function book() {
  return [
    "# Code",
    "",
    "JavaScript example:",
    "",
    fence("js", SAMPLES.javascript, 'title="read.js"'),
    "",
    fence("c++", SAMPLES.cpp),
    "",
    fence("c", SAMPLES.c),
    "",
    fence("golang", SAMPLES.go),
    "",
    fence("rs", SAMPLES.rust),
    "",
    "That was Rust.",
    "",
    fence("java", SAMPLES.java),
  ].join("\n");
}

const decl = (analysis) => analysis.declarations.map((d) => `${d.kind}:${d.name}:${d.exported}`);

test("fenced code in JS, C++, C, Go, Rust and Java is collected, normalized and syntax-analysed", async () => {
  const result = parseBookMarkdown(book(), { file: "code.md" });
  assert.deepEqual(
    result.codeBlocks.map((c) => [c.originalLanguage, c.normalizedLanguage, c.recognizedLanguage, c.syntaxAnalysisSupported, c.analysisStatus]),
    [
      ["js", "javascript", true, true, "unanalysed"],
      ["c++", "cpp", true, true, "unanalysed"],
      ["c", "c", true, true, "unanalysed"],
      ["golang", "go", true, true, "unanalysed"],
      ["rs", "rust", true, true, "unanalysed"],
      ["java", "java", true, true, "unanalysed"],
    ]
  );

  await analyzeCodeBlocks(result);
  const [js, cpp, c, go, rust, java] = result.codeBlocks;
  for (const record of result.codeBlocks) assert.equal(record.analysisStatus, "analysed", `${record.normalizedLanguage}: ${JSON.stringify(record.analysis?.syntaxErrors)}`);

  assert.deepEqual(js.analysis.imports.map((i) => i.source), ["node:fs"]);
  assert.deepEqual(decl(js.analysis), ["function:read:true", "class:Cache:false", "variable:limit:false"]);
  assert.match(js.analysis.parser, /^tree-sitter-javascript@/);

  assert.deepEqual(cpp.analysis.imports.map((i) => i.source), ["<vector>"]);
  assert.deepEqual(decl(cpp.analysis), ["namespace:demo:null", "function:helper:false"]);

  assert.deepEqual(c.analysis.imports.map((i) => i.source), ["<stdio.h>"]);
  assert.deepEqual(decl(c.analysis), ["macro:MAX:null", "struct:point:null", "typedef:ulong:null", "variable:count:false", "function:main:true"]);

  assert.equal(go.analysis.package, "main");
  assert.deepEqual(go.analysis.imports.map((i) => i.source), ["fmt", "os"]);
  assert.deepEqual(decl(go.analysis), ["type:Server:true", "method:Start:true", "function:helper:false", "variable:Version:true"]);

  assert.deepEqual(rust.analysis.imports.map((i) => i.source), ["std::sync::Arc"]);
  assert.deepEqual(decl(rust.analysis), ["struct:Counter:true", "impl:Counter:null", "function:private:false", "const:LIMIT:true"]);

  assert.equal(java.analysis.package, "demo");
  assert.deepEqual(java.analysis.imports.map((i) => i.source), ["java.util.List"]);
  assert.deepEqual(decl(java.analysis), ["class:Box:true", "interface:Shape:false"]);

  // Fact ranges map back to file lines: `pub struct Counter` is line 2 of
  // the Rust snippet, whose fence opens on line 46 of the document.
  const counter = rust.analysis.declarations.find((d) => d.name === "Counter" && d.kind === "struct");
  assert.equal(counter.range.startLine, 2);
  assert.equal(counter.line, rust.position.start.line + 2);
});

test("fence metadata, lead-in/follow-up paragraphs and exact raw code", () => {
  const result = parseBookMarkdown(book());
  const [js, , , , rust] = result.codeBlocks;
  assert.equal(js.fenceMeta, 'title="read.js"');
  assert.equal(js.languageLabel, "js");
  assert.equal(js.rawCode, SAMPLES.javascript);
  assert.equal(js.fenced, true);
  const blocks = result.chapters[0].sections[0].blocks;
  assert.equal(blocks.find((b) => b.id === js.leadInParagraphId).content.text, "JavaScript example:");
  assert.equal(js.followUpParagraphId, null, "next block is code, not a paragraph");
  assert.equal(blocks.find((b) => b.id === rust.followUpParagraphId).content.text, "That was Rust.");
  assert.equal(rust.previousBlockId, result.codeBlocks[3].id);
});

test("aliases, attributes, unlabelled fences and unknown languages", async () => {
  for (const [label, id] of [
    ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
    ["ts", "typescript"], ["tsx", "typescript"], ["c", "c"], ["cpp", "cpp"], ["C++", "cpp"],
    ["cc", "cpp"], ["cxx", "cpp"], ["hpp", "cpp"], ["go", "go"], ["golang", "go"], ["rs", "rust"],
    ["Rust", "rust"], ["java", "java"], ["py", "python"], ["python", "python"],
  ]) {
    assert.equal(normalizeLanguage(label), id, label);
  }
  assert.deepEqual(parseFenceInfo("rust,editable,ignore", null), { label: "rust", attributes: ["editable", "ignore"], meta: null });
  assert.deepEqual(parseFenceInfo("{.python}", null).label, "python");
  assert.deepEqual(parseFenceInfo("language-go", 'hl_lines="2"'), { label: "go", attributes: [], meta: 'hl_lines="2"' });

  const md = ["```", "plain", "```", "", "```brainfuck", "+++.", "```", "", "```rust,editable", "fn main() {}", "```", "", "```tsx", "export const App = () => <div/>;", "```"].join("\n");
  const result = parseBookMarkdown(md);
  const [plain, bf, rust, tsx] = result.codeBlocks;
  assert.deepEqual([plain.originalLanguage, plain.normalizedLanguage, plain.recognizedLanguage], [null, null, false]);
  assert.deepEqual([bf.originalLanguage, bf.normalizedLanguage, bf.recognizedLanguage], ["brainfuck", null, false]);
  assert.equal(rust.originalLanguage, "rust,editable", "label is never rewritten");
  assert.deepEqual(rust.languageAttributes, ["editable"]);
  assert.ok(result.diagnostics.some((d) => d.code === "code.unknown_language" && d.message.includes("brainfuck")));

  await analyzeCodeBlocks(result);
  assert.equal(plain.analysisStatus, "unsupported");
  assert.equal(bf.analysisStatus, "unsupported");
  assert.equal(rust.analysisStatus, "analysed");
  assert.equal(tsx.analysisStatus, "analysed", "tsx label selects the TSX grammar");
  assert.equal(tsx.analysis.parser.startsWith("tree-sitter-typescript@"), true);
});

test("recognized languages without an analyzer are reported as unsupported, not analysed", async () => {
  const result = parseBookMarkdown("```kotlin\nfun main() {}\n```\n\n```sql\nselect 1;\n```");
  assert.deepEqual(result.codeBlocks.map((c) => [c.recognizedLanguage, c.syntaxAnalysisSupported]), [[true, false], [true, false]]);
  await analyzeCodeBlocks(result);
  assert.deepEqual(result.codeBlocks.map((c) => c.analysisStatus), ["unsupported", "unsupported"]);
  assert.equal(result.codeBlocks[0].analysis, undefined);
});

test("indented code blocks are collected with exact text", () => {
  const result = parseBookMarkdown("# A\n\nIntro:\n\n    fn main() {\n        println!(\"x\");\n    }\n");
  const [code] = result.codeBlocks;
  assert.equal(code.fenced, false);
  assert.equal(code.rawCode, 'fn main() {\n    println!("x");\n}');
  assert.equal(code.originalLanguage, null);
});

test("code nested in lists and blockquotes is indexed with its owner and a distinct id", () => {
  const md = [
    "# A",
    "## Nested",
    "- step",
    "",
    "  ```c",
    "  int x;",
    "  ```",
    "",
    "> ```go",
    "> package main",
    "> ```",
  ].join("\n");
  const result = parseBookMarkdown(md, { file: "n.md" });
  const section = result.chapters[0].sections[1];
  const [c, go] = result.codeBlocks;
  assert.equal(c.nested, true);
  assert.equal(c.blockId, section.blocks[0].id);
  assert.equal(c.id, `${section.blocks[0].id}.code0`);
  assert.equal(c.ownerId, section.id);
  assert.equal(c.rawCode, "int x;");
  assert.equal(c.position.start.line, 5);
  assert.equal(go.blockId, section.blocks[1].id);
  assert.equal(go.normalizedLanguage, "go");
  assert.equal(section.blocks[0].nestedCode, undefined, "the index is the one representation of nested code");
});

test("the same snippet twice gets distinct ids and the right owners", () => {
  const snippet = fence("rust", "let x = 1;");
  const result = parseBookMarkdown(`# One\n\n${snippet}\n\n# Two\n\n## Sub\n\n${snippet}\n`);
  const [first, second] = result.codeBlocks;
  assert.equal(first.rawCode, second.rawCode);
  assert.notEqual(first.id, second.id);
  assert.equal(first.chapterId, result.chapters[0].id);
  assert.equal(second.chapterId, result.chapters[1].id);
  assert.equal(second.ownerId, result.chapters[1].sections[1].id);
});

test("incomplete snippets report parse_error with partial facts and never fail the book", async () => {
  const md = [
    fence("rust", "pub fn ok() {}\nfn broken() {\n    let x = "),
    "",
    fence("c", "int main(void) {\n  return 0;"),
    "",
    fence("java", 'System.out.println("fragment");'),
    "",
    fence("go", "x := 5\nfmt.Println(x)"),
  ].join("\n");
  const result = parseBookMarkdown(md, { file: "f.md" });
  await analyzeCodeBlocks(result);
  const [rust, c, java, go] = result.codeBlocks;

  assert.equal(rust.analysisStatus, "parse_error");
  assert.equal(rust.analysis.complete, false);
  assert.ok(rust.analysis.syntaxErrors.length > 0);
  assert.ok(rust.analysis.declarations.some((d) => d.name === "ok"), "partial facts kept");
  assert.equal(rust.analysis.truncated, true, "error runs to the end of the snippet");

  assert.equal(c.analysisStatus, "parse_error");
  assert.ok(c.analysis.syntaxErrors.some((e) => e.message.startsWith("Missing")));
  assert.ok(c.analysis.declarations.some((d) => d.name === "main"));

  assert.equal(java.analysisStatus, "analysed", "statement fragments are valid top-level input for the grammar");
  assert.equal(java.analysis.truncated, false);
  assert.equal(go.analysisStatus, "analysed");
  assert.deepEqual(go.analysis.declarations.map((d) => d.name), ["x"]);

  const syntax = result.diagnostics.filter((d) => d.code === "code.syntax_error");
  assert.equal(syntax.length, 2);
  assert.equal(syntax[0].file, "f.md");
  assert.equal(syntax[0].severity, "info");
});

test("analyzer failures are diagnostics, not exceptions; the registry is extensible", async () => {
  registerLanguage({ id: "zig", name: "Zig", aliases: ["zig"] });
  registerAnalyzer({
    id: "exploding",
    languages: ["zig"],
    async analyze() {
      throw new Error("boom");
    },
  });
  try {
    const result = parseBookMarkdown("```zig\nconst x = 1;\n```\n\n```rust\nfn main() {}\n```");
    assert.equal(result.codeBlocks[0].syntaxAnalysisSupported, true);
    await analyzeCodeBlocks(result);
    assert.equal(result.codeBlocks[0].analysisStatus, "unanalysed");
    assert.equal(result.codeBlocks[1].analysisStatus, "analysed", "one failing analyzer doesn't stop the rest");
    const failure = result.diagnostics.find((d) => d.code === "code.analyzer_failed");
    assert.match(failure.message, /boom/);
  } finally {
    unregisterAnalyzer("zig");
  }
});

test("an unclosed fence is reported", () => {
  const result = parseBookMarkdown("# A\n\n```js\nconst x = 1;\n", { file: "u.md" });
  const d = result.diagnostics.find((x) => x.code === "code.unclosed_fence");
  assert.deepEqual([d.file, d.line], ["u.md", 3]);
  assert.equal(result.codeBlocks[0].rawCode, "const x = 1;");
});

test("parsing never executes code", async () => {
  globalThis.__executed = false;
  const result = parseBookMarkdown(fence("js", "globalThis.__executed = true;"));
  await analyzeCodeBlocks(result);
  assert.equal(globalThis.__executed, false);
  delete globalThis.__executed;
});
