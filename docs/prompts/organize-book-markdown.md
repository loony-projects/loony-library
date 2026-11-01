# Prompt: organize a PDF-converted book into chapter and section folders

The result is what book-import reads directly: the folders become the
book's chapters and sections (see ../migration.md).

Copy everything below the line into the AI assistant (one that can read and
write files, e.g. Claude Code), and fill in the book folder on the first line.
Works for any kind of book: technical books, books with parts, books in any
language, dictionaries and glossaries, and anthologies.

---

Book folder: `<PATH TO BOOK FOLDER>`

> **Before using this prompt:** if the book's chapters are already folders of
> pages and only the sections are missing, `npm run organize` in
> `book-import/` does that part from the book's own contents list, verified
> byte-for-byte (see [../migration.md](../migration.md#splitting-chapters-into-sections-npm-run-organize)).
> The importer also reads other organized layouts (one file per section,
> named Front_Matter/End_Matter folders) - see
> [../migration.md](../migration.md#chapters-and-sections-from-organized-folders).
> This prompt produces the canonical layout.

## Your task

The book folder contains a book that was converted to Markdown **one file
per PDF page**. Reorganize those Markdown pages into folders that follow the
book's own structure:

- the **front pages** go into one folder,
- each **chapter** (or appendix, or piece in a collection, or letter in a
  dictionary) gets its own folder,
- inside a chapter, each **section** gets its own folder - one level only,
  chapter → section, never subsections,
- the **back pages** go into one folder.

You are only moving files into folders and, where a chapter or section
starts in the middle of a page, splitting that page file into two. You do
not rewrite, translate, fix, summarize, merge or delete any text.

The structure comes from what the **book itself states** - mainly its
contents page. Don't invent chapters or sections from how headings happen
to look. When the book doesn't make something clear, follow the rules below
and report what you did; never guess silently.

## The input

```
<book>/
  <book>.pdf                      leave untouched
  pages/                          one PDF per page - leave untouched
  markdown/
    <name>_metadata.json          conversion metadata - leave untouched, keep where it is
    images/                       extracted images - leave untouched, keep where it is
    <name>_page_0001.md           one Markdown file per PDF page
    <name>_page_0002.md
    ...
```

Page order is the number in the file name (`_page_0002` before `_page_0010`).
Work only inside `markdown/`. If the book folder is laid out differently
(no `pages/`, different file names), find the folder holding the per-page
Markdown files, work there, and say so in the report.

## Step 1 - Decide what kind of book it is

Look at the contents page and the first pages of the body, then pick one:

| Kind | How you recognize it | Layout |
|---|---|---|
| **Chaptered book** | Chapters, optionally grouped into parts, optionally followed by appendices. Most textbooks, manuals, grammars, novels. | [A](#layout-a---chaptered-book) |
| **Reference work** | Arranged alphabetically by entry: a dictionary, glossary, encyclopedia, terminology list. | [B](#layout-b---reference-work) |
| **Collection** | Separate pieces, often by different authors: stories, poems, essays, papers. | [C](#layout-c---collection) |

State the kind and the reason in the report. If the book mixes kinds (a
grammar with a glossary at the back), use the main kind for the body and
treat the rest as appendices or back pages.

## Step 2 - Find the contents page

The contents page is the book's own list of its chapters (or pieces), usually
with page numbers. Recognize it by **what it is**, not by its heading: it may
be headed "Contents", "Table of Contents", "Contents at a Glance", "Brief
Contents", "Contents in Detail", "Chapters", or a word in the book's own
language, or have no heading at all. It may span several pages. A book can
have two (a short "at a glance" list and a detailed one): use both - the
short one for chapters, the detailed one for sections.

- **Chaptered books and collections need a contents page.** If there is
  none, **stop and report it** - do not build chapters from headings.
- **Reference works** don't need one: their letter headings (`A`, `B`, ...)
  are the structure.

## Layout A - chaptered book

```
markdown/
  <name>_metadata.json
  images/
  01_FrontPages/
    01_Cover.md
    02_Copyright.md
    03_Preface.md
    04_Contents.md                       <- the contents page, always kept
  02_<Chapter_1_Title>/
    <name>_page_0012.md                  chapter opening: its title page / intro before the first section
    01_<Section_1_Title>/
      <name>_page_0013.md
      <name>_page_0014.md                first part of the page, up to the next section's heading
    02_<Section_2_Title>/
      <name>_page_0014.md                rest of that page, from the section heading on
      ...
  03_<Chapter_2_Title>/                  a chapter without sections: pages directly in its folder
    <name>_page_0031.md
    ...
  NN_Appendix_A_<Title>/                 appendices: like chapters, label kept
  NN_BackPages/
    01_Index.md
    02_About_the_Author.md
```

### Parts

If the contents page groups chapters into parts ("Part I", "Part One",
"Section 2" used for a group of chapters), keep chapters at the top level and
put the part only in the folder names:

```
  02_Part_I_<Part_Title>/                the part's own opening pages (part title page, part intro), if any
  03_Part_I_<Chapter_1_Title>/           chapters of part I
  04_Part_I_<Chapter_2_Title>/
  05_Part_II_<Part_Title>/
  06_Part_II_<Chapter_3_Title>/
  ...
```

- The part label is the book's own (`Part_I`, `Part_1`, `Part_One`), written
  the same way in every folder of that part.
- A part with no opening pages of its own gets no `Part_..._<Part_Title>`
  folder - its chapters still carry the part label.
- Appendices and back pages carry a part label only if the contents page puts
  them inside a part.

### What counts as a chapter

Exactly the chapter entries of the contents page - don't add chapters it
doesn't list, don't drop any it lists. A chapter starts where its title
appears in the pages: a heading like `## 3 Coding Attention Mechanisms`,
`## Chapter 3`, `## CHAPTER III`, or the title alone. If the number and the
title are on different lines or pages ("Chapter 3" on one page, the title on
the next), the chapter starts at the first of them.

### What counts as a section

Use the first of these that the book provides, and say in the report which
one you used (per chapter if it differs):

1. **The contents page lists sections under the chapter** (the detailed
   contents, with or without numbers). Those are the sections; find each in
   the pages by its title.
2. **The chapter has numbered top-level headings**: in chapter `N`, headings
   numbered `N.1`, `N.2`, ... (`## 3.1 Attending to different parts`). In an
   appendix: `A.1`, `A.2`, ... Use them even if the contents page doesn't
   list sections.
3. **Neither** - the chapter has no section folders; all its pages go
   directly in the chapter folder.

Never sections:
- subsections (`N.M.K` such as `3.2.1`, or entries indented under a section
  in the contents) - they stay inside their section's files;
- unnumbered headings the contents page doesn't list: sidebars, boxes,
  "This chapter covers", "Summary", "Exercises", "Listing 2.1", "Figure 3.4",
  "Table 5" - they stay where they are (unless rule 1 lists them);
- headings numbered for another chapter.

The chapter's opening - its title and everything before its first section -
stays directly in the chapter folder.

## Layout B - reference work

```
markdown/
  01_FrontPages/                         preface, how to use, abbreviations, pronunciation guide, contents
  02_A/
    <name>_page_0009.md
    ...
  03_B/                                  starts where the "B" entries start (split the page there)
  ...
  NN_Appendix_<Title>/                   any appendices the book lists
  NN_BackPages/
```

- One folder per letter or letter group the book itself uses (`02_A`,
  `03_B`, ... or `02_A-B`), in the book's alphabet and order - for a book in
  another script, use its letters (`02_अ`, `03_आ`).
- A letter starts at its letter heading, or - if the book has none - at its
  first entry beginning with that letter.
- No section folders inside letters.

## Layout C - collection

```
markdown/
  01_FrontPages/
  02_<Piece_1_Title>/                    one folder per story / poem / essay listed in the contents
  03_<Piece_2_Title>/
  ...
  NN_BackPages/                          notes on contributors, index, ...
```

- One folder per piece the contents page lists. If it groups pieces
  (sections, authors, years), treat the groups like parts: the group label
  goes in the folder names (`04_Poems_<Title>`).
- No section folders inside pieces.

## Naming rules (all layouts)

1. **Order prefix.** Every folder name starts with a number giving its
   position: `01_`, `02_`, ... at the top level (front pages first, back
   pages last) and `01_`, `02_`, ... for sections inside a chapter. Use three
   digits (`001_`) at a level that has more than 99 folders. The prefix is the
   position, not the chapter number - chapter 1 is usually `02_...` because
   `01_FrontPages` comes first.
2. **Title.** After the prefix, the title as the book prints it, without its
   number ("1.1", "Chapter 3"):
   - spaces become `_`; repeated `_` collapse to one;
   - keep letters and digits **in any script** (Latin, Devanagari, ...),
     and `-` and `.`;
   - drop everything else (`: ? , ' " ( ) / \ * < > |` and so on);
   - trim to at most 80 characters, at a word boundary.
   - Appendices keep their label: `09_Appendix_A_Introduction_to_PyTorch`.
   - A title that's all symbols or empty after this: use `Chapter_<N>`,
     `Section_<N>` or `Untitled`.
3. **Front and back pages** go in `01_FrontPages/` and `NN_BackPages/`, one
   file per page, renamed `NN_<What_it_is>.md` in page order, with English
   names whatever the book's language: `Cover`, `Half_Title`, `Title_Page`,
   `Copyright`, `Dedication`, `Epigraph`, `Contents`, `Foreword`,
   `Preface`, `Acknowledgments`, `Introduction`, `Abbreviations`,
   `Welcome`, `Index`, `Glossary`, `Bibliography`, `Notes`,
   `About_the_Author`, `Also_By`, `Colophon`, `Advertisement`. If you can't
   tell what a page is, use `Page`. Two consecutive pages of the same thing
   are numbered both: `05_Preface.md`, `06_Preface.md`.
   - Front pages: everything before the first chapter (or letter, or piece).
   - Back pages: everything after the last chapter, appendix, letter or piece
     that isn't itself an appendix. No back pages → no `NN_BackPages/`.
   - An "Introduction" that the contents page lists as a chapter is a
     chapter, not a front page.
4. **Pages inside chapter, section, letter and piece folders keep their
   original file names** (`<name>_page_0014.md`) - they record which PDF page
   the text came from.

## Splitting pages, and never changing text

- **When a chapter, section, part, letter or piece starts in the middle of a
  page, split that page file at the line where it starts.** Everything before
  that line goes to the earlier folder; that line and everything after it go
  to the new folder - both under the same original file name. A page can be
  split more than once.
- Split only at the start of a line that begins the new unit (its heading,
  or its first entry in a reference work) - never inside a paragraph, list,
  table or code block.
- **Never change text.** No rewording, translating, OCR fixing, reformatting,
  re-wrapping, added or removed lines (other than the split itself), and no
  merging of pages. Joining every piece back together in book order must
  reproduce the original pages exactly.
- **Image links stay as they are.** They refer to files in `images/` by name;
  don't rewrite them and don't move `images/`.
- Blank pages and pages with only a page number or running header stay with
  the pages around them; don't delete them.

## When you're unsure

- The contents page and the pages disagree (a listed chapter or section with
  no matching heading, a title spelled differently, a different order): follow
  the contents page, place the item by its number or closest title, and
  **list every such case in the report**.
- A listed entry can't be found at all: don't create an empty folder; report
  it, and leave its pages with the previous item.
- Something can't be placed: leave it in `markdown/` unmoved and report it.
- The book doesn't fit any layout above: stop and describe it in the report
  instead of improvising a structure.

## How to work

1. **Read before moving.** Read the contents page(s) and every page's
   headings. Decide the kind of book (step 1) and the section rule per
   chapter. Build the plan: front pages, each part / chapter / appendix /
   letter / piece with its start page and line, each section with its start
   page and line, back pages.
2. **Show the plan** as a table (folder → files, split points written as
   `page_0014.md @ line 9`) before changing anything, and wait for approval
   if you're working interactively.
3. **Apply it**: create the folders, move whole pages, split pages at the
   planned lines.
4. **Verify** and include the results in the report:
   - every original `<name>_page_NNNN.md` is accounted for: moved whole,
     renamed into `01_FrontPages/` / `NN_BackPages/`, or split into pieces;
   - for every split page, its pieces joined in order are byte-for-byte
     identical to the original;
   - the total number of lines across all moved files equals the original
     total;
   - no `.md` file is left loose in `markdown/` (unless reported as
     unplaceable);
   - `images/`, the metadata JSON, `pages/` and the PDF are unchanged.
5. **Report**: the kind of book and why, the section rule used for each
   chapter, the final folder tree, the list of split pages, and every
   disagreement or uncertainty.

## Worked example

*Build a Large Language Model (From Scratch)* - a chaptered book with no
parts. Its contents page (page 4, headed "CHAPTERS") is a bulleted list of 7
chapters and 5 appendices with no page numbers. The chapters have numbered
sections (`1.1`, `1.2`, ...), which the contents page doesn't list - section
rule 2. Section 1.1 starts on line 13 of page 6, so page 6 is split.

```
markdown/
  Build_a_Large_Language_Model_from_scratch_metadata.json
  images/
  01_FrontPages/
    01_Frontpage.md
    02_Copyright.md
    03_Welcome.md
    04_Chapters.md
  02_Understanding_Large_Language_Models/
    Build_a_Large_Language_Model_from_scratch_page_0005.md      title, "This chapter covers", intro
    Build_a_Large_Language_Model_from_scratch_page_0006.md      lines 1-12 of page 6
    01_What_is_an_LLM/
      Build_a_Large_Language_Model_from_scratch_page_0006.md    page 6 from line 13 ("## 1.1 What is an LLM?")
      Build_a_Large_Language_Model_from_scratch_page_0007.md
      Build_a_Large_Language_Model_from_scratch_page_0008.md    page 8 up to "## 1.2 ..."
    02_Applications_of_LLMs/
      Build_a_Large_Language_Model_from_scratch_page_0008.md    page 8 from "## 1.2 Applications of LLMs"
      ...
    08_Summary/
      Build_a_Large_Language_Model_from_scratch_page_0020.md    page 20 from "## 1.8 Summary"
      Build_a_Large_Language_Model_from_scratch_page_0021.md
  03_Working_with_Text_Data/
  ...
  08_Finetuning_to_Follow_Instructions/
  09_Appendix_A_Introduction_to_PyTorch/
  ...
  13_Appendix_E_Parameter-efficient_Finetuning_with_LoRA/
```

The sidebar heading `TRANSFORMERS VERSUS LLMS` on page 15 isn't numbered and
isn't in the contents, so it stays inside section 1.4's files.

A book with parts, such as *HTTP: The Definitive Guide*, would instead get
`02_Part_I_HTTP_The_Webs_Foundation/` (the part's opening page), then
`03_Part_I_Overview_of_HTTP/`, `04_Part_I_URLs_and_Resources/`, and so on.
