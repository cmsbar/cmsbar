# CMSBar - setup & daily use

> Adapted from the original production deployment guide. Paths refer to the
> locations `cmsbar init` copies into your repo.

CMSBar lets non-technical editors click any text or image on the live site, change it, and ship the change as a GitHub PR. When a PR merges, your host redeploys and the change is live.

No external CMS service. No database. You own all the code.

---

## The editor's mental model

- **Login** authenticates you, nothing more.
- A **draft** is a named work-in-progress. It maps 1-to-1 to a GitHub branch (`cms/<slug>`) and an open Pull Request titled `[CMS draft] <your title>`.
- Each **Save** click creates one commit on that draft's branch, with all the changes you accumulated since the previous Save.
- The list of **versions** is just "all open PRs whose branch starts with `cms/`". Anyone with the CMS login can browse them.
- A reviewer adding the **`approved` label** to a PR locks it for editing - you can still preview it and fork from it, but can't append more commits.

So: _one draft = one branch = one PR = one version-in-progress_. Multiple drafts can be in flight at the same time.

---

## How it works (architecture)

```
Browser (logged in, editing draft "Update fall schedule")
  │  click text / pick image / create folder / mark delete
  │      ↓
  │  ALL changes queue locally in client state (no network)
  │  Text edits + folder creates + deletes → localStorage  per-branch
  │  Uploaded files                        → IndexedDB     per-branch
  │  (so reloading the tab does NOT lose work)
  │      ↓
  │  Editor clicks "Save"
  │      ↓
  │  POST /api/cms/commit { edits, uploads, folders, deletes }
  ▼
Next.js API route on your host
  │  GitHub Git Data API in one round trip:
  │     ↳ create blob per file
  │     ↳ create tree with all changes
  │     ↳ create commit (parent = branch HEAD)
  │     ↳ update branch ref
  │  Opens / reuses the PR `[CMS draft] <title>`
  ▼
GitHub repo  ──(reviewer merges PR)──►  deploy webhook  ──►  redeploy
```

Key design decisions:

- **No filesystem writes from the running container.** All commits go through the GitHub Git Data API using a fine-scoped PAT. The production container is stateless and disposable; restarting it doesn't lose drafts.
- **One commit per Save click.** Even if you change 30 fields and upload 5 images, it lands as one commit in the PR history.
- **Pending changes survive page reloads.** Text overrides + folder creates + deletes go to `localStorage`; uploaded files go to IndexedDB.
- **Each PR is a "version".** You can preview, edit, or fork any open PR from the CMS bar.

---

## One-time setup

### 1. Generate credentials

```bash
# bcrypt hash for the editor's password
node -e "console.log(require('bcryptjs').hashSync('YOUR-PASSWORD', 10))"

# random session-signing secret (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Create a GitHub Personal Access Token

GitHub → Settings → Developer settings → **Personal access tokens** → **Fine-grained tokens** → "Generate new token".

- **Repository access:** "Only select repositories" → pick this repo.
- **Repository permissions:**
  - **Contents:** Read and write
  - **Pull requests:** Read and write
- Expiration: as long as you like. Rotate periodically.

### 3. Set environment variables

Locally, add to `.env.local`. On your host, add the same keys in the app's Environment Variables panel.

```env
# CMS auth
CMS_USER=admin
# IMPORTANT: bcrypt hashes contain '$' which Next.js's dotenv-expand treats as
# variable interpolation, silently mangling the value. Escape every '$' with
# a backslash. Quotes don't help - they're stripped before expansion.
# Example: \$2b\$10\$abc...xyz
CMS_PASSWORD_HASH=\$2b\$10\$...
CMS_SESSION_SECRET=...32+ hex chars...

# GitHub access for the CMS to commit content edits
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=your-github-user-or-org
GITHUB_REPO=this-repo-name        # just the repo name, owner is separate
GITHUB_BASE_BRANCH=master         # what CMS PRs target

# Optional: GitHub label that locks a PR for editing. Default: "cmsbar approved"
CMS_APPROVED_LABEL=cmsbar approved
```

`GITHUB_REPO` is **just the repo name** - `GITHUB_OWNER` is separate. So for `github.com/me/my-site`, set `GITHUB_OWNER=me` and `GITHUB_REPO=my-site`.

### 4. Restart

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/cmsbar/login`.

---

