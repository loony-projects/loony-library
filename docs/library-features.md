# Library features and setup

## Upgrade

From `backend/`, with `DATABASE_URL` configured:

```sh
npm run migrate
npm start
```

For an empty database, first run `migration/schema.sql`, then `npm run migrate`.
The migration runner records applied migrations and can be rerun safely. It
preserves existing books and sections as published. Their `created_at` values
are the upgrade time because their original creation dates were never stored.
Existing language values start as `und` (undetermined).

Register through **Sign in / Create account**, then grant your account editor
access from the server:

```sh
cd backend
npm run editor -- your-email@example.com
```

Registration always creates a reader. Only the operator's CLI can promote an
account. Editors can edit every book. Anonymous visitors and readers cannot
create, update, upload, reorder, restore, publish, or delete library content.

Set `CORS_ORIGIN` to the exact frontend origin (development default:
`http://localhost:5173`). The frontend sends the HTTP-only session cookie on
API requests. Production requires HTTPS and `NODE_ENV=production` for secure
cookies. Serve the UI and API on the same site; cross-site cookie deployment
is not configured. Passwords are salted with scrypt; sessions use random
256-bit tokens stored as hashes and expire after 30 days. Authentication
attempt limits are per API process.

## Discovery

The landing page filters title, author, and series; searches section content
across books; filters genre and language; and sorts by title, author, or recently
added. Genres are a lightweight PostgreSQL `text[]`. Books support a series
name and positive numeric volume. **Book details & actions** edits metadata,
co-authors, and publication state. Author links lead to all books by that author,
with editable biography and photo URL. Existing free-text authors are migrated
as single entities; split co-authors with semicolons when editing metadata.

## Personal reading

Signed-in readers get cross-device section-level continue-reading history,
favorites, wishlist, ratings, public reviews, and private bookmarks, highlighted
quotes, and notes. Use **Capture selected text** to save a highlight. Matching
quotes are highlighted in browsers supporting CSS Custom Highlights; saved
quotes remain available in the annotation panel in other browsers. If content
changes, an unmatched quote is retained in the panel rather than guessed at a
new position. Reading appearance persists locally on each browser.

## Editorial workflow

New books and sections start as drafts. Existing published text stays visible
while editors save new drafts. **Save draft** records each saved draft in
history. **Publish saved draft** snapshots the previous published content and
publishes the saved draft. **Restore as draft** puts a historic version into
the editor for review before publishing. Publishing a section does not publish
its book or an unpublished ancestor. Public navigation, section access, search,
and exports exclude unpublished content and descendants of draft sections.

Metadata edits and renames take effect immediately. **Edit & reorder contents**
lets editors rename chapters/sections and reorder siblings with drag-and-drop
or keyboard-accessible up/down buttons. Reorders are atomic. Image uploads
accept signature-checked PNG/JPEG/WebP files up to 5 MB and insert Markdown
at the cursor. Existing chapter/section deletion remains permanent and is
confirmed separately; revision history restores content edits, not deletions.

## Reading and export

Sections have previous/next links in depth-first reading order. Appearance
controls offer dark mode, font size and line spacing. The sidebar has keyboard
resizing, the page has a skip link, and dialogs trap focus, close with Escape,
and restore focus to their trigger. These are targeted accessibility
improvements, not a completed assistive-technology certification.

Book actions download Markdown and EPUB. EPUB includes a navigation document,
semantic Markdown and available local raster images; raw HTML is preserved as
escaped text and remote/missing images have descriptive fallbacks. Markdown
retains image references. Exports contain saved content, not unpublished draft
buffers; editors can also export draft sections' saved blocks.

**Print chapter / PDF** prepares every visible section in a chapter.
**Print entire book / PDF** prepares the whole book. Use the browser print
dialog's Save as PDF option; there is no server-side PDF renderer.

## Validation

```sh
npm --prefix backend test
npm --prefix frontend run build
npm --prefix frontend run lint
```

Backend tests create and remove a uniquely named schema in the configured
PostgreSQL database, preserving existing library tables. The test database role
needs CREATE permission. Tests cover passwords, ZIP checksums, anonymous and
reader/editor permissions, draft isolation (including ancestors), cross-book
search, co-authors, private data ownership, reading progress, shelves/reviews,
reordering, cross-chapter parent rejection, revision restore, exports, CSRF
origin checks, and logout invalidation.
