import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBookDirectory } from "../src/index.js";

function bookTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-folders-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const codes = (result) => result.diagnostics.map((d) => d.code);

// Laid out as docs/prompts/organize-book-markdown.md describes. Page 6 was
// split at section 1.1: its first part opens the chapter, the rest starts
// the section - both pieces keep the page's file name.
function organizedBook() {
  return bookTree({
    "01_FrontPages/01_Cover.md": "Build a Large Language Model\n",
    "01_FrontPages/02_Copyright.md": "## Copyright\n\nAll rights reserved.\n",
    "01_FrontPages/03_Chapters.md": "## CHAPTERS\n\n* Understanding LLMs\n",
    "02_Part_I_Foundations/p_page_0004.md": "## Part I Foundations\n\nWhy this part.\n",
    "03_Part_I_Understanding_LLMs/p_page_0005.md": "## 1 Understanding LLMs\n\n## This chapter covers\n\nWhat LLMs are.\n",
    "03_Part_I_Understanding_LLMs/p_page_0006.md": "Intro continues.\n",
    "03_Part_I_Understanding_LLMs/01_What_is_an_LLM/p_page_0006.md": "## 1.1 What is an LLM?\n\nA model.\n\n## TRANSFORMERS VERSUS LLMS\n\nA sidebar.\n",
    "03_Part_I_Understanding_LLMs/01_What_is_an_LLM/p_page_0007.md": "More about LLMs.\n",
    "03_Part_I_Understanding_LLMs/02_Summary/p_page_0008.md": "## 1.2 Summary\n\nDone.\n",
    "04_Working_with_Text_Data/p_page_0009.md": "## Working with Text Data\n\nNo numbered sections here.\n\n## 2.0.1 Odd\n\nStill content.\n",
    "05_Appendix_A_Introduction_to_PyTorch/p_page_0010.md": "## Appendix A. Introduction to PyTorch\n\nAbout PyTorch.\n",
    "05_Appendix_A_Introduction_to_PyTorch/01_What_is_PyTorch/p_page_0011.md": "## A.1 What is PyTorch\n\nA library.\n",
    "06_BackPages/01_Glossary.md": "## Glossary\n\nLLM → large language model\n",
    "06_BackPages/02_About_the_Author.md": "## About the Author\n\nBio.\n",
    "images/fig.png": "",
    "book_metadata.json": JSON.stringify({ pdf: { name: "Build_a_Large_Language_Model.pdf" } }),
  });
}

test("numbered folders are the structure: front pages, parts, chapters, sections, appendices, back pages", () => {
  const result = parseBookDirectory(organizedBook());
  assert.deepEqual(
    result.chapters.map((c) => [c.role, c.number, c.title]),
    [
      ["front_matter", null, "Front Matter"],
      ["part", "I", "Foundations"],
      ["chapter", "1", "Understanding LLMs"],
      ["chapter", "2", "Working with Text Data"],
      ["appendix", "A", "Introduction to PyTorch"],
      ["back_matter", null, "Back Matter"],
    ]
  );
  const [front, part, one, two, appendix, back] = result.chapters;
  assert.equal(one.partId, part.id, "a chapter with the part's label belongs to it");
  assert.equal(two.partId, null);
  assert.deepEqual(front.sections.map((s) => [s.role, s.title]), [["cover", "Cover"], ["copyright", "Copyright"], ["section", "Chapters"]]);
  assert.deepEqual(back.sections.map((s) => [s.role, s.title]), [["glossary", "Glossary"], ["about_author", "About the Author"]]);
  assert.deepEqual(appendix.sections.map((s) => [s.role, s.numbering, s.title]), [
    ["body", null, "Introduction to PyTorch"],
    ["section", "A.1", "What is PyTorch"],
  ]);
});

test("a chapter's loose pages are its opening; each subfolder is a section with its printed number and title", () => {
  const result = parseBookDirectory(organizedBook());
  const one = result.chapters.find((c) => c.number === "1");
  assert.deepEqual(one.sections.map((s) => [s.role, s.numbering, s.title, s.depth]), [
    ["body", null, "Understanding LLMs", 1],
    ["section", "1.1", "What is an LLM?", 2],
    ["section", "1.2", "Summary", 2],
  ]);
  const [opening, llm] = one.sections;
  assert.deepEqual(opening.blocks.map((b) => [b.block_type, b.content.text]), [
    ["subheading", "This chapter covers"],
    ["paragraph", "What LLMs are."],
    ["paragraph", "Intro continues."],
  ], "the chapter title heading is consumed, other headings stay as subheadings");
  assert.deepEqual(llm.blocks.map((b) => [b.block_type, b.content.text]), [
    ["paragraph", "A model."],
    ["subheading", "TRANSFORMERS VERSUS LLMS"],
    ["paragraph", "A sidebar."],
    ["paragraph", "More about LLMs."],
  ]);
  assert.equal(llm.blocks[0].position.file, path.join("03_Part_I_Understanding_LLMs", "01_What_is_an_LLM", "p_page_0006.md"));
});