## Daily use (for the editor)

### Where you are at a glance

The CMS bar reflects your current mode and shows a matching strip at the top of the page:

| State                                | Bottom bar                                   | Top strip                                                                                 |
| ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Logged in, no draft active           | "CMS · **Live site**" (green pill)           | none                                                                                      |
| Editing a draft                      | "CMSBar · `<title>`" (pink pill)             | **pink** strip "Editing draft: `<title>`"                                                 |
| Draft has unsaved changes            | "`N` unsaved" badge on bottom + strip        | pink strip with "`N` unsaved" badge                                                       |
| Editing a draft, on a different page | same as above                                | pink strip + `⚠ Go to [Page Name]` button - click to jump back to the draft's origin page |
| Draft is approved/locked             | "locked" badge on bottom + green Fork button | **emerald** strip "Approved draft (read-only)"                                            |
| Previewing another draft             | "preview mode" + Edit/Fork buttons           | **amber** strip "Previewing draft: `<title>`"                                             |

You can never accidentally walk away thinking you're on the live site while a draft is in flight - the strip is always there. Edit mode is automatic for any active, non-preview, non-approved draft (there is no Edit checkbox).

### Starting a draft

1. Open `/cmsbar/login`, sign in.
2. Land on the home page. The floating CMS bar at the bottom shows **"no draft active"**.
3. Click **Start new draft**. A modal asks **"What are you working on?"** - type a one-line description (e.g. _"Update fall schedule"_).
4. The system creates a branch `cms/update-fall-schedule-<short-id>` and opens a PR titled `[CMS draft] Update fall schedule`. You're now in an active draft.

The page you were on when you clicked **Start new draft** is remembered as the draft's **origin page**. That path is stored in your session cookie and as a hidden marker in the PR body, so any editor who later switches to this draft from a different page or browser is automatically redirected there.

### Editing

Edit mode is **always on while a draft is active** - there is no edit toggle. Preview mode and approved (locked) drafts switch it off automatically. While editing, all in-page `<a>` clicks are blocked at the document level (hash links and `target="_blank"` external links are exempt); to move to a different page you must Save or Discard first.

1. Click any wrapped text → it turns into an editable field. **Pink** dashed outline = page-local text. **Amber** dashed outline = a shared element (header, footer, nav, site name, contact info, hero videos); editing it changes that value on every page that uses it. Hover the field for a tooltip explaining the same. Type, click out, change is queued. **`N pending changes`** counter ticks up in the bar.
2. For paragraphs wrapped in `<RichText>`, select text and a floating toolbar appears with **B / I / U / Hand / Clear**. Buttons highlight pink when the format applies to the selection. When `RichText` is rendered as a block element (`as="div"` / `as="section"`), the toolbar gains block controls: **P / H2 / H3 / H4** (block format) and **• List / 1. List** (bulleted / numbered). Container needs the `cms-prose` class for default heading/list visuals; add `cms-prose-checks` plus an inline `--bullet-color` to swap bullets for branded checkmarks (see course detail page for an example).
3. For images, hover and click **Change image** → modal opens with the image library, **scrolled to the folder where the current image lives**:
   - Left sidebar: folder tree under `public/images/`
   - **+ New** to create a folder
   - **Upload to this folder** to add a new file (file is staged locally, not yet on the branch)
   - **Use this** on any thumbnail to pick it
   - 🗑 to mark an image for deletion (also queued, not yet committed)
4. For structured editable rows (icon + label + value lists, e.g. the _Informacije_ sidebar on a course page), each row in edit mode shows an icon-picker chip, inline editable label/value, and an `×` delete on hover. A dashed **+ Dodaj stavku** button appends a new row. See **EditableInfoList** below.

### Saving

1. Click **Save** in the CMS bar. All your queued changes commit as **one commit** to your draft's branch, and the PR updates.
2. The bar resets to **"no changes"** but the page keeps showing your edited values.
3. Click **Open PR** to see the PR on GitHub. Send the link to your reviewer.

### Discarding

Click **Discard** → confirm. All pending changes revert (committed changes from earlier in the session stay). No commit, no PR noise.

### Switching between drafts (versions)

