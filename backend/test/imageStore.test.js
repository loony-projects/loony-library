// The image store: names it accepts, the disk store, and the s3 store against
// a small in-memory stand-in for loony-s3's API (path-style PUT/GET/HEAD) -
// the real server is checked by hand, see docs/dev_setup.md.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { DiskStore, createImageStore, safeName, contentType } from "../src/imageStore.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

// Objects in a Map; the bucket "library" exists, any other doesn't. Keys
// under images/broken/ answer 500.
async function stubS3() {
  const objects = new Map();
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const [, bucket, ...rest] = url.pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      requests.push({ method: req.method, key, auth: req.headers.authorization || "" });
      const xmlError = (status, code) => {
        res.writeHead(status, { "Content-Type": "application/xml" });
        res.end(req.method === "HEAD" ? undefined : `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
      };
      if (bucket !== "library") return xmlError(404, "NoSuchBucket");
      if (key.startsWith("images/broken/")) return xmlError(500, "InternalError");
      if (req.method === "PUT") {
        const body = Buffer.concat(chunks);
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        objects.set(key, { body, etag, type: req.headers["content-type"], modified: new Date("2026-11-01T00:00:00Z") });
        res.writeHead(200, { ETag: etag });
        return res.end();
      }
      const o = objects.get(key);
      if (!o) return xmlError(404, "NoSuchKey");
      res.writeHead(200, { "Content-Type": o.type, "Content-Length": o.body.length, ETag: o.etag, "Last-Modified": o.modified.toUTCString() });
      res.end(req.method === "HEAD" ? undefined : o.body);
    });
  });
  const endpoint = await listen(server);
  return { objects, requests, endpoint, close: () => server.close() };
}

const s3Settings = (endpoint, bucket = "library") => ({
  IMAGE_STORE: "s3",
  S3_ENDPOINT: endpoint,
  S3_REGION: "us-east-1",
  S3_BUCKET: bucket,
  S3_CLIENT_ID: "TESTKEY",
  S3_CLIENT_SECRET: "testsecret",
});

async function serveApp(store) {
  const app = express();
  app.use("/images", store.serve("images"));
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  const server = http.createServer(app);
  return { base: await listen(server), close: () => server.close() };
}

test("names that stay inside an area", () => {
  for (const ok of ["book/_page_0_Picture_1.png", "cover.webp", "a/b/c.png"]) assert.equal(safeName(ok), ok);
  for (const bad of ["", "/etc/passwd", "../x.png", "book/../../x", "a//b", "a/./b", "a\\b", "x\0.png", null]) assert.equal(safeName(bad), null, String(bad));
  assert.equal(contentType("x.JPG"), "image/jpeg");
  assert.equal(contentType("x.svg"), "image/svg+xml");
});

test("settings: disk by default, refuses an unknown store or missing s3 settings", () => {
  assert.equal(createImageStore({}).kind, "disk");
  assert.throws(() => createImageStore({ IMAGE_STORE: "ftp" }), /disk" or "s3/);
  assert.throws(() => createImageStore({ IMAGE_STORE: "s3", S3_ENDPOINT: "http://x" }), /S3_REGION, S3_BUCKET/);
});

test("s3 store: put, skip unchanged, get, serve with 304 and 404", async () => {
  const s3 = await stubS3();
  const store = createImageStore(s3Settings(s3.endpoint));
  const app = await serveApp(store);
  try {
    assert.equal(await store.put("images", "book/a.png", PNG), "stored");
    const o = s3.objects.get("images/book/a.png");
    assert.deepEqual(o.body, PNG);
    assert.equal(o.type, "image/png");
    assert.match(s3.requests.at(-1).auth, /^AWS4-HMAC-SHA256 Credential=TESTKEY\//, "requests are SigV4-signed");

    const puts = () => s3.requests.filter((r) => r.method === "PUT").length;
    const before = puts();
    assert.equal(await store.put("images", "book/a.png", PNG), "unchanged");
    assert.equal(puts(), before, "same bytes aren't uploaded again");

    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "imgstore-")), "b.jpg");
    await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff]));
    assert.equal(await store.put("images", "book/b.jpg", file), "stored");
    assert.equal(s3.objects.get("images/book/b.jpg").type, "image/jpeg");

    assert.deepEqual(await store.get("images", "book/a.png"), PNG);
    assert.equal(await store.get("images", "book/none.png"), null);
    assert.equal(await store.get("images", "../secret"), null);
    await assert.rejects(store.put("images", "../x.png", PNG), /Invalid image name/);

    let r = await fetch(`${app.base}/images/book/a.png`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("content-length"), String(PNG.length));
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400");
    assert.equal(r.headers.get("last-modified"), "Sun, 01 Nov 2026 00:00:00 GMT");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    const etag = r.headers.get("etag");
    assert.equal(etag, o.etag);

    r = await fetch(`${app.base}/images/book/a.png`, { headers: { "If-None-Match": etag } });
    assert.equal(r.status, 304);
    r = await fetch(`${app.base}/images/book/a.png`, { headers: { "If-None-Match": '"other"' } });
    assert.equal(r.status, 200);
    await r.arrayBuffer();

    r = await fetch(`${app.base}/images/book/a.png`, { method: "HEAD" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-length"), String(PNG.length));

    r = await fetch(`${app.base}/images/book/missing.png`);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: "Not found" });
    for (const bad of ["/images/book/..%2F..%2Fsecret", "/images/%2Fetc%2Fpasswd", "/images/a%5Cb.png"]) {
      const count = s3.requests.length;
      r = await fetch(app.base + bad);
      assert.equal(r.status, 404, bad);
      assert.equal(s3.requests.length, count, `${bad} never reaches the bucket`);
    }

    r = await fetch(`${app.base}/images/x.png`, { method: "POST" });
    assert.equal(r.status, 404);
  } finally {
    app.close();
    s3.close();
  }
});

test("s3 store: a failing or missing bucket is a 502, not a 404", async () => {
  const s3 = await stubS3();
  const ok = await serveApp(createImageStore(s3Settings(s3.endpoint)));
  const noBucket = await serveApp(createImageStore(s3Settings(s3.endpoint, "nope")));
  const down = await serveApp(createImageStore(s3Settings("http://127.0.0.1:9")));
  const quiet = console.error;
  console.error = () => {};
  try {
    let r = await fetch(`${ok.base}/images/broken/a.png`);
    assert.equal(r.status, 502);
    assert.deepEqual(await r.json(), { error: "Image store unavailable" });
    r = await fetch(`${noBucket.base}/images/a.png`);
    assert.equal(r.status, 502);
    r = await fetch(`${down.base}/images/a.png`);
    assert.equal(r.status, 502);
    await r.arrayBuffer();
    r = await fetch(`${ok.base}/images/a.png`);
    assert.equal(r.status, 404, "a plain missing object stays a 404");
  } finally {
    console.error = quiet;
    ok.close();
    noBucket.close();
    down.close();
    s3.close();
  }
});

test("disk store: put and get under its root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imgstore-"));
  const store = new DiskStore(root);
  assert.equal(await store.put("covers", "c.png", PNG), "stored");
  assert.deepEqual(await fs.readFile(path.join(root, "covers", "c.png")), PNG);
  assert.deepEqual(await store.get("covers", "c.png"), PNG);
  assert.equal(await store.get("covers", "none.png"), null);
  assert.equal(await store.get("covers", "../images/c.png"), null);
  await assert.rejects(store.put("covers", "../c.png", PNG), /Invalid image name/);
});
