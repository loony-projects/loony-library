// Where book images and covers live: the backend's own disk (the default),
// or a bucket in loony-s3 (IMAGE_STORE=s3). Either way they are served at the
// same URLs (/images/<book-slug>/<file>, /covers/<file>) and named the same in
// the database, so switching stores changes no book data.
//
// In the bucket, an area is a key prefix: images/<book-slug>/<file> and
// covers/<file>. loony-s3 has no public reads, so browsers never fetch from it
// directly: the backend signs each request and streams the object back.
//
// Settings: IMAGE_STORE (disk | s3), and for s3 S3_ENDPOINT, S3_REGION,
// S3_BUCKET, S3_CLIENT_ID, S3_CLIENT_SECRET. They come from the
// environment, else from backend/.env - so the book loader, which runs from
// book-import/, puts images wherever the backend reads them.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(BACKEND_DIR, "data");
export const AREAS = ["images", "covers"];
const SETTINGS = ["IMAGE_STORE", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_CLIENT_ID", "S3_CLIENT_SECRET"];

const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};
export const contentType = (name) => TYPES[path.extname(name).toLowerCase()] || "application/octet-stream";

export function settings(env = process.env) {
  const s = Object.fromEntries(SETTINGS.map((k) => [k, env[k]]));
  if (SETTINGS.some((k) => s[k] === undefined)) {
    try {
      const file = dotenv.parse(fs.readFileSync(path.join(BACKEND_DIR, ".env")));
      for (const k of SETTINGS) if (s[k] === undefined && file[k] !== undefined) s[k] = file[k];
    } catch {
      /* no backend/.env */
    }
  }
  return s;
}

// A name inside an area: "<book-slug>/<file>" or "<file>". Anything that could
// leave the area (.., absolute, backslashes, empty segments) is refused.
export function safeName(name) {
  if (typeof name !== "string" || !name || name.length > 512 || /[\0\\]/.test(name) || name.startsWith("/")) return null;
  const parts = name.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  return name;
}

function check(area, name) {
  if (!AREAS.includes(area)) throw new Error(`Unknown image area: ${area}`);
  if (!safeName(name)) throw new Error(`Invalid image name: ${name}`);
}

export class DiskStore {
  kind = "disk";
  constructor(root = DATA_DIR) {
    this.root = root;
  }
  where(area) {
    return path.join(this.root, area);
  }
  // Puts bytes (a Buffer) or a local file (a path). Returns "stored" or "unchanged".
  async put(area, name, source) {
    check(area, name);
    const dest = path.join(this.root, area, name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (typeof source === "string") {
      if (path.resolve(source) === path.resolve(dest)) return "unchanged";
      await fsp.copyFile(source, dest);
    } else await fsp.writeFile(dest, source);
    return "stored";
  }
  // The bytes, or null when there's no such image.
  async get(area, name) {
    if (!AREAS.includes(area) || !safeName(name)) return null;
    try {
      return await fsp.readFile(path.join(this.root, area, name));
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "EISDIR" || e.code === "ENOTDIR") return null;
      throw e;
    }
  }
  serve(area) {
    return express.static(path.join(this.root, area));
  }
}

class S3Store {
  kind = "s3";
  #client;
  constructor(s) {
    const missing = SETTINGS.slice(1).filter((k) => !s[k]);
    if (missing.length) throw new Error(`IMAGE_STORE=s3 needs ${missing.join(", ")} (see backend/.env.example)`);
    this.s = s;
    this.bucket = s.S3_BUCKET;
  }
  where(area) {
    return `${this.s.S3_ENDPOINT.replace(/\/+$/, "")}/${this.bucket}/${area}/`;
  }
  async client() {
    if (!this.#client) {
      const sdk = await import("@aws-sdk/client-s3");
      this.sdk = sdk;
      this.#client = new sdk.S3Client({
        endpoint: this.s.S3_ENDPOINT,
        region: this.s.S3_REGION,
        forcePathStyle: true, // loony-s3 has no virtual-hosted-style routing
        credentials: { accessKeyId: this.s.S3_CLIENT_ID, secretAccessKey: this.s.S3_CLIENT_SECRET },
        // Checksums only when an operation requires one: plain bodies with a
        // known length, which every S3-compatible server accepts.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    }
    return this.#client;
  }
  async send(command, input) {
    const client = await this.client();
    return client.send(new this.sdk[command](input));
  }
  async put(area, name, source) {
    check(area, name);
    const body = typeof source === "string" ? await fsp.readFile(source) : source;
    const Key = `${area}/${name}`;
    const md5 = createHash("md5").update(body).digest("hex");
    try {
      const head = await this.send("HeadObjectCommand", { Bucket: this.bucket, Key });
      if (head.ContentLength === body.length && head.ETag?.replace(/"/g, "") === md5) return "unchanged";
    } catch (e) {
      if (!notFound(e)) throw e;
    }
    await this.send("PutObjectCommand", { Bucket: this.bucket, Key, Body: body, ContentType: contentType(name), ContentLength: body.length });
    return "stored";
  }
  async get(area, name) {
    if (!AREAS.includes(area) || !safeName(name)) return null;
    try {
      const r = await this.send("GetObjectCommand", { Bucket: this.bucket, Key: `${area}/${name}` });
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  // GET and HEAD of /<area>/<name>, streamed from the bucket. An unknown name
  // falls through (next()) to the app's 404, as express.static does.
  serve(area) {
    return async (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      let name;
      try {
        name = safeName(decodeURIComponent(req.path.replace(/^\/+/, "")));
      } catch {
        name = null;
      }
      if (!name) return next();
      const Key = `${area}/${name}`;
      let r;
      try {
        r = await this.send(req.method === "HEAD" ? "HeadObjectCommand" : "GetObjectCommand", { Bucket: this.bucket, Key });
      } catch (e) {
        if (notFound(e)) return next();
        console.error(`image store: ${req.method} ${Key}:`, e.name || e);
        return res.status(502).json({ error: "Image store unavailable" });
      }
      res.setHeader("Content-Type", r.ContentType || contentType(name));
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (r.ETag) res.setHeader("ETag", r.ETag);
      if (r.LastModified) res.setHeader("Last-Modified", r.LastModified.toUTCString());
      // loony-s3 doesn't answer If-None-Match itself, so it's checked here.
      const inm = req.headers["if-none-match"];
      if (r.ETag && inm && inm.split(",").some((t) => t.trim() === "*" || t.trim().replace(/^W\//, "") === r.ETag)) {
        r.Body?.destroy?.();
        return res.status(304).end();
      }
      if (r.ContentLength !== undefined) res.setHeader("Content-Length", r.ContentLength);
      if (req.method === "HEAD") return res.end();
      r.Body.on("error", (e) => {
        console.error(`image store: streaming ${Key}:`, e.name || e);
        res.destroy(e);
      });
      r.Body.pipe(res);
    };
  }
}

const notFound = (e) => (e?.name !== "NoSuchBucket" && (e?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(e?.name)));

export function createImageStore(s = settings()) {
  const kind = (s.IMAGE_STORE || "disk").trim().toLowerCase();
  if (kind === "disk") return new DiskStore();
  if (kind === "s3") return new S3Store(s);
  throw new Error(`IMAGE_STORE must be "disk" or "s3", not "${s.IMAGE_STORE}"`);
}

let store;
// The store the settings name, made once.
export function imageStore() {
  return (store ??= createImageStore());
}
