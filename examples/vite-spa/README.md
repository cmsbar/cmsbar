# CMSBar example — Vite + React SPA (+ Hono companion)

A minimal, real **client-only** Vite SPA that mounts CMSBar through the
framework-neutral host seam (client) and `createCmsApi` (server). It exists to
**prove the core works with no framework adapter at all** — the neutral
`HostProvider` DOM defaults are enough — and to show the canonical companion-server
wiring. It mirrors the React Router / TanStack Start examples' assembly model:
same neutral core, copied in by `npm run setup`, same single-call API mount.

Unlike those SSR examples there is **no server render**. The SPA boots in the
browser, fetches its session from the companion, and hydrates the editor entirely
client-side. The companion (`server/index.ts`) is a long-lived Hono process that
serves the API and, in production, the built SPA — on **one origin**, so the
signed session cookie just works.

## What's committed vs. assembled

The CMS source (`src/components/cmsbar/`, `src/lib/cmsbar/`, `src/lib/content.ts`,
`src/styles/cmsbar.css`) is **not committed** — `npm run setup` copies it from the
canonical `../../template`, so the example never forks the core. Only the
host-specific glue is in git:

- `index.html` — the SPA shell (a crawler gets this static markup + the bundle
  script, not rendered content).
- `src/main.tsx` — boot: `fetch /api/cms/session` → brief "checking session"
  state → render `<HostProvider value={{ apiBase: "/api/cms" }}>` +
  `<ContentProvider content={getContent()} initialCms={…}>` + `<App/>` + `<CmsBar/>`.
  **No framework host adapter** — the neutral DOM defaults (window.location +
  popstate, plain `<img>`) cover an SPA.
- `src/App.tsx` — the demo page: `<T as="h1" path="demo.title"/>`,
  `<T as="p" path="demo.intro"/>`, an `<EditableImage path="demo.image" fill …/>`
  in a relative container, and an **inline login form** (there is no
  server-rendered `/cmsbar/login` route in an SPA, so it POSTs to
  `/api/cms/login` then reloads to re-fetch the session).
- `server/index.ts` — the companion: `app.all("/api/cms/*", (c) => cms(c.req.raw))`
  (the whole API in one line via `createCmsApi()`), plus production static serving
  of `dist/` with an `index.html` SPA-fallback. Run with `tsx` so the `@/…` path
  alias resolves at runtime — the same alias Vite uses for the client build.
- `vite.config.ts` — `react` + `tailwindcss` + `tsconfigPaths`; dev
  `server.proxy` forwards `/api/cms` → the companion (`:3241`) so cookies are
  same-origin.
- `src/styles/app.css` — `@import "tailwindcss"` + `@import "./cmsbar.css"`.
- `src/cms.config.ts`, `src/content/site-content.json` — this example's config +
  content (with a `demo` block); `public/images/demo.svg`.
- `scripts/setup.mjs` — copies the neutral core into `src/` (excludes the
  Next-coupled `NextCmsHost.tsx` + `page-meta-next.ts`).

## Run it

```bash
npm run setup     # copy the neutral CMS core from ../../template into src/
npm install
npm run dev       # Vite dev server on http://localhost:3240
```

`npm run dev` serves the SPA on `:3240` and proxies `/api/cms` to the companion.
Start the companion alongside it for a live editor:

```bash
npm run serve     # companion (API + built dist/) on :3240 in production
# or, during dev, run the companion on :3241 so the Vite proxy can reach it:
PORT=3241 npm run serve
```

For the production build on one port:

```bash
npm start         # = npm run build && tsx server/index.ts  (API + static dist/, :3240)
```

A live editor needs the CMSBar env vars — copy `.env.example` to `.env.local` and
fill them in (the companion loads `.env.local` via `--env-file`). The build and
the read-only site work without real GitHub credentials. To actually log in you
also need a `CMS_PASSWORD_HASH` (a bcrypt hash of your password) in `.env.local`.

## Honest limitations (client-only SPA, no SSR)

This target is a real SPA. That buys instant client navigation and a tiny
deploy, but the absence of server rendering has consequences you should know:

- **SEO / pageMeta drawer edits affect nothing a crawler sees.** `curl /` returns
  the static `index.html` shell + the bundle `<script>` — the editable content
  and any `pageMeta` edits render only after the bundle boots in the browser. The
  SEO drawer is kept (it still writes the metadata into the content PR, ready for
  an SSR/SSG host), but it is a **no-op for what a crawler fetches here**.
- **No teaser ("coming soon") gate.** The Next middleware that hides an
  un-launched site has no equivalent without a server render — `launch.mode` does
  not hide the SPA.
- **Content ships in the JS bundle.** `getContent()` is an import-time JSON read
  inlined at build, so the page is blank until the bundle loads.
- **`rateLimit` is fine.** The companion is a single long-lived process, so the
  in-memory rate-limit `Map` persists across requests (unlike a serverless
  function).
