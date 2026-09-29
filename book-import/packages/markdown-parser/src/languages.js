// Stage 6a - language normalization. Maps a code fence's language label to
// a canonical language id, without ever rewriting the label itself (the
// code block keeps `lang` exactly as written; the id goes in a separate
// field). Extend with registerLanguage() - aliases are case-insensitive.
//
// Recognizing a label says nothing about whether the snippet can be
// analysed: that depends on an analyzer being registered for the id (see
// analysis/index.js), and then on the analysis of that specific snippet.

const languages = new Map(); // id -> { id, name, aliases }
const aliasIndex = new Map(); // lowercase alias -> id

export function registerLanguage({ id, name = id, aliases = [] }) {
  if (!id) throw new Error("registerLanguage: id is required");
  const existing = languages.get(id);
  const entry = existing ?? { id, name, aliases: [] };
  for (const alias of [id, ...aliases]) {
    const key = alias.toLowerCase();
    const owner = aliasIndex.get(key);
    if (owner && owner !== id) throw new Error(`registerLanguage: alias "${alias}" already belongs to "${owner}"`);
    aliasIndex.set(key, id);
    if (!entry.aliases.includes(key)) entry.aliases.push(key);
  }
  languages.set(id, entry);
  return entry;
}

export function getLanguage(id) {
  return languages.get(id) ?? null;
}

export function listLanguages() {
  return [...languages.values()];
}

/**
 * Splits a fence's info string as remark reports it (`lang` = first word,
 * `meta` = the rest) into the language label and any attributes attached
 * to it:
 *   ```js title="a.js"     -> label "js", meta 'title="a.js"'
 *   ```rust,editable       -> label "rust", attributes ["editable"]  (mdBook/rustdoc)
 *   ```{.python}           -> label "python"                         (Pandoc)
 *   ```language-go         -> label "go"
 */
export function parseFenceInfo(lang, meta) {
  if (!lang) return { label: null, attributes: [], meta: meta || null };
  let label = lang.trim();
  if (label.startsWith("{") && label.endsWith("}")) label = label.slice(1, -1).trim();
  if (label.startsWith(".")) label = label.slice(1);
  if (/^language-/i.test(label)) label = label.slice("language-".length);
  const [first, ...attributes] = label.split(",").map((s) => s.trim());
  return { label: first || null, attributes: attributes.filter(Boolean), meta: meta || null };
}

export function normalizeLanguage(label) {
  if (!label) return null;
  return aliasIndex.get(label.toLowerCase()) ?? null;
}

// Built-in registry. The ids match highlight.js language names, so the
// frontend can highlight by id directly.
const BUILTIN = [
  { id: "javascript", name: "JavaScript", aliases: ["js", "mjs", "cjs", "jsx", "node"] },
  { id: "typescript", name: "TypeScript", aliases: ["ts", "tsx", "mts", "cts"] },
  { id: "c", name: "C", aliases: ["h"] },
  { id: "cpp", name: "C++", aliases: ["c++", "cc", "cxx", "hpp", "hxx", "hh"] },
  { id: "go", name: "Go", aliases: ["golang"] },
  { id: "rust", name: "Rust", aliases: ["rs"] },
  { id: "java", name: "Java" },
  { id: "python", name: "Python", aliases: ["py", "python3", "py3"] },
  { id: "kotlin", name: "Kotlin", aliases: ["kt", "kts"] },
  { id: "csharp", name: "C#", aliases: ["cs", "c#"] },
  { id: "swift", name: "Swift" },
  { id: "ruby", name: "Ruby", aliases: ["rb"] },
  { id: "php", name: "PHP" },
  { id: "bash", name: "Shell", aliases: ["sh", "shell", "zsh", "console", "shell-session"] },
  { id: "sql", name: "SQL", aliases: ["psql", "postgresql", "pgsql"] },
  { id: "json", name: "JSON", aliases: ["jsonc", "json5"] },
  { id: "yaml", name: "YAML", aliases: ["yml"] },
  { id: "toml", name: "TOML" },
  { id: "xml", name: "HTML/XML", aliases: ["html", "xhtml", "svg"] },
  { id: "css", name: "CSS" },
  { id: "markdown", name: "Markdown", aliases: ["md"] },
  { id: "diff", name: "Diff", aliases: ["patch"] },
  { id: "plaintext", name: "Plain text", aliases: ["text", "txt", "plain"] },
];
for (const language of BUILTIN) registerLanguage(language);
