import test from "node:test";
import assert from "node:assert/strict";
import { markedSnippet, plainSnippet } from "../src/searchSnippet.js";

test("search snippets escape the book's text and mark only the matches", () => {
  const raw = 'use <img src=x onerror="alert(1)"> for \u0002attention\u0003 & more';
  assert.equal(markedSnippet(raw), "use &lt;img src=x onerror=&quot;alert(1)&quot;&gt; for <mark>attention</mark> &amp; more");
  assert.equal(plainSnippet(raw), 'use <img src=x onerror="alert(1)"> for attention & more');
  assert.equal(markedSnippet(null), "");
});