1. Click **Versions** in the CMS bar → modal lists every open `cms/...` PR with title, author, commit count, and last updated time.
2. **Preview** a version → an amber banner appears at the top; the page renders with that draft's content. Edit mode is disabled. Hit **Exit preview** to return.
3. From preview:
   - **Edit this version** → switches your active draft to that PR **and navigates you to the page the draft was started on** (if different from your current page). Your next Save adds a commit to _their_ PR. _(Hidden if the PR has the `approved` label.)_
   - **Fork** → prompts for a new title, then creates a fresh `cms/<slug>` branch from the current HEAD of the previewed branch + a new PR. Your active draft switches to the new one.

### Locking drafts as "approved"

When a reviewer is happy with a draft and wants to freeze it before merging, they add the **`cmsbar approved`** label to the PR in GitHub. From that moment on:

- In the **Versions** list, the version shows an "approved · locked" badge. The **Edit** button is hidden; only Preview and Fork remain.
- If an editor is _already_ working on that draft, **the lock applies within ~30 seconds** without a reload - `ContentProvider` polls `/api/cms/session/check` on a 30 s interval (also fires immediately on tab refocus, pauses while the tab is in the background). When approval is detected:
  - the always-on top strip turns **emerald green** and reads "Approved draft (read-only)"
  - the Edit toggle is disabled in the CMS bar
  - the **Save** button is greyed out (and the server would reject a save anyway with HTTP 409)
  - a green **Fork** button appears so they can branch off

The label name comparison is case-insensitive. Configure it via `CMS_APPROVED_LABEL`; default is `cmsbar approved`. If the lock doesn't trigger after labeling, double-check that the GitHub label name matches the env var character-for-character (apart from case). Open DevTools → Network → `/api/cms/session/check` to see the `labels` array of what GitHub actually returned vs the `approvedLabel` the server is looking for.

### Exit / log out

- **Exit draft** keeps you logged in but clears the active session. You can start a new draft or pick an existing one.
- **Log out** ends the session cookie entirely.

---

## How to make more things editable

The site uses a handful of editable primitives.

### Editable text

```tsx
import { T } from "@/components/cms/T";

// Before:
<h1 className="...">Engleski jezik</h1>

// After:
<T as="h1" path="home.hero.headlineTop" className="..." />
```

- `path` is a dotted path into `content/site-content.json` (e.g. `home.hero.subtitle`, `teachers.0.bio`, `courses.3.description`).
- `as` defaults to `"span"`. Set it to whatever HTML tag you'd otherwise use.
- Pass `multiline` for paragraphs where Enter should insert a newline (otherwise Enter saves and blurs).
- `fallback="..."` for paths not yet in the JSON.

### Editable image

```tsx
import { EditableImage } from "@/components/cms/EditableImage";

// Before:
<Image src="/images/ig-12.jpg" alt="..." fill className="..." />

// After:
<EditableImage path="home.hero.asteriskImage" alt="..." fill className="..." />
```

