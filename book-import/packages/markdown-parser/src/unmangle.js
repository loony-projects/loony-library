import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findManifest, ManifestError } from "./manifest.js";

// Books whose code came out of the PDF as plain paragraphs say so in their
// book.json - "unmangle": "py" (or rust, js, java, sql) - and every import
// command regenerates markdown-cleaned/ from markdown/ with the repo's
// md-code-unmangler before parsing it. markdown/ is never changed.
const UNMANGLER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "md-code-unmangler", "index.cjs");
export const UNMANGLED_DIR = "markdown-cleaned";

// Returns null when the book doesn't ask for it, else { output, summary }.
export function unmangleBook(dir) {
  const manifest = findManifest(dir);
  const lang = manifest?.data.unmangle;
  if (!lang) return null;
  if (manifest.data.source && manifest.data.source !== UNMANGLED_DIR) {
    throw new ManifestError(`${manifest.file}: "unmangle" writes ${UNMANGLED_DIR}/ and reads it - drop "source" or set it to "${UNMANGLED_DIR}"`);
  }
  if (!fs.existsSync(UNMANGLER)) throw new ManifestError(`${manifest.file} asks for "unmangle", but md-code-unmangler isn't at ${UNMANGLER}`);
  const input = path.join(manifest.bookDir, "markdown");
  const output = path.join(manifest.bookDir, UNMANGLED_DIR);
  if (!fs.existsSync(input)) throw new ManifestError(`${manifest.file}: "unmangle" needs the original pages in ${input}`);
  // Generated: start clean, so pages since removed from markdown/ don't linger.
  fs.rmSync(output, { recursive: true, force: true });
  let log;
  try {
    log = execFileSync(process.execPath, [UNMANGLER, "--lang", lang, "--path", input, "--out", output], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
  } catch (error) {
    throw new ManifestError(`md-code-unmangler failed on ${input}:\n${error.stderr || error.stdout || error.message}`);
  }
  const summary = log.split("\n").filter((l) => /✔ (formatted|cleaned)|blocks left unchanged/.test(l)).map((l) => l.trim().replace(/\s+[█░]+\s+\d+%$/, ""));
  return { output, summary };
}
