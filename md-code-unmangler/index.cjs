#!/usr/bin/env node
'use strict';

/**
 * Cleans the Markdown produced by PDF extraction. Originals are never overwritten.
 *   node cleaner/index.cjs --lang rust   markdown/         -> markdown-cleaned/ (```rs blocks)
 *   node cleaner/index.cjs --lang js     markdown/         -> markdown-cleaned/ (```js blocks)
 *   node cleaner/index.cjs --lang java   markdown/         -> markdown-cleaned/ (```java blocks)
 *   node cleaner/index.cjs --lang sql    markdown/         -> markdown-cleaned/ (```sql blocks)
 *   node cleaner/index.cjs --lang py     markdown/         -> markdown-cleaned/ (```py blocks: clean, then format)
 *   node cleaner/index.cjs --clean       markdown/         -> markdown-cleaned/ (only the first Python step)
 *   node cleaner/index.cjs --format      markdown-cleaned/ -> markdown-formatted/ (only the second Python step)
 * Steps always run in the order rust, js, java, sql, clean, format, in one pass per file.
 * --path DIR / --out DIR (or positional [input] [output]) override the defaults;
 * without --out, the output folder is created next to the input folder.
 * Defaults can also come from environment variables or a .env file (see README).
 * No dependencies required. Run with Node.js 18 or newer.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadEnvFile } = require('./env');

// Each language's modules are loaded only when one of its steps runs, so
// `--lang rust` loads only ./rust, `--lang js` only ./js, and so on.
const rust = () => require('./rust');
const js = () => require('./js/markdown-js.cjs');
const java = () => require('./java/markdown-java.cjs');
const sql = () => require('./sql/markdown-sql.cjs');
const pyClean = () => require('./py/clean-markdown.cjs');
const pyFormat = () => require('./py/format-python.cjs');

const USAGE = `Usage: node cleaner/index.cjs --lang LANG [options]
Languages (the book's code language; --lang rust,js or a repeated --lang runs several):
  --lang rust          Reflow squashed Rust paragraphs into \`\`\`rs blocks (aliases: rs)
  --lang js            Fence and prettify JavaScript into \`\`\`js blocks, plus JSON, HTML and
                       shell sessions (aliases: javascript, node)
  --lang java          Fence and format Java into \`\`\`java blocks
  --lang sql           Fence and format PostgreSQL into \`\`\`sql blocks, removing listing line numbers
                       (aliases: postgres, postgresql, pg, psql)
  --lang py            Fence and prettify Python into \`\`\`py blocks: --clean, then --format (aliases: python)
Python steps on their own:
  --clean              Remove \\_ escapes and fence Python paragraphs (markdown -> markdown-cleaned)
  --format             Prettify \`\`\`py blocks (markdown-cleaned -> markdown-formatted)
Options:
  --path DIR           Input folder, absolute or relative to $HOME (default ~/markdown, or ~/markdown-cleaned
                       for --format); ~ and $HOME are expanded
  --out DIR            Output folder (default: next to the input, DIR-cleaned or DIR-formatted)
  --width N            Line width (default 88 for Python, 80 for JavaScript, Java and SQL)
  --profile NAME       Rust profile for --lang rust instead of auto-detecting (see --list-profiles)
  --list-profiles      List the Rust profiles and exit
  --dry-run            Report what would change without writing anything
  --config FILE        Read defaults from this .env-style FILE instead of cleaner/.env
Folders may also be given positionally: [input] [output].
Environment variables (a flag wins over them, and they win over the .env file):
  CLEANER_LANG, CLEANER_PATH, CLEANER_OUT, CLEANER_WIDTH, CLEANER_PROFILE`;

const STEP_ORDER = ['rust', 'js', 'java', 'sql', 'clean', 'format'];

// Each --lang value and the steps it runs; the steps produce ```rs, ```js, ```java, ```sql and ```py blocks.
const LANGUAGES = {
  rust: ['rust'], rs: ['rust'],
  js: ['js'], javascript: ['js'], node: ['js'],
  java: ['java'],
  sql: ['sql'], postgres: ['sql'], postgresql: ['sql'], pg: ['sql'], psql: ['sql'],
  py: ['clean', 'format'], python: ['clean', 'format'],
};

function stepsForLanguages(values) {
  const steps = new Set();
  for (const value of values.flatMap(v => v.split(',')).map(v => v.trim().toLowerCase()).filter(Boolean)) {
    if (!LANGUAGES[value]) throw new Error(`Unknown language "${value}". Use one of: rust, js, java, sql, py.`);
    LANGUAGES[value].forEach(step => steps.add(step));
  }
  return steps;
}

const STEPS = {
  rust: {
    run(text, options) {
      if (!options.rustProfile) return { text, changed: 0, items: 0, skipped: [] };
      const result = rust().convertMarkdown(text, options.rustProfile);
      return { text: result.text, changed: result.converted, items: result.changed ? 1 : 0, skipped: [] };
    },
    report: (t, options) => [options.rustProfile
      ? `Converted ${t.changed} Rust code paragraphs in ${t.items} files (profile: ${options.rustProfile.name}).`
      : 'Rust: no code paragraphs matched any profile; nothing converted.'],
  },
  js: {
    run(text, options) {
      const result = js().formatJsMarkdown(text, options.width ?? 80);
      const fenced = Object.values(result.fenced).reduce((a, b) => a + b, 0);
      return {
        text: result.text, changed: result.formatted, items: result.blocks,
        skipped: [...result.skipped, ...result.invalid], counts: { ...result.fenced, fenced },
      };
    },
    report: t => {
      const { fenced = 0, ...byKind } = t.counts;
      const kinds = Object.entries(byKind).map(([kind, n]) => `${n} ${kind}`).join(', ');
      return [`Fenced ${fenced} code paragraphs${kinds ? ` (${kinds})` : ''}; reformatted ${t.changed} of ${t.items} existing code blocks.`,
        ...(t.skipped.length ? [`Review ${t.skipped.length} blocks:\n  ${t.skipped.join('\n  ')}`] : []),
        'Statement breaks and comment ends in flattened code are reconstructed heuristically; review the result.'];
    },
  },
  java: {
    run(text, options) {
      const result = java().formatJavaMarkdown(text, options.width ?? 80);
      return { text: result.text, changed: result.fenced, items: 0, skipped: result.skipped };
    },
    report: t => [`Fenced ${t.changed} Java paragraphs.`,
      ...(t.skipped.length ? [`Review ${t.skipped.length} paragraphs:\n  ${t.skipped.join('\n  ')}`] : []),
      'Where flattened // comments end is guessed; review the result.'],
  },
  sql: {
    run(text, options) {
      const result = sql().formatSqlMarkdown(text, options.width ?? 80);
      return { text: result.text, changed: result.fenced, items: result.sessions, skipped: result.skipped,
        counts: { removed: result.removed } };
    },
    report: t => [`Fenced ${t.changed} SQL paragraphs and removed ${t.counts.removed || 0} listing line numbers from them.`,
      ...(t.items ? [`Left ${t.items} psql sessions (queries mixed with their output) as they were.`] : []),
      ...(t.skipped.length ? [`Review ${t.skipped.length} paragraphs:\n  ${t.skipped.join('\n  ')}`] : []),
      'Listing line numbers and statement layout are reconstructed heuristically; review the result.'],
  },
  clean: {
    run(text) {
      const cleaned = pyClean().cleanMarkdown(text);
      return { text: cleaned, changed: cleaned !== text ? 1 : 0, items: 1, skipped: [] };
    },
    report: t => [`Cleaned ${t.changed} of ${t.items} Markdown files.`],
  },
  format: {
    run(text, options) {
      const result = pyFormat().formatMarkdown(text, options.width ?? 88);
      return { text: result.text, changed: result.changed, items: result.blocks, skipped: result.skipped };
    },
    report: t => [
      `Formatted ${t.changed} of ${t.items} Python blocks.`,
      ...(t.skipped.length ? [`Left ${t.skipped.length} blocks unchanged:\n  ${t.skipped.join('\n  ')}`] : []),
      'Indentation of flattened code is reconstructed heuristically; review the result.'],
  },
};

// Use the given Rust profile, or pick the one matching the most paragraphs.
function chooseRustProfile(name, contents) {
  const { getProfile, detectProfile } = rust();
  if (name) return getProfile(name);
  let detection;
  try {
    detection = detectProfile(contents);
  } catch {
    return null; // No paragraph matched any profile.
  }
  const summary = detection.scores.map(s => `${s.profile.name}=${s.count}`).join(', ');
  console.log(`Auto-detected Rust profile: ${detection.profile.name} (${summary})`);
  if (detection.tieBreak) {
    const ties = detection.tieBreak.map(t => `${t.profile.name}=${t.score}`).join(', ');
    console.log(`Tied on match count; broke the tie by comment style (${ties})`);
  }
  if (!detection.confident) console.log('Warning: detection was not clear-cut; pass --profile to be explicit.');
  return detection.profile;
}

async function listFiles(root, relative = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, rel));
    else if (entry.isFile()) files.push(rel); // Do not follow symlinks.
  }
  return files;
}

// Copy input to output, passing each .md file through every step in order and
// copying everything else unchanged. Only the final text is written.
async function processDirectory(stepNames, inputDir, outputDir, options = {}) {
  const steps = STEP_ORDER.filter(name => stepNames.includes(name));
  const input = await fs.realpath(path.resolve(inputDir)).catch(() => null);
  if (!input || !(await fs.stat(input)).isDirectory()) {
    throw new Error(`Input folder not found: ${path.resolve(inputDir)}\n(set it with --path or CLEANER_PATH; relative folders are found from $HOME)`);
  }
  // Compare real paths before creating anything, so a bad output folder is
  // never created inside the input. The output may not exist yet: resolve its
  // nearest existing ancestor.
  let existing = path.resolve(outputDir);
  while (!(await fs.stat(existing).catch(() => null)) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const output = path.join(await fs.realpath(existing), path.relative(existing, path.resolve(outputDir)));
  if (input === output || input.startsWith(output + path.sep) || output.startsWith(input + path.sep)) {
    const relation = input === output ? 'is the same folder as' : output.startsWith(input + path.sep) ? 'is inside' : 'contains';
    throw new Error(`The output folder ${output} ${relation} the input folder ${input}; the input is never overwritten.\n`
      + `Give --out (or CLEANER_OUT) another folder, or leave it unset to write to ${defaultOutput(input, true)}.`);
  }
  if (!options.dryRun) await fs.mkdir(output, { recursive: true });

  const files = await listFiles(input);
  const markdown = files.filter(rel => /\.md$/i.test(rel));
  const contents = new Map();
  for (const rel of markdown) contents.set(rel, await fs.readFile(path.join(input, rel), 'utf8'));
  const runOptions = { ...options };
  if (steps.includes('rust')) runOptions.rustProfile = chooseRustProfile(options.profile, [...contents.values()]);

  const totals = Object.fromEntries(steps.map(name => [name, { items: 0, changed: 0, skipped: [], counts: {} }]));
  const changedFiles = [];
  for (const rel of files) {
    const target = path.join(output, rel);
    if (!options.dryRun) await fs.mkdir(path.dirname(target), { recursive: true });
    if (!contents.has(rel)) {
      if (!options.dryRun) await fs.copyFile(path.join(input, rel), target);
      continue;
    }
    let text = contents.get(rel);
    for (const name of steps) {
      const result = STEPS[name].run(text, runOptions);
      text = result.text;
      totals[name].items += result.items;
      totals[name].changed += result.changed;
      totals[name].skipped.push(...result.skipped.map(s => `${rel}:${s.line} (${s.reason})`));
      for (const [kind, n] of Object.entries(result.counts || {})) totals[name].counts[kind] = (totals[name].counts[kind] || 0) + n;
    }
    if (text !== contents.get(rel)) changedFiles.push(rel);
    if (!options.dryRun) await fs.writeFile(target, text);
  }

  if (options.dryRun) {
    console.log(`Dry run: ${changedFiles.length} of ${markdown.length} Markdown files in ${input} would change`
      + ` (output would go to ${output}).`);
    for (const rel of changedFiles) console.log(`  ${rel}`);
  } else console.log(`Processed ${markdown.length} Markdown files from ${input} into ${output}`);
  for (const name of steps) console.log(STEPS[name].report(totals[name], runOptions).join('\n'));
  return { files: markdown.length, changedFiles, totals };
}

// Folders are always found from $HOME: `~` and `$HOME` are expanded, and a
// relative folder is relative to $HOME, wherever the command runs from.
function resolveFolder(folder) {
  const home = process.env.HOME || os.homedir();
  const expanded = folder.replace(/^~(?=$|[\\/])/, home).replace(/\$\{HOME\}|\$HOME\b/g, home);
  return path.resolve(home, expanded);
}

// Defaults from the real environment, then the .env file.
async function loadDefaults(configFile) {
  const file = path.resolve(configFile || path.join(__dirname, '.env'));
  if (configFile && !(await fs.stat(file).catch(() => null))) throw new Error(`Config file not found: ${file}`);
  const fromFile = loadEnvFile(file);
  // Names used by the standalone rust-code-unmangler are still understood.
  const aliases = { CLEANER_PATH: 'RUST_UNMANGLER_DIR', CLEANER_PROFILE: 'RUST_UNMANGLER_PROFILE' };
  const defaults = {};
  for (const [option, key] of [['lang', 'CLEANER_LANG'], ['path', 'CLEANER_PATH'], ['out', 'CLEANER_OUT'], ['width', 'CLEANER_WIDTH'], ['profile', 'CLEANER_PROFILE']]) {
    const names = [key, aliases[key]].filter(Boolean);
    const real = names.map(name => process.env[name]).find(Boolean);
    const saved = names.map(name => fromFile[name]).find(Boolean);
    if (real) defaults[option] = real;
    else if (saved) defaults[option] = saved;
  }
  return defaults;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
  if (args.includes('--list-profiles')) {
    console.log('Rust profiles (for --lang rust --profile NAME):');
    for (const p of rust().PROFILES) console.log(`  ${p.name} - ${p.description}`);
    return;
  }
  const flags = new Set(), positional = [], options = {}, languages = [];
  for (let a = 0; a < args.length; a++) {
    // Accept both `--name value` and `--name=value`.
    const option = args[a].match(/^--(lang|width|path|out|profile|config)(?:=(.*))?$/);
    if (['--clean', '--format'].includes(args[a])) flags.add(args[a].slice(2));
    else if (args[a] === '--dry-run') options.dryRun = true;
    else if (option) {
      const value = option[2] ?? args[++a];
      if (!value || value.startsWith('--')) throw new Error(`--${option[1]} needs a value.\n\n${USAGE}`);
      if (option[1] === 'lang') languages.push(value);
      else options[option[1]] = value;
    } else if (['--rust', '--js'].includes(args[a])) {
      throw new Error(`${args[a]} is now --lang ${args[a].slice(2)}.\n\n${USAGE}`);
    } else if (args[a].startsWith('-')) throw new Error(`Unknown option ${args[a]}\n\n${USAGE}`);
    else positional.push(args[a]);
  }
  if (positional.length > 2) throw new Error('Expected at most an input and output directory.');
  if ((options.path && positional[0]) || (options.out && positional[1])) {
    throw new Error('Give each folder either as --path/--out or as a positional argument, not both.');
  }
  const defaults = await loadDefaults(options.config);
  if (!languages.length && !flags.size && defaults.lang) languages.push(defaults.lang);
  stepsForLanguages(languages).forEach(step => flags.add(step));
  if (!flags.size) throw new Error(`Choose a language with --lang rust, js, java, sql or py.\n\n${USAGE}`);
  // Without --width, each formatter uses its own default (Python 88, JavaScript 80).
  const width = options.width ?? defaults.width;
  if (width !== undefined && (!Number.isInteger(Number(width)) || Number(width) < 20)) {
    throw new Error('--width must be an integer of at least 20.');
  }
  const profile = options.profile || (flags.has('rust') ? defaults.profile : undefined);
  if (profile && flags.has('rust')) rust().getProfile(profile); // Fail early on an unknown name.

  // Every language starts from raw extraction output; --format alone from cleaned files.
  const fromRaw = flags.has('rust') || flags.has('js') || flags.has('java') || flags.has('sql') || flags.has('clean');
  const input = resolveFolder(options.path || positional[0] || defaults.path || (fromRaw ? 'markdown' : 'markdown-cleaned'));
  const outFolder = options.out || positional[1] || defaults.out;
  const output = outFolder ? resolveFolder(outFolder) : defaultOutput(input, fromRaw);
  await processDirectory([...flags], input, output, {
    width: width === undefined ? undefined : Number(width), profile, dryRun: options.dryRun,
  });
}

// The output goes next to the input: markdown -> markdown-cleaned with --lang or
// --clean, markdown-cleaned -> markdown-formatted with --format alone.
function defaultOutput(input, fromRaw) {
  const resolved = path.resolve(input);
  const base = path.basename(resolved).replace(/-cleaned$/, '');
  return path.join(path.dirname(resolved), `${base}-${fromRaw ? 'cleaned' : 'formatted'}`);
}

module.exports = { processDirectory, resolveFolder, STEPS };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
