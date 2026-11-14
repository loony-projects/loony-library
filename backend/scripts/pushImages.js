// Uploads the images and covers already on this machine (backend/data/images,
// backend/data/covers) to the loony-s3 bucket in the S3_* settings, whatever
// IMAGE_STORE is now - so the bucket can be filled before switching to it.
// Files already there with the same bytes are skipped. Nothing is deleted.
//
// Usage: npm run images:push [-- --dry-run]   (or ./loony images push)
import fs from "node:fs";
import path from "node:path";
import { AREAS, DATA_DIR, createImageStore, settings, safeName } from "../src/imageStore.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unknown = args.filter((a) => a !== "--dry-run");
if (unknown.length) {
  console.error(`Unknown option ${unknown[0]}. Usage: ./loony images push [--dry-run]`);
  process.exit(2);
}

function files(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".")) return [];
    const name = prefix + e.name;
    if (e.isDirectory()) return files(path.join(dir, e.name), `${name}/`);
    return e.isFile() ? [name] : [];
  });
}

let store;
try {
  store = createImageStore({ ...settings(), IMAGE_STORE: "s3" });
} catch (e) {
  console.error(`${dryRun ? "Note" : "Error"}: ${e.message}`);
  if (!dryRun) process.exit(1);
}

let failed = 0;
for (const area of AREAS) {
  const dir = path.join(DATA_DIR, area);
  const names = files(dir);
  const bad = names.filter((n) => !safeName(n));
  const todo = names.filter((n) => safeName(n));
  const bytes = todo.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  console.log(`${area}: ${todo.length} file(s), ${(bytes / 1048576).toFixed(1)} MB in ${dir} -> ${store ? store.where(area) : "(no bucket set)"}`);
  for (const n of bad) console.log(`  skipped (unusable name): ${n}`);
  if (dryRun) continue;

  const counts = { stored: 0, unchanged: 0 };
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const name = todo[next++];
      try {
        counts[await store.put(area, name, path.join(dir, name))]++;
      } catch (e) {
        failed++;
        console.error(`  failed: ${name}: ${e.name === "NoSuchBucket" ? `bucket "${store.bucket}" doesn't exist - create it first` : e.message || e.name}`);
        if (e.name === "NoSuchBucket" || e.name === "InvalidAccessKeyId" || e.name === "SignatureDoesNotMatch") next = todo.length;
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`  uploaded ${counts.stored}, already there ${counts.unchanged}`);
}
if (dryRun) console.log("Dry run: nothing uploaded.");
if (failed) {
  console.error(`${failed} file(s) failed.`);
  process.exit(1);
}