- Same `path` convention.
- All `next/image` props (`fill`, `width`, `height`, `priority`, `sizes`, etc.) work as normal.
- In edit mode it renders as a plain `<img>` (so just-uploaded files via blob URL render without going through `next/image`'s optimizer).
- **Focal point:** pass `positionPath="…"` (a content path holding an `object-position` string like `"50% 30%"`) to make an `object-cover` image's crop adjustable. In edit mode a **⊹ Reposition** button appears; click it, then click the spot that should stay visible - the value is saved to that path and applied everywhere the image uses it. Teacher photos use `teachers.<i>.imagePosition`.

### Editable media (image / video / embed)

```tsx
import { EditableMedia } from "@/components/cms/EditableMedia";

<EditableMedia
  path="home.hero.media"
  fallbackPlaceholder={<span>No media set</span>}
/>;
```

- Lives inside a sized container (the component fills it with `absolute inset-0`); the container decides the aspect/height.
- The stored string is type-sniffed at render: local image path → `<img>`, local video path → `<video>`, `http(s)://…` URL → `<iframe src>`, markup starting with `<` → sandboxed `srcdoc` iframe, empty → placeholder.
- The **Change media** button (edit mode) opens a picker with four tabs:
  - **Library** - a grid of existing videos read from the server's `public/media` folder (`GET /api/cms/media/list`, filesystem-based so it works in dev and prod regardless of draft branch). Click one to use it. This is the default tab for video/empty fields.
  - **Upload image/video** - stages a file under `public/images/uploads/` or `public/media/videos/`.
  - **Embed code / URL** - paste either a bare URL _or_ the full embed code from a platform's _Share → Embed_ dialog:
    - iframe-based embeds (YouTube, Facebook, Vimeo, Maps) → the `src` is extracted and stored as a clean URL, rendered via `<iframe src>`.
    - Instagram → the post permalink is read from the `<blockquote>` and converted to its framable `/embed` form.
    - script-based embeds with no iframe (X/Twitter, TikTok, Facebook SDK) → the raw markup is stored and rendered inside a **sandboxed `srcdoc` iframe** (`allow-scripts allow-same-origin`) so the platform widget script runs without touching the parent page.
    - Google Maps short links (`maps.app.goo.gl/…`) are still resolved server-side via `/api/cms/resolve-map`.
  - **Clear** - empties the field (placeholder shows on the live site).
- Storing raw embed markup is safe here because authors are authenticated CMS editors and every change ships through a reviewed PR; the sandboxed frame contains the blast radius.
- **Homepage hero video grid** (`HeroVideoGrid`, `src/components/home/hero-video-grid.tsx`) is built on `EditableMedia`: each grid cell is an editable media surface (`home.hero.videoGrid.items.N.src`, plus a per-item `autoplay` flag). In **edit mode** the cells render as normal `EditableMedia` (change/upload/embed per cell); in **view mode** they're clickable previews that zoom a shared player to screen center with sound, then dock to a corner mini-player on scroll. Grid shape and behaviour are CMS data, not code (`home.hero.videoGrid.*`):
  - `columns` / `gap` - any grid (3×2, 4×2, 3×1, …); responsive via `--cols-*` vars in globals.css (desktop = `columns`, tablet ≤3, mobile ≤2).
  - `autoplay` - `all` | `specific` (per-item `autoplay`) | `none`. This is the playback state on load _and_ what previews return to when the pointer leaves the grid.
  - `onHoverRestVideosStop` - hovering a cell always plays it; `true` also pauses every other preview.
  - `onHoverEffect` - visual flourish: `none` | `lift` (tile rises + slight scale + shadow) | `zoom` (video scales within its frame).
  - `showUnmuteButton` - `true` shows a speaker/unmute button on every cell (all-or-none). Clicking one toggles a **global "sound on" state** (the click also grants the browser the sticky user-activation that lets videos play with sound). Sound is **hover-gated**: once on, hovering _any_ cell plays that cell's audio and mutes the others; moving to another cell switches the sound to it; leaving the grid or switching tabs/windows mutes everything (the on/off state is remembered).
  - `unmuteOnHover` - `true` makes sound "on" from the start (no click) - hovering any cell plays its audio. Note: the very first hover before any page click may stay muted until the browser has a user gesture; clicking the unmute button is the reliable trigger.
  - `showPlayIcon` - when to show the centered play-badge over a cell: `always` | `whenPaused` (only on non-autoplaying cells - hides it over playing video) | `never`. Purely cosmetic; clicking the cell opens the theater regardless.
  - `dock` (`bottom-right` | `bottom-left`), `miniWidth`, and `stayDocked` (once docked, stay docked until manually expanded instead of re-opening on scroll-up).
  - per item: `src` (the video), `autoplay` (used when grid `autoplay` is `specific`), and optionally `thumbnail` (image path) + `showThumbnail` (bool). When `showThumbnail` is true and the cell isn't autoplaying, the thumbnail covers the cell and fades out on hover to reveal the video - e.g. `{ "src": "/media/videos/ig-X.mp4", "autoplay": false, "thumbnail": "/images/poster.jpg", "showThumbnail": true }`.
- **Self-hosting Instagram videos:** download a reel/post to `public/media/videos/` with `npm run download:ig -- <instagram-url> [more-urls...]` (or `scripts/download-ig-video.sh`). Files are named `ig-<shortcode>.mp4`; needs `yt-dlp` installed. Then set a grid item's `src` to the printed `/media/videos/...` path.

### Page metadata (SEO) & favicon

The CMS bar's **🔎 Page meta** button (shown whenever you're logged in) opens a drawer to edit the current page's SEO - title, meta description, social image (`og:image`), search visibility (`noindex`), plus advanced social title/description and canonical URL - with live Google + social-card previews (a **Facebook / X** toggle shows each platform's card style). A **Favicon** field (site-wide) sits in the same drawer. Without an active draft the drawer is **read-only** (fields disabled, previews live) so editors can inspect SEO without starting a draft; start a draft to edit.

