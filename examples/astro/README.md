# CMSBar example — Astro (React islands, editor-gated hydration)

A real Astro host that mounts CMSBar with **editor-gated hydration** (the docs'
option (a)): public visitors get **static HTML with zero CMS JavaScript**, and a
detected editor session cookie switches the page to a **hydrated React island**
so editing works in place.

The CMS source (`src/components/cmsbar`, `src/lib/cmsbar`, `src/lib/content.ts`,
`src/styles/cmsbar.css`) is **not committed** — it's copied from the canonical
template by `npm run setup`, so the example never forks the core. Only the
host-specific wiring is in git.

## How the editor gating works

The page's content region is authored **once** as a React component
(`src/cmsbar/CmsApp.tsx` → `DemoPage`) using the framework-neutral CMS
primitives (`<T>`, `<EditableImage>`) plus `<CmsBar>`. `CmsBar` returns `null`
when not authenticated, so it never shows for the public.

`src/pages/index.astro` reads the editor session cookie **server-side**
(`getServerSession(Astro.request)`) and conditionally applies the client
directive:

```astro
---
const initialCms = getServerSession(Astro.request);
const content = getContent();
const isEditor = initialCms.authenticated; // editor cookie present + valid
---
{ isEditor
  ? <CmsApp client:load content={content} initialCms={initialCms} />
  : <CmsApp content={content} initialCms={initialCms} /> }
```

- **Public** (no/invalid cookie): `<CmsApp />` with **no client directive**.
  Astro server-renders it to static HTML and ships **zero JS** for it. The
  response contains the demo title/body as plain markup and **no hydration
  script for the island**.
- **Editor** (valid cookie): `<CmsApp client:load />`. Astro hydrates the island
  — the CMS primitives become interactive and the bar appears. Editing works.

Because the same component serves both cases, there is **no double-authoring**
and **no per-node islands**. Props (`content` JSON + `initialCms` object) are
plain serializable values, which is required to cross the Astro → island
boundary.

### SEO note

Editor-gated hydration is **SEO-equivalent to a static page**, not to a SPA.
Public visitors and crawlers always receive fully server-rendered static HTML —
the content lives in the markup, not assembled by client JS — so there is no
hydration dependency for indexing. The hydrated island is only ever served to a
logged-in editor.

## Glue files (committed)

- `src/pages/index.astro` — the editor-gated render (above).
- `src/cmsbar/CmsApp.tsx` — the React island root: `<HostProvider>` (DOM
  defaults) → `<ContentProvider>` → `DemoPage` (uses `<T>`/`<EditableImage>`) +
  `<CmsBar>`.
- `src/cmsbar/getServerSession.ts` — reads the session cookie off `Astro.request`
  (`cookieCtxFromRequest` + `verifySession`) → `initialCms`.
- `src/pages/api/cms/[...path].ts` — the whole CMS API as one catch-all Astro
  endpoint: `export const ALL = ({ request }) => createCmsApi()(request)`.
- `src/pages/cmsbar/login.astro` + `src/cmsbar/LoginForm.tsx` — login (island
  form → `POST /api/cms/login` → full-page nav to `/`).
- `src/layouts/Base.astro` — document shell + `@/styles/app.css`
  (`@import "tailwindcss"` + `@import "./cmsbar.css"`).
- `src/cms.config.ts`, `src/content/site-content.json` — this example's config +
  content (with the `demo` block), plus `public/images/demo.svg`.

## Run it

```bash
npm run setup     # copy the neutral CMS core from ../../template into src/
npm install
npm run dev       # http://localhost:3250  — visit /cmsbar/login to edit
```

Production build + run the built standalone Node server:

```bash
npm run build
npm start         # NODE_ENV=production node ./dist/server/entry.mjs  (port 3250)
```

A live editor needs the CMSBar env vars (see `.env.example`); copy it to
`.env.local` and fill in your secrets. The read-only public site works without
real GitHub credentials.