test("a chapter without section folders is one section; headings never become sections", () => {
  const result = parseBookDirectory(organizedBook());
  const two = result.chapters.find((c) => c.number === "2");
  assert.equal(two.sections.length, 1);
  assert.deepEqual(two.sections[0].blocks.map((b) => b.block_type), ["paragraph", "subheading", "paragraph"]);
});

test("a Glossary file in the back pages gives the book's glossary; title comes from the metadata", () => {
  const result = parseBookDirectory(organizedBook());
  assert.deepEqual(result.glossary.map((g) => [g.term, g.expansion]), [["LLM", "large language model"]]);
  assert.equal(result.book.title, "Build a Large Language Model");
  assert.ok(codes(result).includes("folders.used"));
  assert.equal(codes(result).includes("toc.not_found"), false, "no contents page needed: the folders are explicit");
});

test("loose pages outside the folders and nested section folders are reported, not silently used", () => {
  const dir = bookTree({
    "stray_page_0001.md": "Stray.\n",
    "01_Chapter_One/p1.md": "## Chapter One\n\nText.\n",
    "01_Chapter_One/01_Section/p2.md": "## Section\n\nS.\n",
    "01_Chapter_One/01_Section/01_Too_Deep/p3.md": "Deep.\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => c.title), ["Chapter One"]);
  const loose = result.diagnostics.find((d) => d.code === "folders.loose_file");
  assert.equal(loose.file, "stray_page_0001.md");
  assert.ok(result.diagnostics.some((d) => d.code === "folders.nested_ignored" && d.message.includes("01_Too_Deep")));
});

test("given the book folder, its organized markdown/ subfolder is read", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "md-folders-"));
  fs.mkdirSync(path.join(base, "Build-LLM-1", "pages"), { recursive: true });
  fs.cpSync(organizedBook(), path.join(base, "Build-LLM-1", "markdown"), { recursive: true });
  const result = parseBookDirectory(path.join(base, "Build-LLM-1"));
  assert.equal(result.chapters.length, 6);
});

test("flat page files without numbered folders still use the contents page", () => {
  const dir = bookTree({ "p1.md": "# Contents\n\n**1 Alpha** 2\n", "p2.md": "# Alpha\n\nA.\n" });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => c.title), ["Front Matter", "Alpha"]);
  assert.ok(codes(result).includes("toc.used"));
});

test("front/back pages: consecutive files with the same name are one section, blank pages join their neighbour", () => {
  const dir = bookTree({
    "01_FrontPages/01_Blank.md": "\n",
    "01_FrontPages/02_Praise.md": "Great book.\n",
    "01_FrontPages/03_Praise.md": "Really great.\n",
    "01_FrontPages/04_Blank.md": "\n",
    "01_FrontPages/05_Preface.md": "## Preface\n\nWhy.\n",
    "01_FrontPages/06_Preface.md": "Who for.\n",
    "02_Hello_Transformers/p_page_0025.md": "## **CHAPTER 1 Hello Transformers**\n\nWelcome.\n",
    "03_BackPages/01_Index.md": "A, B\n",
    "03_BackPages/02_Index.md": "C, D\n",
  });
  const result = parseBookDirectory(dir);
  const [front, chapter, back] = result.chapters;
  assert.deepEqual(front.sections.map((s) => [s.title, s.blocks.map((b) => b.content.text)]), [
    ["Praise", ["Great book.", "Really great."]],
    ["Preface", ["Why.", "Who for."]],
  ]);
  assert.deepEqual(back.sections.map((s) => [s.role, s.title, s.blocks.length]), [["index", "Index", 2]]);
  assert.equal(chapter.title, "Hello Transformers");
  assert.deepEqual(chapter.sections[0].blocks.map((b) => b.content.text), ["Welcome."], 'a "CHAPTER 1 ..." title heading is the chapter\'s own, not repeated');
});

