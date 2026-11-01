import test from "node:test";
import assert from "node:assert/strict";
import { matchSections, readingOrder } from "../src/reload.js";

const chapter = (slug, titles, prefix) => ({ slug, sections: titles.map((title, i) => ({ id: `${prefix}${slug}-${i}`, title })) });

test("sections match by chapter and title, a repeated title by which occurrence it is", () => {
  const before = [chapter("one", ["Intro", "Summary", "Exercises", "Summary"], "old-")];
  const after = [chapter("one", ["Intro", "New Section", "Summary", "Exercises", "Summary"], "new-")];
  const m = matchSections(before, after);
  assert.deepEqual(m.get("old-one-0"), { id: "new-one-0", how: "title" });
  assert.deepEqual(m.get("old-one-1"), { id: "new-one-2", how: "title" });
  assert.deepEqual(m.get("old-one-3"), { id: "new-one-4", how: "title" });
});

test("a renamed section keeps its place when the chapter has as many sections; otherwise it goes to the chapter's start", () => {
  const renamed = matchSections([chapter("one", ["Intro", "Old Name"], "old-")], [chapter("one", ["Intro", "New Name"], "new-")]);
  assert.deepEqual(renamed.get("old-one-1"), { id: "new-one-1", how: "place" });
  const removed = matchSections([chapter("one", ["Intro", "Gone", "End"], "old-")], [chapter("one", ["Intro", "End"], "new-")]);
  assert.deepEqual(removed.get("old-one-1"), { id: "new-one-0", how: "chapter" });
  assert.deepEqual(removed.get("old-one-2"), { id: "new-one-1", how: "title" });
});

test("a chapter that's gone sends its sections to the book's first section", () => {
  const m = matchSections([chapter("gone", ["A"], "old-"), chapter("kept", ["B"], "old-")], [chapter("kept", ["B"], "new-")]);
  assert.deepEqual(m.get("old-gone-0"), { id: "new-kept-0", how: "book" });
});

test("reading order is depth-first by sort_order", () => {
  const rows = [
    { id: "b", parent_id: null, sort_order: 2 },
    { id: "a", parent_id: null, sort_order: 1 },
    { id: "a2", parent_id: "a", sort_order: 2 },
    { id: "a1", parent_id: "a", sort_order: 1 },
  ];
  assert.deepEqual(readingOrder(rows).map((r) => r.id), ["a", "a1", "a2", "b"]);
});
