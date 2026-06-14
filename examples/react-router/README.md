# CMSBar example — React Router 7 (framework mode, Vite)

A minimal, real React Router 7 host that mounts CMSBar through the
framework-neutral dispatcher + host seam. It exists to **prove the core works on
React Router** and to show the canonical wiring.

The CMS source (`app/components/cmsbar`, `app/lib/cmsbar`, `app/lib/content.ts`,
`app/styles/cmsbar.css`) is **not committed** — it's copied from the canonical
template by `npm run setup`, so the example never forks the core. Only the
host-specific wiring is in git:

- `app/root.tsx` — the RR host wiring. The `loader` (server) reads the session
  cookie off the Request (`getServerSession`) to build `initialCms`; the
  component wraps `<ContentProvider>` + `<Outlet/>` + `<CmsBar/>` in
  `<ReactRouterCmsHost>`.
- `app/cmsbar/ReactRouterCmsHost.tsx` — the client host adapter: `useLocation()`
  for the pathname, `useNavigate()` for soft nav, the neutral `DomImage`, and
  `apiBase` `/api/cms`. (The RR counterpart of the template's `NextCmsHost`.)
- `app/cmsbar/getServerSession.ts` — `cookieCtxFromRequest` + `verifySession`.
- `app/routes/api.cms.$.ts` — the whole CMS API as one **resource route**
  (no default export): `loader`/`action` → `handleCmsRequest(request)`.
- `app/routes/_index.tsx` — a demo page using `<T>` + `<EditableImage>`, with a
  route `meta` built from `resolvePageMeta(getPageMeta("home"), …)`.
- `app/routes/cmsbar.login.tsx` — the login page (plain fetch + redirect).
- `app/styles/app.css` — `@import "tailwindcss"` + `@import "./cmsbar.css"`.
- `app/cms.config.ts`, `app/content/site-content.json` — this example's config +
  content.

## Run it

```bash
npm run setup     # copy the neutral CMS core from ../../template into app/
npm install
npm run dev       # http://localhost:3220  — visit /cmsbar/login to edit
```

`npm run build` then `npm start` for the production build (port 3220). A live
editor needs the CMSBar env vars (see `.env`); the build and the read-only site
work without real GitHub credentials.