- Per-page values live in `content/site-content.json` → `pageMeta.<key>` (key from `metaKey()` in `src/lib/page-meta.ts`); the site favicon is the top-level `favicon` string.
- Editable pages are the static ones listed in `META_PAGES` (home, o-nama, tečajevi, cjenik, uciteljice, gdje-smo, politika-privatnosti). Course/teacher pages derive title/description from their own content.
- Each page calls `generateMetadata()` → `buildPageMetadata(key, fallback)` (reads `pageMeta`, falls back to the original hardcoded title/desc so nothing breaks). The root layout sets `<head>` icons from `favicon`.
- Image fields use an inline picker backed by `GET /api/cms/media/list?type=image` (filesystem listing of `public/images`).
- **Caveat:** `<head>` is server-rendered from committed content, so metadata edits show in the drawer preview now but only reach the live `<head>` after the draft is merged & deployed (unlike body text, which previews live via overrides).

### Rich text

```tsx
import { RichText } from "@/components/cms/RichText";

// Inline (single paragraph) - toolbar has B / I / U / Hand / Clear only.
<RichText as="p" path="home.hero.subtitle" className="..." />

// Block (multi-paragraph + headings + lists) - toolbar gains P / H2-H4 and • / 1. list controls.
<RichText as="div" path="courses.0.bodyRich" className="cms-prose ..." />
```

- Stores HTML; sanitized on save to `<b> <i> <u> <strong> <em> <br> <span> <div> <p> <h1>-<h4> <ul> <ol> <li>` only.
- **Hand** toolbar button wraps the selection in `<span class="font-hand">…</span>` (toggle to remove).
- Block controls only render when the editor root is `<div>` / `<article>` / `<section>` - keeps inline usages from accidentally producing headings.
- Block editors automatically get the theme's **`cmsbar-prose`** class (`styles/cmsbar.css`): default heading sizes (h1-h4), disc/decimal list markers, underlined links and paragraph spacing that survive Tailwind preflight - so every toolbar action produces visible output out of the box. Two theme variables tune it: `--cmsbar-prose-heading-weight` (default `700`) and `--cmsbar-prose-link` (link color, defaults to `--cmsbar-info`). The defaults are declared in `@layer base`, which loses to un-layered site CSS, to `@layer components`/`@layer utilities`, and to later `@layer base` rules alike - so any site rule of equal specificity (e.g. `.cms-prose h2`, layered or not) overrides them, while they still beat Tailwind preflight.
- Wrap the rendered block in **`cms-prose`** to get default heading/list visuals (Tailwind v4 ships without `@tailwindcss/typography`, so we define this class ourselves in `globals.css`). Add **`cms-prose-checks`** plus an inline `style={{ "--bullet-color": "..." }}` to swap disc bullets for filled-check icons.

### Editable structured list (icon + label + value)

```tsx
import { EditableInfoList } from "@/components/cms/EditableInfoList";

<EditableInfoList
  path={`courses.${i}.infoItems`}
  iconBoxClass={cn(accent.bgSoft, accent.text)}
/>;
```

