# cleaner

Cleans up the Markdown pages that PDF-to-Markdown conversion produces from programming books, where code listings end up flattened onto a single line. You choose the book's language with `--lang`, and its code comes out in fences tagged with that language:

| Book | Command | Fences |
|---|---|---|
| Rust | `--lang rust` | ```` ```rs ```` |
| Node.js / JavaScript, such as *Beginning Node.js* | `--lang js` | ```` ```js ```` (plus ```` ```json ````, ```` ```html ````, ```` ```console ````) |
| Java, such as *Java: The Complete Reference* | `--lang java` | ```` ```java ```` |
| PostgreSQL / SQL, such as *The Art of PostgreSQL* | `--lang sql` | ```` ```sql ```` |
| Python, such as *Build a Large Language Model (From Scratch)* | `--lang py` | ```` ```py ```` |

Use one language per book. Each language's heuristics can mistake another language's code for its own; on the Python book, for example, `--lang js` would fence Python as JavaScript.

Behind `--lang` are six steps:

1. **Rust** (`--lang rust`): reflows squashed Rust paragraphs into indented ```` ```rs ```` fenced blocks. It supports three styles of mangled input ("profiles"). This step was previously the separate `rust-code-unmangler` tool.
2. **JavaScript** (`--lang js`): fences and prettifies JavaScript in the style of Prettier, and also fences JSON, HTML and `$` shell sessions. It splits listing captions such as `*Listing 2-43.* error1.js` from the code that follows them.
3. **Java** (`--lang java`): rebuilds line breaks and indentation from braces and semicolons, in the style of *Java: The Complete Reference*: 2-space indentation, `} else {` on one line, `case` labels indented inside `switch`, a blank line between methods and between classes, and array initializers kept on one line when they fit. Spacing within a line is kept as written. Flattened `//` comments have no line end, so where each one ends is guessed from where unmistakable Java resumes (`// radius of circle pi = 3.1416;`). Long lines are broken after commas and before `+`, `&&` and `||`. Paragraphs with italics, such as syntax templates like `for(*initialization*; *condition*; *iteration*)`, are left alone.
4. **SQL** (`--lang sql`): fences and formats PostgreSQL in the style *The Art of PostgreSQL* uses: one clause per line, with the clause keywords right-aligned on a common column, joins under the first table, and subqueries and `$$` function bodies (including PL/pgSQL) indented. It removes the bold keywords, turns italic comments back into `--` and `/* */` comments, and removes the listing line numbers that the extraction left in the code (`order by date 10 )`) wherever SQL cannot have a number there. psql sessions that mix queries with their output are left as they are.
5. **Clean** (first half of `--lang py`, or `--clean` alone): removes stray `\_` escapes and wraps paragraphs that look like Python in ```` ```py ```` fences.
6. **Format** (second half of `--lang py`, or `--format` alone): prettifies the code inside ```` ```py ```` fences, in the style of Prettier/Black. It rebuilds the line breaks and indentation that the PDF extraction flattened onto a single line.

No dependencies are needed. It requires Node.js 18 or newer.

## Usage

Without `--path` (or `CLEANER_PATH`), these read `~/markdown/`. Folders are always found from `$HOME`, so the commands work from any directory:

```bash
# Python book: clean and format in one pass
node ./index.cjs --lang py

# Rust book: reflow Rust listings (the profile is auto-detected)
node ./index.cjs --lang rust

# Node.js book: fence and format JavaScript, JSON, HTML and shell sessions
node ./index.cjs --lang js --path ~/.output/NodeJs/Beginning_Nodejs/markdown

# Java book: fence and format Java listings
node ./index.cjs --lang java --path ~/.output/Java/Java-Ninth-Edition/markdown

# PostgreSQL book: fence and format SQL, removing the listing line numbers
node ./index.cjs --lang sql --path ~/.output/Database/the-art-of-postgresql/markdown

# On a folder given by an absolute path or one relative to $HOME (~ and $HOME also work)
node ./index.cjs --lang py --path .output/Build-LLM/markdown
node ./index.cjs --lang rust --path /home/sankar/.output/Rust/rustatomicsandlocks/markdown

# Preview: list the files that would change without writing anything
node ./index.cjs --lang rust --dry-run

# Pin the Rust profile instead of auto-detecting
node ./index.cjs --lang rust --profile bold-keywords

# Run only one of the two Python steps
node ./index.cjs --clean
node ./index.cjs --format     # on files that are already cleaned

# Show help or the Rust profiles
node ./index.cjs --help
node ./index.cjs --list-profiles
```

### Options

| Option | Description |
|---|---|
| `--lang LANG` | The book's language: `rust` (alias `rs`), `js` (aliases `javascript`, `node`), `java`, `sql` (aliases `postgres`, `postgresql`, `pg`, `psql`) or `py` (alias `python`). Several can be given as `--lang rust,js` or a repeated `--lang`. |
| `--clean` | Run only the first Python step (fence Python paragraphs). |
| `--format` | Run only the second Python step (prettify existing ```` ```py ```` blocks). |
| `--path DIR` | Input folder. It can be absolute or relative to `$HOME`; `~` and `$HOME` are expanded. |
| `--out DIR` | Output folder. If omitted, the output goes in a folder next to the input (see below). |
| `--width N` | Maximum line width for formatted code. Without it, Python uses 88 (as Black does), and JavaScript (as Prettier does), Java and SQL use 80. |
| `--profile NAME` | The Rust profile to use with `--lang rust`. If omitted, it is auto-detected. |
| `--list-profiles` | List the Rust profiles and exit. |
| `--dry-run` | Process everything and report which files would change, without writing anything. |
| `-v`, `--verbose` | List every item to review and, with `--dry-run`, every file that would change (otherwise long lists are shortened). |
| `--config FILE` | Read defaults from this file instead of `cleaner/.env` (see [Configuration](#configuration)). |
| `[input] [output]` | The input and output folders given positionally. This is an alternative to `--path`/`--out`, but you can't use both forms for the same folder. |
| `-h`, `--help` | Show usage. |

Options that take a value accept both `--name value` and `--name=value`.

### Combining languages and steps

Languages and steps can be combined. They always run in the order **rust → js → java → sql → clean → format**, whatever order the flags are given in. Each file goes through every chosen step in memory, and only the final result is written.

### Default folders

| Command | Reads (no `--path`) | Writes (no `--out`) |
|---|---|---|
| Any `--lang`, or `--clean` | `~/markdown/` | `<input>-cleaned/` |
| `--format` alone | `~/markdown-cleaned/` | `<input>-formatted/` (a trailing `-cleaned` is dropped first) |

The output folder is created next to the input folder. For example:

| Command | Writes to |
|---|---|
| `--lang py --path books/llm/markdown` | `~/books/llm/markdown-cleaned/` |
| `--lang rust --path /home/sankar/code/markdown` | `/home/sankar/code/markdown-cleaned/` |
| `--format --path books/llm/markdown-cleaned` | `~/books/llm/markdown-formatted/` |

### Examples

```bash
# Choose the output folder too
node ./cleaner/index.cjs --lang py --path books/llm/markdown --out books/llm/book-md

# Positional form of the same command
node ./cleaner/index.cjs --lang py books/llm/markdown books/llm/book-md

# Wrap Python at 80 columns
node ./cleaner/index.cjs --lang py --width=80

# Wrap JavaScript at 100 columns
node ./cleaner/index.cjs --lang js --width=100
```

## Configuration

Instead of typing the same flags every time, you can set defaults in `cleaner/.env`. Copy [.env.example](.env.example) to start:

```bash
cp cleaner/.env.example cleaner/.env
```

| Variable | Same as |
|---|---|
| `CLEANER_LANG` | `--lang` (used when no `--lang`, `--clean` or `--format` is given, including when the command has no arguments at all) |
| `CLEANER_PATH` | `--path` |
| `CLEANER_OUT` | `--out` |
| `CLEANER_WIDTH` | `--width` (for every language) |
| `CLEANER_PROFILE` | `--profile` (only used with `--lang rust`) |

- **Precedence**, highest first: CLI flag, then a real environment variable, then the `.env` file, then the built-in default.
- **Folders are always found from `$HOME`**, wherever the command runs from: a relative folder in a flag, an environment variable or the `.env` file is relative to `$HOME`, and `~` and `$HOME` are expanded. So `CLEANER_PATH=.output/Rust/book/markdown`, `~/.output/Rust/book/markdown` and `$HOME/.output/Rust/book/markdown` are the same folder. The defaults are `~/markdown` and `~/markdown-cleaned`.
- **A different file:** use `--config FILE` to load another file, for example one per book. The option is not called `--env-file` because Node.js reserves that name for itself.
- **Old names:** the `rust-code-unmangler` names `RUST_UNMANGLER_DIR` and `RUST_UNMANGLER_PROFILE` are still understood. `RUST_UNMANGLER_WRITE` is ignored, because the cleaner always writes to a separate output folder; use `--dry-run` for a preview.
- `cleaner/.env` is gitignored.

## What it does to files

- The input folder is never modified. The output folder must not be the input folder, or be inside it or contain it. There is no in-place mode and no `.bak` files.
- The folder structure is copied, including subfolders. `.md` files are processed; all other files, such as `Build-LLM_metadata.json`, are copied unchanged. Symlinks are skipped.
- Running the tool again replaces files in the output folder.
- The original line endings (LF or CRLF) are kept.
- With `--dry-run`, nothing is written and the output folder is not created.

Example output (on a terminal it's in colour; `NO_COLOR=1` turns colour off, `FORCE_COLOR=1` keeps it when piping):

```text
md-code-unmangler  clean → format

  from  ~/Books/Programming_Languages/AI_ML_LLM/NLP-with-Transformer-Models/markdown
  to    ~/Books/Programming_Languages/AI_ML_LLM/NLP-with-Transformer-Models/markdown-cleaned
  467 Markdown files  ·  45 other files copied as is  ·  840 ms

  Python
    ✔ cleaned    247 / 467 Markdown files   ███████████░░░░░░░░░  53%
    ✔ formatted  449 / 494 Python blocks    ██████████████████░░  91%
    ● 2 blocks left unchanged
      looks like program output (2)
        04_Transformer_Anatomy/02_The_Encoder/NLP-with-Transformer-Models_page_0090.md:15
        04_Transformer_Anatomy/03_The_Decoder/NLP-with-Transformer-Models_page_0101.md:1

  ⚠ Python indentation of flattened code is reconstructed heuristically. Review the result.

  ✔ Done: 248 of 467 Markdown files changed → ~/Books/…/NLP-with-Transformer-Models/markdown-cleaned
```

- Items to review are grouped by reason, with their file and line. Each reason lists up to 10; `--verbose` lists all.
- With `--dry-run`, the files that would change are counted per top-level folder (`--verbose` lists each one).
- With `--lang rust`, the Rust section also says which profile was used and, when it was auto-detected, how many paragraphs each profile matched.

## How each step works

### Rust ([rust/](rust/))

A flattened Rust paragraph is detected line by line (code already in a fence is left alone), cleared of its Markdown artifacts, then reflowed by brace depth. The reflow breaks the line after `{` and after statement-ending `;`, puts `}` on its own line, keeps `} else {` together and indents 4 spaces per level. A `;` inside brackets, as in `[i32; 3]`, doesn't end a statement. Import groups such as `use a::{b, c};` stay on one line, and `#[attribute]`s get their own line. The result goes in a ```` ```rs ```` fence.

Different PDF converters mangle code differently, so detection and Markdown removal come from a **profile**:

#### `bold-keywords`

Every keyword is bolded, line comments are italicized, and `_`/`*` are escaped as `\_`/`\*`.

```
**use** std::collections::VecDeque; **fn** main() { **let** queue = Mutex::new(VecDeque::new()); thread::scope(|s| { *// Consuming thread* **let** t = s.spawn(|| **loop** { **let** item = queue.lock().unwrap().pop\_front(); **if let** Some(item) = item { dbg!(item); } **else** { thread::park(); } }); }); }
```

becomes:

```rs
use std::collections::VecDeque;
fn main() {
    let queue = Mutex::new(VecDeque::new());
    thread::scope(|s| {
        *// Consuming thread*
        let t = s.spawn(|| loop {
            let item = queue.lock().unwrap().pop_front();
            if let Some(item) = item {
                dbg!(item);
            } else {
                thread::park();
            }
        });
    });
}
```

The italic comments are deliberately kept verbatim, asterisks and all (`*// Consuming thread*`), to match the book's own convention.

#### `keyword-density`

There are no bold markers. Code is told apart from prose by how dense its keywords, semicolons and `::` are, or, for short leftovers such as `use std::io; fn main() {` or `pub struct Executor;`, by starting like a Rust item or statement. `//` comments have no end marker.

When the extraction kept each line's indentation as a run of spaces (a line break became one space, so a run of n spaces is a new line indented n − 1; the runs may be U+202F narrow no-break spaces), the listing is laid out from those runs instead of being reflowed. That keeps the author's own line breaks, method chains and multi-line strings. Lines at indentation 0 are found where an item ends at brace depth 0, and a listing continued from the previous page gets the indentation of the `}` that closes its first block. Only whitespace changes. If the runs don't account for every line break, the reflow is used instead.

```
fn main() {     let t_ptr = 99999999999999 as \*const usize;     let x = dereference(t_ptr);     println!("{}", x); }
```

becomes:

```rs
fn main() {
    let t_ptr = 99999999999999 as *const usize;
    let x = dereference(t_ptr);
    println!("{}", x);
}
```

#### `bold-plain-comments`

Keywords are bolded as in `bold-keywords`, but comments are plain, undelimited `//` as in `keyword-density`.

```
**fn** main() { **let** x: i32 = 10; println!("x: {x}"); // x = 20; // println!("x: {x}"); }
```

becomes:

```rs
fn main() {
    let x: i32 = 10;
    println!("x: {x}");
    // x = 20;
    // println!("x: {x}");
}
```

#### Auto-detection

Without `--profile`, every profile is tried on every line of every input file, and the one that matches the most paragraphs wins. `bold-keywords` and `bold-plain-comments` use the same detection, so they always tie. The tie is broken by which comment style (`*// …*` or bare `//`) appears in the matched lines. When detection isn't clear-cut, a warning suggests passing `--profile`. If no paragraph matches any profile, the step converts nothing. Once you know which profile a book uses, pin it with `--profile` or `CLEANER_PROFILE`.

### JavaScript ([js/](js/))

The step works on paragraphs outside existing fences:

- **Finding code.** A paragraph counts as JavaScript when it starts with unmistakable syntax and contains statement punctuation (`;`, `{`, or a closing `)`). Examples are `var x =`, `function name(`, `if (`, `require(`, `module.exports`, `foo.bar(`, a method chain such as `.use(` or `promise .then(`, and `} else {` continuing a listing from the previous page. Prose that only mentions code ("`var` is function scoped", "`catch(function(){})` is just sugar for…") stays prose.
- **Other kinds.** A paragraph starting with `\$ ` is a shell session (```` ```console ````, one `$` command per line). One starting with an HTML tag or `<!--` is HTML (```` ```html ````, one tag per line, indented by nesting, short elements kept on one line). One starting with `{ "` or `[` that contains only JSON tokens is JSON (```` ```json ````).
- **Captions and headers.** `*Listing 2-43.* error1.js try { … }` is split into the caption line and the code. So is a running page header like `Chapter 6 ■ Getting Started with HTTP response.end(); }`. A paragraph that squashes several listings together (`code *Listing 3-10.* app.js code *Listing 3-11.* …`) is split at each caption.
- **Prose lines.** In a paragraph spanning several lines, a line that reads like a sentence stays prose, even when it comes right after code.
- **Markdown artifacts.** `\_`, `\$` and `\*` escapes are removed; inside strings they are identity escapes, so values don't change. `**bold**` keyword markers (`**const** x`, `__**dirname**`) are removed, while the `**` power operator (`a ** 2`) is kept. An italic comment (`f() *//outputs Boo* g()`) ends exactly at its closing `*`.
- **Existing fences.** ```` ```js ````, ```` ```javascript ````, ```` ```json ```` and ```` ```html ```` fences are formatted in place. Untagged and other fences are left alone.

Formatting follows Prettier's defaults: 2-space indentation, an 80-column width, and spaces inside `{ }`. It uses a small version of Prettier's document printer:

- **Brackets.** An object, array or argument list stays on one line if it fits; otherwise each item goes on its own line. Objects and arrays then get a trailing comma, as in Prettier's `es5` setting.
- **Callbacks.** A function passed as the last argument, or as the first one as in `setTimeout(function () {…}, 1000)`, stays attached to its call.
- **Statements.** Statement breaks are rebuilt from braces, `;` and JavaScript's automatic semicolon insertion. For example, `var foo = {…} console.log(foo)` becomes two statements, and `break`, `continue` and `debugger` end a statement.
- **`switch`.** `case` bodies are indented.
- **Comments.** A trailing comment never forces the code before it to wrap. When code continues after a comment in the middle of a statement, it is indented once, like a chained `.then(…)`.

Unlike Prettier, it doesn't add missing semicolons or change quote style, since formatting may only change whitespace, line breaks and trailing commas.

#### Comment boundaries

A `//` comment in flattened code has no end marker, so the step guesses where code resumes. These count as code:

- another `//`
- a closing bracket the comment didn't open
- `var x =`, `function name(`, `if (`, `case 'x':`
- `return` followed by an expression (`return "http://" + …`, but not `return the value`)
- a call such as `foo(` or `.use(`
- an identifier spelled like code before a chain (`willReject .then(` but not `middleware .use(`)
- an assignment
- a run of 3 or more spaces, which some extractions leave where a line break was

A comment that follows `;` on the same line trails that statement; other comments go on their own line.

#### Safety checks

Every formatted block is tokenized again and compared with the original: only whitespace, line breaks and trailing commas may differ. If it differs, the block is fenced but left unformatted and reported. Each block is also compiled with Node's `vm` module, which checks syntax without running anything. A block that compiled before formatting but not after is left unformatted. A block that doesn't compile either way, usually code cut off at a page break, is still formatted and listed under "Review".

### Clean ([py/clean-markdown.cjs](py/clean-markdown.cjs))

- Changes `\_` to `_` in prose, but leaves it alone inside inline code and link URLs.
- Wraps a paragraph in a ```` ```py ```` fence when it starts like Python: `import`, `def`, `class`, `for … :`, an assignment such as `x = …`, a call such as `torch.manual_seed(`, and so on.
- Removes keyword highlighting that some converters add, as in *Natural Language Processing with Transformers*: `**class MultiHeadAttention**(nn.Module): **def** …`, `**from datasets import** …`, `**for** _ **in** …`, bolded escapes inside strings (`"**\n**"`) and italic docstrings (`*"""…"""*`). A bold span is only treated as highlighting when it starts with a Python keyword, `print` or a string escape, so Python's own `**` (`**kwargs`, `x**2`) and other bold text stay as they are. Such a paragraph is then judged and fenced without the markers.
- Moves a bold caption at the end of a code paragraph, such as `**Listing 2.1 …**`, out of the fence so it stays prose.
- Changes existing ```` ```python ```` fences to ```` ```py ```` and leaves fences in other languages untouched, including the ```` ```rs ```` blocks from the Rust step.

### Format ([py/format-python.cjs](py/format-python.cjs))

Only ```` ```py ````, ```` ```python ```` and ```` ```python3 ```` fences are changed. Prose and other fences are left exactly as they are.

- **One statement per line.** In flattened code it inserts a line break wherever a new statement starts, so `import re text = "…" print(text)` becomes three lines.
- **Indentation.** It indents 4 spaces after a block-opening `:`. For flattened code it guesses dedents from cues: `def` returns to class level, `elif`/`else`/`except`/`finally` line up with their `if` or `try`, and the line after `return`/`raise`/`break`/`continue`/`pass` steps back out. Code that already spans several lines keeps its own indentation.
- **Spacing.** It puts spaces around operators, after commas and after `:` in dicts. It removes spaces inside brackets and around keyword arguments (`f(a=1)`). It writes `x**2` without spaces when both operands are simple, and removes leftover `\*`/`\_` escapes.
- **Line wrapping.** A line longer than `--width` is split at its brackets, Black-style. If the contents fit on one indented line they go there; otherwise each item gets its own line and a trailing comma is added. A bracket that already ends in a trailing comma stays one item per line.
- **Comments.** In flattened code, where a comment ends is guessed from where code-like text resumes, such as a quote, a bracket, `snake_case` or `name(`. Comments inside brackets stay with the item they follow.
- **Italic comments.** Where the converter italicized comments (`*# Pad inputs and labels* batch = …`), the closing `*` marks exactly where the comment ends, and the comment goes on its own line above the code it describes, as the book prints it. Two comment lines merged into one italic span (`*# logit.size: … # Predict class …*`) are split back into two.
- **Blank lines.** Two blank lines go around top-level `def`/`class` and one between methods.

The output is stable: formatting already-formatted code changes nothing.

#### Blocks left unchanged

A block is reported and left as it was when:

- **It looks like program output** rather than code, for example `tensor(..., grad_fn=<AddmmBackward0>)` or a printed model such as `(tok_emb): Embedding(50257, 768)`.
- **Formatting would change tokens.** As a safety check, the result is tokenized again and compared with the original. Spacing, line breaks, `;` and trailing commas may differ; anything else means the formatter got it wrong, so the original is kept.

## Limitations and manual review

PDF extraction loses information that no tool can recover, so check the output. Using `--dry-run` first shows the scope of a run.

**All steps**

- **Code split across pages is not joined.** Each page is a separate file. A listing that continues on the next page can leave unclosed brackets, a block header with no body, or methods at the left margin because their `class` line is on the previous page.
- **Captions and callouts inside code**, such as `Listing 4.4`, or explanation text that the PDF mixed into the listing, stay where they are.

**Rust**

- **Comment boundaries in `keyword-density` and `bold-plain-comments` are guesses.** A `//` comment is assumed to run until the next statement keyword, a `}`, a `**` marker, another `//`, or the end of the text. This fails when the comment's prose contains such a keyword as an English word ("… even if the event was ready"). It also fails when the comment comes before a tail expression or a struct/enum field or variant rather than a `let`/`fn`/… statement. comprehensive-rust-google has many field doc comments, so expect some merged comment-and-code lines there.
- **Struct and enum literals** stay on one line inside their braces instead of one field per line as `rustfmt` would. This is cosmetic, not incorrect.
- **Wrong-language matches.** `keyword-density` can mistake other brace-heavy code for Rust. On the Python book, for example, it matches a class containing a `{ … }` dict comprehension. Use `--lang rust` only on Rust books. Because the Rust step runs first, `--lang rust,py` on a Python book would turn that paragraph into an `rs` block.
- **Leftover fragments.** A fragment of a listing split across pages, or a transcribed compiler error, can satisfy a profile's detection. Pinning `--profile` reduces surprises.

**JavaScript**

- **Comment boundaries are guesses** (see [Comment boundaries](#comment-boundaries)). A comment whose prose contains a call (`// call foo() to start`) ends too early, and one followed by a bare identifier (`// note x`) can swallow it.
- **Listings cut off at page breaks** leave unclosed brackets or start with `}`, `.then(` or `else`. They are formatted as far as possible and listed under "Review" because they don't compile.
- **The book's own placeholders**, such as `...` for omitted code, don't compile either, and neither do PDF artifacts like `'$$$$$'`.
- **Templates in other languages** (Pug, Handlebars) that start like JavaScript (`if (`) can be fenced as JavaScript.

Results:

| Book | JavaScript blocks | Compile | Don't compile |
|---|---|---|---|
| *Beginning Node.js* | 348 | 324 | 24 (page breaks or garbled source) |
| *Practical Node.js* | 310 | 226 | 84: 63 cut at page breaks, 11 using `...` placeholders, and 10 from garbled source, a Pug template or a misplaced comment boundary |

**Python**

- **Dedents are guesses.** In flattened text, a statement after a loop or `if` body may end up indented inside it, for example a `print(...)` after a `for` loop.
- **Prose that looks like Python**, for example a sentence starting with `If … :`, can get fenced as code by the clean step.

On *Build a Large Language Model (From Scratch)*, formatting raises the number of blocks that Python's parser accepts from 97 to 354 out of 390. The rest are printed output (left unchanged), code split across pages, or captions mixed into code. To find blocks that need attention, try running each ```` ```py ```` block through `python3 -c "import ast, sys; ast.parse(sys.stdin.read())"`.

## Tests

```bash
cd cleaner && npm test
```

There are 134 tests under [test/](test/), covering the Rust, JavaScript, Java, SQL and Python steps and the `.env` parser. The Python tests ([test/py/](test/py/)) cover books with bold keywords and italic comments. Each real-world bug found while building these steps has a regression test. For the JavaScript step they cover comment boundaries, Markdown escapes and bold markers, caption and prose splitting, automatic semicolon insertion, stray braces from page breaks, and stable output. For the Rust step they cover:

- an array-type `[i32; 3]` semicolon taken for a statement end
- `use a::{b, c};` import lists getting split up
- a `//` comment boundary landing inside a string literal
- two adjacent `//` comments merging into one line
- `**bold**` spans containing an inner `*`
- auto-detection ties
- false positives such as a stray JS snippet

## Adding a Rust profile for a new book

A profile is a plain object, registered in [rust/profiles/index.js](rust/profiles/index.js):

```js
{
  name: 'my-profile',
  description: '...',
  isCodeParagraph(line) { /* return true/false */ },
  stripPseudoMarkdown(line) { /* return { text, comments } */ },
  tieBreakScore(matchedLines) { /* optional: a number, higher = better fit */ },
}
```

- **`stripPseudoMarkdown`** returns the code without its Markdown as `text`. Each comment in it is replaced by a `\x00<index>\x00` placeholder, and the comment text goes in the parallel `comments` array (see `restorePlaceholders` in [rust/reflow.js](rust/reflow.js)). The shared `reflow()` then indents the code and puts each placeholder back on its own line.
- **Plain `//` comments:** if the source uses undelimited comments, reuse `makeSlashCommentExtractor` from [rust/slash-comments.js](rust/slash-comments.js).
- **`tieBreakScore`** only matters if your `isCodeParagraph` matches exactly the same lines as an existing profile. It is called only among profiles tied for the top match count.

## Using it as a library

```js
const { cleanMarkdown, looksLikePython } = require('./cleaner/py/clean-markdown.cjs');
const { formatPython, formatMarkdown } = require('./cleaner/py/format-python.cjs');
const { convertMarkdown, getProfile, detectProfile } = require('./cleaner/rust');
const { formatJsMarkdown } = require('./cleaner/js/markdown-js.cjs');
const { formatJs, formatJson } = require('./cleaner/js/format-js.cjs');
const { processDirectory } = require('./cleaner/index.cjs');

cleanMarkdown(markdownText);           // -> cleaned Markdown string
formatPython('import re x = 1', 88);   // -> { code, skipped? }
formatMarkdown(markdownText, 88);      // -> { text, blocks, changed, skipped: [{ line, reason }] }
convertMarkdown(markdownText, getProfile('bold-keywords')); // -> { text, changed, converted }
detectProfile([text1, text2]);         // -> { profile, scores, confident, tieBreak? }; throws if nothing matches
formatJs('var a={b:1}', 80);           // -> { code, valid } or { code, skipped }
formatJson('{ "a": 1 }', 80);          // -> { code, valid }, or null if not JSON
formatJsMarkdown(markdownText, 80);    // -> { text, fenced: { js, json, html, console }, blocks, formatted, skipped, invalid }
await processDirectory(['rust', 'js', 'clean', 'format'], 'markdown', 'markdown-cleaned',
  { width: 88, profile: 'bold-keywords', dryRun: false }); // profile omitted -> auto-detect
```

## Files

| File | Purpose |
|---|---|
| [index.cjs](index.cjs) | Command line, configuration, folder walking, and running the steps in order |
| [env.js](env.js) | Dependency-free `.env` parser |
| [rust/](rust/) | Rust step: brace-depth reflow ([reflow.js](rust/reflow.js)), `//` comment scanner ([slash-comments.js](rust/slash-comments.js)), conversion ([convert.js](rust/convert.js)) and [profiles/](rust/profiles/) |
| [js/markdown-js.cjs](js/markdown-js.cjs) | JavaScript step: finding code paragraphs, captions, fences, HTML and shell sessions |
| [js/format-js.cjs](js/format-js.cjs) | JavaScript and JSON formatter: tokenizer, comment boundaries, statement splitting, document printer, safety checks |
| [py/clean-markdown.cjs](py/clean-markdown.cjs) | Clean step |
| [py/format-python.cjs](py/format-python.cjs) | Format step: Python tokenizer, statement splitter, indentation and line wrapping |
| [test/](test/) | Tests (`npm test`) |
| [.env.example](.env.example) | Template for `cleaner/.env` |
