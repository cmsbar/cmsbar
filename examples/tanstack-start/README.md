# CMSBar example — TanStack Start (Vite)

A minimal, real TanStack Start host that mounts CMSBar through the
framework-neutral dispatcher + host seam. It exists to **prove the core works on
TanStack Start** and to show the canonical wiring. It mirrors the React Router
example one-for-one — same assembly model, same single-call API mount.

The CMS source (`src/components/cmsbar`, `src/lib/cmsbar`, `src/lib/content.ts`,
`src/styles/cmsbar.css`) is **not committed** — it's copied from the canonical
template by `npm run setup`, so the example never forks the core. Only the
host-specific wiring is in git:

- `src/routes/__root.tsx` — the Start host wiring. The `loader` (server) calls
  the `getServerSession` server fn (reads the session cookie off the Request) to
  build `initialCms`; the component wraps `<ContentProvider>` + `<Outlet/>` +
  `<CmsBar/>` in `<TanStackCmsHost>`, and pulls in Tailwind via the root `head`
  stylesheet link.
- `src/cmsbar/TanStackCmsHost.tsx` — the client host adapter: `useLocation()`
  for the pathname, `useNavigate()` for soft nav, the neutral `DomImage`, and
  `apiBase` `/api/cms`. (The Start counterpart of the template's `NextCmsHost`.)
- `src/cmsbar/getServerSession.ts` — a `createServerFn` using `getRequest()` +
  `cookieCtxFromRequest` + `verifySession`.
- `src/routes/api/cms.$.ts` — the whole CMS API as one **server route** (a splat
  `server.handlers` route, no component): `GET`/`POST`/`PATCH` →
  `handleCmsRequest(request)`.
- `src/routes/index.tsx` — a demo page using `<T>` + `<EditableImage>`, with a
  route `head` built from `resolvePageMeta(getPageMeta("home"), …)`.
- `src/routes/cmsbar/login.tsx` — the login page (plain fetch + redirect).
- `src/router.tsx` — `getRouter()` (the Start router factory).
- `src/styles/app.css` — `@import "tailwindcss"` + `@import "./cmsbar.css"`.
- `src/cms.config.ts`, `src/content/site-content.json` — this example's config +
  content.

## Run it

```bash
npm run setup     # copy the neutral CMS core from ../../template into src/
npm install
npm run dev       # http://localhost:3230  — visit /cmsbar/login to edit
```

`npm run build` then `npm start` for the production build (port 3230). A live
editor needs the CMSBar env vars (see `.env.example`); the build and the
read-only site work without real GitHub credentials.