- JSON shape: `{ icon: string; label: string; value: string }[]`. Whole array writes back on every change (add, delete, edit, icon swap).
- Icons come from `src/components/cms/icon-registry.ts`, a curated subset of `lucide-react` (only icons already used elsewhere in the app, so the bundle doesn't grow and the visual vocabulary stays consistent). Add to that file's `ICONS` map to expand the picker.
- In edit mode: click the icon chip → grid popover; click label / value → inline contentEditable; hover row → `×` delete; **+ Dodaj stavku** at the end appends a row.

### Guided tour (onboarding)

```ts
// cms.config.ts
tour: {
  autoStart: true, // open once per browser for authenticated editors
  steps: [
    { id: "welcome", title: "Welcome", body: "…" }, // no target → centered card
    {
      id: "bar",
      title: "The CMS bar",
      body: "…",
      target: "[data-cms-bar]", // CSS selector to spotlight
      placement: "top", // "top" | "bottom" | "left" | "right" (default "bottom")
    },
  ],
},
```

- Opt-in: without `tour` config there is no button and no overlay.
- The bar gains a **✦ Guide** pill that (re)starts the tour; `<CmsTour/>` spotlights each step's `target` and dims the rest of the page. Targets missing from the DOM (e.g. edit-mode-only UI while no draft is open) fall back to a centered card, so write step bodies to tell the user what to click.
- "Done"/"Skip tour" set `cmsbar:tour-done:<namespace>` in localStorage, which gates `autoStart`; the current step survives the page reloads that "New draft" causes (sessionStorage).
- Any code can open it: `window.dispatchEvent(new CustomEvent("cmsbar:tour:open"))`.

### Adding a new field

1. Add the key to `content/site-content.json`.
2. Update the type in `src/lib/content.ts` (`SiteContent`).
3. Use `<T path="…" />` or similar in your JSX.

---

## Files

```
content/site-content.json        ← single source of truth
src/lib/content.ts               ← JSON import + path helpers
src/lib/data.ts                  ← legacy-shape re-exports
src/lib/cms/session.ts           ← HMAC signed cookie + slugify
src/lib/cms/github.ts            ← GitHub REST + Git Data wrappers
src/lib/cms/cmsMeta.ts           ← parse / write <!-- cms-meta: {…} --> PR-body markers (page binding)
src/lib/cms/uploadStorage.ts     ← IndexedDB persistence for File blobs

src/components/cms/
  ContentProvider.tsx            ← client context (overrides, pending state, preview); also installs the global edit-mode link blocker
  T.tsx                          ← editable text node
  RichText.tsx                   ← editable HTML with floating toolbar (inline + block modes)
  EditableImage.tsx              ← image with library modal; modal opens on the current image's folder
  EditableMedia.tsx              ← image / video / embed surface; accepts a URL or a full embed code (YouTube, Instagram, Facebook, X, TikTok, Maps)
  EditableInfoList.tsx           ← editable array of { icon, label, value } rows with picker + add/delete
  icon-registry.ts               ← curated lucide-react icon set (only icons already used in the app)
  CmsBar.tsx                     ← floating bar: draft state, save/discard, versions
  StartDraftDialog.tsx           ← title prompt on Start new / Fork
  VersionsDialog.tsx             ← list of open CMS PRs
  Portal.tsx                     ← React portal helper
  pageName.ts                    ← maps pathname → human draft title (used by Start new draft)

src/app/cmsbar/login/page.tsx       ← login form

src/app/api/cms/
  login/route.ts                 ← POST {username, password} → auth cookie
  logout/route.ts                ← POST → clear cookie
  session/route.ts               ← GET current session info
  session/start/route.ts         ← POST {title, pagePath} → create branch+PR, set draft
  session/switch/route.ts        ← POST {branch} → load existing PR as draft; returns pagePath for redirect
  session/fork/route.ts          ← POST {fromBranch, title} → fork PR
  session/clear/route.ts         ← POST → clear draft (keeps auth)
  versions/route.ts              ← GET → list open cms/* PRs
  preview/route.ts               ← GET ?branch=… → fetch that branch's JSON
  commit/route.ts                ← POST batch commit
  images/list/route.ts           ← GET → list images on current branch

scripts/format-content.mjs       ← idempotent JSON formatter (pre-commit)
.env.example                     ← env var template
CMS.md                           ← this file
```

---

## Operational notes

- **GitHub PAT is the only secret that can write to the repo.** Treat like a password. Rotate if leaked.
- **Pre-commit hook** (`simple-git-hooks` + `scripts/format-content.mjs`) reformats `content/site-content.json` on every `git commit` so manual edits don't churn against CMS commits.
- **The `approved` label is checked at version-list time** - it's a snapshot. If a reviewer adds the label while an editor has the version open in preview, the editor still needs to refresh to see the lock.
- **Pending uploads** survive reloads via IndexedDB. Pending text edits, folder creates, deletes survive via localStorage.
- **TTL:** session cookie is 12 hours; after that you re-login. Pending state in storage is **not** time-limited and will be restored as long as the same draft branch exists.
- **Image proxy fallback.** In edit / preview mode `/images/...` paths are rewritten to `/api/cms/images/raw?branch=cms/<id>&path=public/images/...` so the page renders the version of the file on the draft branch. The proxy 404s when a file exists on your local working branch but not yet on `master` (the cms/\* branch is forked from master). To handle that, the `<img>` registers an `onError` that swaps the src back to the raw `/images/...` path - the dev server serves it straight from `/public`. So images committed only on a feature branch still display while editing.
- **Edit-mode link blocker.** `ContentProvider` installs a document-level capture-phase click listener while `editingEnabled` is true. Any `<a href>` click is intercepted unless the href is a hash anchor or the link has `target="_blank"`. Editors must Save (or Discard) before navigating away - this prevents silently losing pending edits on route change.
- **Draft-page binding.** Each draft stores the pathname it was started on in the signed session cookie and as a `<!-- cms-meta: {"pagePath":"/..."} -->` HTML comment in the PR body. The cookie is authoritative for the current browser; the PR body is authoritative across browsers and sessions - it is re-read by `session/switch` and copied by `session/fork`. When an editor switches to a draft from a different page, `CmsBar` performs a `window.location.href` redirect to the origin page before resuming edit mode. The top strip also shows a `⚠ Go to [Page]` button whenever the active draft's page differs from the current pathname. Existing drafts without the marker behave as before - no redirect is triggered.

---

## Limitations / future work

- **No rich text beyond bold/italic/underline/font-hand, H1-H4, and bulleted / numbered lists.** Add Tiptap inside `RichText.tsx` if you need links, tables, or inline images.
- **Single shared login.** Multi-editor with attribution needs OAuth.
- **No auto-merge.** Every draft is reviewed before going live. To flip to auto-merge, change `draft: false` in `session/start/route.ts` and enable GitHub auto-merge on the repo.
- **Image cropping/resize** is not built in. Files upload as-is.
- **Icon picker is curated**, not free-form (see `icon-registry.ts`). Add an icon by importing it from `lucide-react` and inserting into the `ICONS` map - one line.

---

## Troubleshooting

| Symptom                                                                     | Likely cause                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CMS_USER / CMS_PASSWORD_HASH not configured` on login                      | env vars missing on the running server. Set them and redeploy.                                                                                                                                                                                                                                                                                                                                           |
| `Invalid credentials` even though password is correct                       | bcrypt hash has unescaped `$` in `.env.local`. Escape with `\$`.                                                                                                                                                                                                                                                                                                                                         |
| Save returns 500 with `GitHub PUT/POST ... failed: 401`                     | PAT invalid or expired. Generate a new one.                                                                                                                                                                                                                                                                                                                                                              |
| Save returns 500 with `... failed: 404`                                     | `GITHUB_OWNER` / `GITHUB_REPO` typo, or the PAT doesn't have access to that repo.                                                                                                                                                                                                                                                                                                                        |
| Save succeeds, "Open PR" link missing                                       | PR creation hit a 422 (e.g. base branch invalid). Error message appears below the bar; click **Open branch** as a fallback.                                                                                                                                                                                                                                                                              |
| Preview shows the original content, not the draft's                         | The draft has no `content/site-content.json` yet (first save creates it). Save once and re-preview.                                                                                                                                                                                                                                                                                                      |
| Edit button missing from a version                                          | That PR has the `approved` label. Use Fork to make an editable copy.                                                                                                                                                                                                                                                                                                                                     |
| Image renders alt text instead of the picture in edit mode                  | The file is committed only on a non-`master` branch (e.g. a feature branch), so the cms/\* branch - forked from master - doesn't have it. The `<img onError>` fallback swaps to the raw `/images/...` path; if that also fails the file truly isn't on disk locally either. Either merge the feature branch to master, or upload the image through the CMS bar (which commits it onto the draft branch). |
| "Change image" button trapped under an overlapping photo (journey timeline) | Hover the visible part of the card - figures get `hover:z-[80]` in edit mode and raise above neighbors so the button becomes clickable.                                                                                                                                                                                                                                                                  |
| Clicking a link in edit mode does nothing                                   | Intentional: navigation is blocked while a draft has unsaved edits. Save or Discard first. External `target="_blank"` links and `#hash` anchors still work.                                                                                                                                                                                                                                              |
| Top strip shows "⚠ Go to …"                                                 | You are on a page that is not the draft's origin page. Click the button to jump back, or navigate manually. Editing only works as expected on the origin page (other pages' content is not part of this draft).                                                                                                                                                                                          |
| "Edit this version" lands on a different page than expected                 | The draft was started on a different page - that redirect is intentional. You are now on the correct origin page for that draft.                                                                                                                                                                                                                                                                         |
