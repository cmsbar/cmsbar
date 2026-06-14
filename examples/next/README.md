# CMSBar example — Next.js (App Router)

A minimal, real Next 16 host that mounts CMSBar through the framework host seam.
It exists to **prove the core works on Next** and to show the canonical wiring.

The CMS source (`components/cmsbar`, `lib/cmsbar`, `app/api/cms`, …) is **not
committed** — it's assembled from the canonical template by the CLI, so the
example never forks the core. Only the host-specific wiring is in git:

- `app/layout.tsx` — the Next host wiring: the server half reads the session
  cookie (`next/headers` `cookies()` → `verifySession`) to build `initialCms`;
  the client half is `<NextCmsHost>` wrapping `<ContentProvider>` + page + `<CmsBar>`.
- `app/page.tsx` — a demo page using the editable primitives (`<T>`, `<EditableImage>`).
- `app/globals.css` — `@import "tailwindcss"` + `@import "../styles/cmsbar.css"`.
- `cms.config.ts`, `content/site-content.json` — this example's config + content.

## Run it

```bash
npm run setup     # assemble the CMS source via the CLI (copy-in)
npm install
npm run dev       # http://localhost:3210  — visit /cmsbar/login to edit
```

`npm run build` then `npm start` for the production build. A live editor needs
the CMSBar env vars (see `.env.example`); the build and the read-only site work
without them.
