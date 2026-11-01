import { test, expect } from "@playwright/test";

// The fixture book (e2e/fixtures/e2e-book), loaded by prepare.mjs.
const BOOK = "The Loony Test Book";

test("read a book: library, book, chapter, section, code block, search", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(BOOK) }).first().click();
  await expect(page).toHaveURL(/\/e2e-test-book(\/|$)/);

  // Chapters only, until one is opened.
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("link", { name: /First Program/ })).toHaveCount(0);
  await toc.getByRole("button", { name: /Getting Started/ }).click();
  await toc.getByRole("link", { name: /First Program/ }).click();

  // The section, its code block with a language label and a copy button.
  await expect(page.getByText('print("hello from loony")')).toBeVisible();
  await expect(page.locator(".block-code-lang")).toHaveText(/python/i);
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();

  // Search this book, open the result.
  await page.getByLabel("Search this book").fill("zanzibarquux");
  const result = page.getByRole("button", { name: /zanzibarquux/ });
  await expect(result).toBeVisible();
  await expect(result.locator("mark")).toHaveText(/zanzibarquux/i);
  await result.dispatchEvent("mousedown");
  await expect(page.getByText(/rare word zanzibarquux/)).toBeVisible();
});

test("library search finds a passage and opens it", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Search books, authors or passages…").fill("zanzibarquux");
  const passage = page.getByRole("link", { name: /Finding Words/ });
  await expect(passage).toBeVisible();
  await passage.click();
  await expect(page.getByText(/rare word zanzibarquux/)).toBeVisible();
});
