# Library features and setup

## Upgrade

From `backend/`, with `DATABASE_URL` configured:

```sh
npm run migrate
npm start
```

For an empty database, run `npm run migrate` in `backend/` — it creates the whole schema.
The migration runner records applied migrations and can be rerun safely. It
preserves existing books and sections as published. Their `created_at` values
are the upgrade time because their original creation dates were never stored.
Existing language values start as `und` (undetermined).

Accounts live in loony-auth (`~/projects/loony-auth`):
**Sign in** sends the browser to loony-auth's hosted sign-in page (OAuth 2.1
authorization code + PKCE, OpenID Connect), and the first sign-in creates the
library's own user row (matched by loony-auth's subject). loony-auth must be
running - `scripts/start.sh` starts it. Grant an account editor access from
the server once it has signed in:

```sh
cd backend
npm run editor -- your-email@example.com
```

Every account starts as a reader. Only the operator's CLI can promote an
account; the reader/editor role is local to the library, not stored in
loony-auth. Editors can edit every book. Anonymous visitors and readers cannot
create, update, upload, reorder, restore, publish, or delete library content.

Set `CORS_ORIGIN` to the exact frontend origin (development default:
`http://localhost:5173`). The frontend sends the HTTP-only session cookie on
API requests. Production requires HTTPS and `NODE_ENV=production` for secure
cookies. Serve the UI and API on the same site; cross-site cookie deployment
is not configured. The library never sees passwords: loony-auth handles
them, MFA and account security (**Account security** in the account menu
opens loony-auth's page). After verifying loony-auth's ID token, the library
keeps its own session: random 256-bit tokens stored as hashes, expiring after
30 days. **Sign out** ends both the library session and the loony-auth one.

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

**Health** (editors, in a book's header) shows what book-import found the
last time it loaded or reloaded the book: errors and warnings, images it
couldn't find, sections with no content, and code that doesn't parse
(counts, with the first 300 listed) - each linked to its section. The
loader saves this in `import_reports` (migration 002); run `npm run
migrate` in `backend/` first.

## Reading and export

Sections have previous/next links in depth-first reading order. Keyboard
shortcuts while reading (not while typing in a field): `j`/`k` (or `n`/`p`)
next/previous section, `/` search this book, `t` show or hide the contents
(remembered per browser on desktop; the drawer on small screens), `?` lists
them. Code blocks show their language and have a Copy button. Appearance
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
needs CREATE permission. Tests cover the sign-in callback's state check, ZIP checksums, anonymous and
reader/editor permissions, draft isolation (including ancestors), cross-book
search, co-authors, private data ownership, reading progress, shelves/reviews,
reordering, cross-chapter parent rejection, revision restore, exports, CSRF
origin checks, and logout invalidation.