test("one file per section: Chapter_NN_ folders, NN_ section files and folders, Front_Matter and End_Matter with appendices", () => {
  const dir = bookTree({
    "README.md": "# Index of the folders\n",
    "00_Front_Matter.md": "# Hands-On Book\n\nBy us.\n",
    "01_Preface/00_Overview.md": "## Preface\n\nWhy.\n",
    "01_Preface/01_Prerequisites.md": "## Prerequisites\n\nPython.\n",
    "Chapter_01_An_Introduction/00_Introduction.md": "## Chapter 1. An Introduction\n\nWelcome.\n",
    "Chapter_01_An_Introduction/01_What_Is_AI.md": "## What Is AI?\n\nA field.\n",
    "Chapter_01_An_Introduction/02_History/00_Overview.md": "## History\n\nLong.\n",
    "Chapter_01_An_Introduction/02_History/01_Bag_of_Words.md": "### Bag-of-Words\n\nCounts.\n",
    "Chapter_01_An_Introduction/03_Summary.md": "## Summary\n\nDone.\n",
    "Chapter_02_Tokens/00_Introduction.md": "## Chapter 2. Tokens\n\nTokens.\n",
    "End_Matter/01_Appendix_A_Python/00_Overview.md": "## Appendix A. Python\n\nInstall it.\n",
    "End_Matter/01_Appendix_A_Python/01_Windows.md": "## A.1 Windows\n\nClick.\n",
    "End_Matter/02_Appendix_B_Resources.md": "## Appendix B. Resources\n\nLinks.\n",
    "End_Matter/03_Index.md": "## Index\n\nA, B\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => [c.role, c.number, c.title]), [
    ["front_matter", null, "Front Matter"],
    ["preface", null, "Preface"],
    ["chapter", "1", "An Introduction"],
    ["chapter", "2", "Tokens"],
    ["appendix", "A", "Python"],
    ["appendix", "B", "Resources"],
    ["back_matter", null, "Back Matter"],
  ]);
  const one = result.chapters[2];
  assert.deepEqual(one.sections.map((s) => [s.role, s.title]), [
    ["body", "An Introduction"],
    ["section", "What Is AI?"],
    ["section", "History"],
    ["section", "Summary"],
  ]);
  assert.deepEqual(one.sections[2].blocks.map((b) => [b.block_type, b.content.text]), [
    ["paragraph", "Long."],
    ["subheading", "Bag-of-Words"],
    ["paragraph", "Counts."],
  ], "a section folder's subsection pages stay in the section");
  assert.deepEqual(result.chapters[4].sections.map((s) => [s.numbering, s.title]), [[null, "Python"], ["A.1", "Windows"]]);
  assert.deepEqual(result.chapters[6].sections.map((s) => s.title), ["Index"]);
  assert.equal(codes(result).includes("folders.loose_file"), false, "README.md is not a stray page");
});

test("role folders, chapter labels, part banners inside chapters, 00_ introductions; markdown/ wins over a stray page beside it", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "md-folders-"));
  fs.writeFileSync(path.join(base, "chapters.md"), "1. Basics 1\n");
  fs.cpSync(
    bookTree({
      "Front_Matter/book_page_0001.md": "# Rust Book\n",
      "Front_Matter/book_page_0002.md": "Copyright.\n",
      "Preface/book_page_0004.md": "## Preface\n\nWhy.\n",
      "Chapters/book_page_0003.md": "# Table of Contents\n\n1. **Basics** — 1\n",
      "00_Welcome/book_page_0005.md": "## Welcome\n\nHello.\n",
      "01_Basics/book_page_0006.md": "## Part I Day 1\n\nThis part covers the basics.\n\n## Chapter 1\n\n## Basics\n\nIntro.\n",
      "01_Basics/01_Threads/book_page_0007.md": "## 1.1 Threads\n\nSpawn.\n",
      "02_References/book_page_0008.md": "## Chapter 2\n\n## References\n\nBorrow.\n",
      "Index_Symbols/book_page_0009.md": "## Index\n\nA\n",
      "Back_Matter/book_page_0010.md": "Colophon.\n",
    }),
    path.join(base, "markdown"),
    { recursive: true }
  );
  const result = parseBookDirectory(base);
  assert.deepEqual(result.chapters.map((c) => [c.role, c.number, c.title]), [
    ["front_matter", null, "Front Matter"],
    ["introduction", null, "Welcome"],
    ["part", "I", "Day 1"],
    ["chapter", "1", "Basics"],
    ["chapter", "2", "References"],
    ["back_matter", null, "Back Matter"],
  ]);
  const [front, , part, basics, references, back] = result.chapters;
  assert.deepEqual(front.sections.map((s) => [s.role, s.title]), [["front_matter", "Front Matter"], ["toc", "Chapters"], ["preface", "Preface"]]);
  assert.deepEqual(back.sections.map((s) => [s.role, s.title]), [["index", "Index Symbols"], ["back_matter", "Back Matter"]]);
  assert.deepEqual(part.sections[0].blocks.map((b) => b.content.text), ["This part covers the basics."], "a part banner at the start of a chapter folder is the part's page");
  assert.deepEqual(basics.sections[0].blocks.map((b) => [b.block_type, b.content.text]), [["paragraph", "Intro."]], "the Chapter 1 label and title are consumed");
  assert.equal(basics.partId, part.id);
  assert.equal(references.partId, part.id, "chapters after it belong to the part");
});

