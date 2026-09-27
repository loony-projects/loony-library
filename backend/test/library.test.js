import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import "dotenv/config";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { zip, crc32 } from "../src/epub.js";
test("password verification and ZIP checksums", () => {
  const hash = hashPassword("a strong test password");
  assert(verifyPassword("a strong test password", hash));
  assert(!verifyPassword("wrong password", hash));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(
    zip([["mimetype", "application/epub+zip"]]).readUInt32LE(0),
    0x04034b50,
  );
});
test("API integration in isolated schema", async () => {
  const schema = `library_test_${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let server;
  const { pool } = await import("../src/db.js");
  try {
    await admin.query(`create schema ${schema}`);
    pool.options.options = `-c search_path=${schema},public`;
    await pool.query(
      await fs.readFile(
        new URL("../../migration/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      await fs.readFile(
        new URL("../migrations/001-library.sql", import.meta.url),
        "utf8",
      ),
    );
    const { app } = await import("../src/app.js");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(method, url, body, cookie) {
      const res = await fetch(base + "/api" + url, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        status: res.status,
        data,
        cookie: res.headers.get("set-cookie")?.split(";")[0],
      };
    }
    assert.equal((await call("POST", "/books", { title: "No" })).status, 403);
    const account = await call("POST", "/auth/register", {
      email: "editor@example.com",
      name: "Editor",
      password: "a long test password",
    });
    assert.equal(account.status, 200);
    const cookie = account.cookie;
    assert.equal(
      (await call("POST", "/books", { title: "No" }, cookie)).status,
      403,
    );
    await pool.query(
      "update users set role='editor' where email='editor@example.com'",
    );
    const book = await call(
      "POST",
      "/books",
      { title: "Test Book", author: "Author" },
      cookie,
    );
    assert.equal(book.status, 201);
    const slug = book.data.book.slug,
      bid = book.data.book.id;
    assert.equal((await call("GET", "/books")).data.books.length, 0);
    assert.equal((await call("GET", `/books/${slug}`)).status, 404);
    const chapter = await call(
      "POST",
      `/books/${slug}/chapters`,
      { title: "Chapter" },
      cookie,
    );
    assert.equal(chapter.status, 201);
    const sid = chapter.data.section.id;
    assert.equal(
      (
        await call(
          "PUT",
          `/sections/${sid}/draft`,
          { markdown: "Unique search content" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal((await call("GET", `/sections/${sid}`)).status, 404);
    await call(
      "PATCH",
      `/books/${slug}`,
      {
        title: "Test Book",
        author_names: ["One", "Two"],
        genres: ["Rust"],
        language: "en",
        status: "published",
      },
      cookie,
    );
    assert.equal(
      (await call("GET", `/books/${slug}/toc`)).data.chapters.length,
      0,
    );
    assert.equal(
      (await call("GET", "/search?q=Unique")).data.results.length,
      0,
    );
    assert.equal(
      (await call("POST", `/sections/${sid}/publish`, {}, cookie)).status,
      200,
    );
    assert.equal(
      (await call("GET", `/sections/${sid}`)).data.blocks[0].content.text,
      "Unique search content",
    );
    assert.equal(
      (await call("GET", "/search?q=Unique")).data.results.length,
      1,
    );
    assert.equal(
      (await call("GET", "/discover")).data.books[0].authors.length,
      2,
    );
    await call(
      "PUT",
      `/sections/${sid}/draft`,
      { markdown: "Changed draft" },
      cookie,
    );
    assert.equal(
      (await call("GET", `/sections/${sid}`)).data.blocks[0].content.text,
      "Unique search content",
    );
    assert.equal(
      (await call("GET", `/sections/${sid}`)).data.section.draft_markdown,
      undefined,
    );
    const reader = await call("POST", "/auth/register", {
      email: "reader@example.com",
      name: "Reader",
      password: "another long password",
    });
    const rc = reader.cookie;
    assert.equal(
      (await call("POST", `/sections/${sid}/publish`, {}, rc)).status,
      403,
    );
    assert.equal(
      (await call("PUT", "/me/progress", { section_id: sid }, rc)).status,
      200,
    );
    assert.equal(
      (
        await call(
          "PUT",
          `/me/shelves/${bid}`,
          { favorite: true, wishlist: true, rating: 5, review: "Good" },
          rc,
        )
      ).status,
      200,
    );
    const annotation = await call(
      "POST",
      "/me/annotations",
      { section_id: sid, kind: "note", note: "Private" },
      rc,
    );
    assert.equal(annotation.status, 201);
    assert.equal(
      (await call("GET", "/me", undefined, cookie)).data.annotations.length,
      0,
    );
    await call(
      "DELETE",
      `/me/annotations/${annotation.data.id}`,
      undefined,
      cookie,
    );
    assert.equal(
      (await call("GET", "/me", undefined, rc)).data.annotations.length,
      1,
    );
    assert.equal(
      (await call("GET", "/me", undefined, rc)).data.reading[0].section_id,
      sid,
    );
    assert.equal(
      (await call("GET", `/books/${slug}/export?format=md`)).status,
      200,
    );
    assert.equal(
      (await call("GET", `/books/${slug}/export?format=epub`)).status,
      200,
    );
    const second = await call(
      "POST",
      `/books/${slug}/chapters`,
      { title: "Second" },
      cookie,
    );
    assert.equal(
      (
        await call(
          "PUT",
          "/reorder",
          {
            kind: "chapters",
            ids: [second.data.chapter.id, chapter.data.chapter.id],
          },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/sections",
          {
            chapter_id: second.data.chapter.id,
            parent_id: sid,
            title: "Invalid",
          },
          cookie,
        )
      ).status,
      404,
    );
    const history = await call(
      "GET",
      `/sections/${sid}/revisions`,
      undefined,
      cookie,
    );
    assert(history.data.revisions.length > 0);
    assert.equal(
      (
        await call(
          "POST",
          `/sections/${sid}/restore/${history.data.revisions[0].id}`,
          {},
          cookie,
        )
      ).status,
      200,
    );
    const blockedOrigin = await fetch(
      base + "/api/sections/" + sid + "/publish",
      {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example",
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(blockedOrigin.status, 403);
    const child = await call(
      "POST",
      "/sections",
      { chapter_id: chapter.data.chapter.id, parent_id: sid, title: "Nested" },
      cookie,
    );
    await call(
      "PUT",
      `/sections/${child.data.section.id}/draft`,
      { markdown: "Hidden nested marker" },
      cookie,
    );
    await call(
      "POST",
      `/sections/${child.data.section.id}/publish`,
      {},
      cookie,
    );
    await pool.query("update sections set status='draft' where id=$1", [sid]);
    assert.equal(
      (await call("GET", `/sections/${child.data.section.id}`)).status,
      404,
    );
    assert.equal(
      (await call("GET", `/books/${slug}/search?q=Hidden`)).data.results.length,
      0,
    );
    assert.equal(
      (await call("GET", "/search?q=Hidden")).data.results.length,
      0,
    );
    assert.equal(
      (await call("GET", "/me", undefined, rc)).data.reading.length,
      0,
    );
    assert.equal(
      (await call("GET", "/me", undefined, rc)).data.annotations.length,
      0,
    );
    const emptyExport = await call("GET", `/books/${slug}/export?format=md`);
    assert(!emptyExport.data.includes("Hidden nested marker"));
    await call("POST", "/auth/logout", {}, rc);
    assert.equal((await call("GET", "/me", undefined, rc)).status, 401);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
});