test("LastPages is back matter; an unnumbered subfolder of the front pages is a section placed by its pages", () => {
  const dir = bookTree({
    "00_FrontPages/book_page_0001.md": "# Learning TypeScript\n",
    "00_FrontPages/Chapters/book_page_0002.md": "# Table of Contents\n\n1. **Basics** — 1\n",
    "00_FrontPages/Preface/book_page_0004.md": "## Preface\n\nWhy.\n",
    "00_FrontPages/book_page_0003.md": "Dedication.\n",
    "01_Basics/book_page_0005.md": "## Basics\n\nText.\n",
    "LastPages/book_page_0006.md": "### any\n\nA top type.\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => c.role), ["front_matter", "chapter", "back_matter"]);
  assert.deepEqual(result.chapters[0].sections.map((s) => [s.role, s.title]), [
    ["section", "Front Pages"],
    ["toc", "Chapters"],
    ["section", "Front Pages"],
    ["preface", "Preface"],
  ]);
  assert.deepEqual(result.chapters[2].sections.map((s) => s.title), ["Last Pages"]);
});

test("parts listed on the contents page: their folders are parts and the chapters after them belong to them", () => {
  const dir = bookTree({
    "01_FrontPages/01_Contents.md": "## Contents\n\n## **Part I. Getting Started**\n\n1. A Q&A Session 3\n\n## Part II. Types and Operations\n",
    "02_Getting_Started/p_page_0010.md": "**PART I**\n\n## **Getting Started**\n",
    "03_A_QA_Session/p_page_0011.md": "## **CHAPTER 1 A Q&A Session**\n\nWhy Python.\n",
    "03_A_QA_Session/01_Why/p_page_0012.md": "## Why\n\nBecause.\n",
    "04_Types_and_Operations/p_page_0013.md": "## **Types and Operations**\n",
    "05_Object_Types/p_page_0014.md": "## **CHAPTER 2 Object Types**\n\nTypes.\n",
    "06_Appendix_B_The_Python_3_3_Launcher/p_page_0015.md": "## **The Python 3.3 Launcher**\n\nWindows.\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => [c.role, c.number, c.title]), [
    ["front_matter", null, "Front Matter"],
    ["part", "I", "Getting Started"],
    ["chapter", "1", "A Q&A Session"],
    ["part", "II", "Types and Operations"],
    ["chapter", "2", "Object Types"],
    ["appendix", "B", "The Python 3.3 Launcher"],
  ]);
  const [, partOne, one, partTwo, two, appendix] = result.chapters;
  assert.equal(one.partId, partOne.id);
  assert.equal(two.partId, partTwo.id);
  assert.equal(appendix.partId, null);
});

test("a part the contents page lists can open a chapter folder without saying \"Part\"", () => {
  const dir = bookTree({
    "00_Front_Matter/02_Brief_contents.md": "## **PART 1CLASSIFICATION .........1**\n\n## **PART 2FORECASTING VALUES ......151**\n",
    "Chapter_01_Machine_learning_basics/00_Introduction.md": "## *Classification*\n\nThe first part is on supervised learning.\n\n## *Machine learning basics*\n\nWhat it is.\n",
    "Chapter_02_Regression/00_Introduction.md": "## *Forecasting values*\n\nThis part covers regression.\n\n## *Regression*\n\nLines.\n",
  });
  const result = parseBookDirectory(dir);
  assert.deepEqual(result.chapters.map((c) => [c.role, c.number, c.title]), [
    ["front_matter", null, "Front Matter"],
    ["part", "1", "Classification"],
    ["chapter", "1", "Machine learning basics"],
    ["part", "2", "Forecasting values"],
    ["chapter", "2", "Regression"],
  ]);
  assert.deepEqual(result.chapters[2].sections[0].blocks.map((b) => b.content.text), ["What it is."]);
});
