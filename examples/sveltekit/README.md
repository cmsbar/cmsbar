# CMSBar + SvelteKit example (S0: server + read-only content)

This example mounts the **framework-neutral CMSBar API** in a SvelteKit app and
**server-renders the content read-only**. There is no in-place editing UI yet -
the Svelte editor components are a later phase. S0 proves two things:

1. The whole CMS API mounts on a SvelteKit endpoint with one call.
2. The CMSBar content model server-renders through a SvelteKit `load` + page.

## How it fits together

CMSBar's core is a single canonical source at `../../template`. This example
never forks it: `npm run setup` copies the **neutral TypeScript** core into
`src/lib/cmsbar/` (plus `src/lib/content.ts`) and the copy is git-ignored. Only
the host-specific glue is committed.

- **API (one endpoint).** `src/routes/api/cms/[...path]/+server.ts` is a rest
  (catch-all) route. It calls `createCmsApi()` once and forwards every request:

  ```ts
  import { createCmsApi } from "@/lib/cmsbar/server/companion";
  const cms = createCmsApi();
  export const GET = ({ request }) => cms(request);
  export const POST = ({ request }) => cms(request);
  export const PATCH = ({ request }) => cms(request);
  ```

  `createCmsApi()` returns `(req: Request) => Promise<Response>` and routes every
  CMS endpoint (session, login, logout, commit, issues, images, media, preview,
  resolve-map, versions), stripping the `/api/cms` base and reading cookies off
  the request's `Cookie` header. Same model proven on Next, React Router,
  TanStack Start, Hono, and Astro.

- **SSR content (read-only).** `src/routes/+page.server.ts` calls `getContent()`
  on the server and `resolvePageMeta()` for head meta; `src/routes/+page.svelte`
  renders the fields read-only. The content is in the server-rendered HTML.

- **The `@` alias.** `kit.alias { "@": "./src" }` (in `svelte.config.js`) makes
  the core's internal `@/cms.config`, `@/lib/content`, and `@/lib/cmsbar/*`
  imports resolve unchanged - exactly as on every other host.

## What is committed vs assembled

Committed glue: `package.json`, `svelte.config.js`, `vite.config.ts`,
`tsconfig.json`, `scripts/setup.mjs`, `src/cms.config.ts`,
`src/content/site-content.json`, `src/app.html`, `src/app.d.ts`,
`src/routes/+page.server.ts`, `src/routes/+page.svelte`, and
`src/routes/api/cms/[...path]/+server.ts`.

Assembled by `npm run setup` (git-ignored): `src/lib/cmsbar/*`,
`src/lib/content.ts`.

## Run it

```bash
npm run setup     # copy the neutral core from ../../template
npm install
npm run build     # adapter-node -> build/
cp .env.example .env.local   # fill in real secrets to actually edit

# Run the built server (adapter-node):
CMS_SESSION_SECRET=example-build-secret-0123456789 PORT=3260 node build/index.js
# -> GET /api/cms/session  => {"authenticated":false}
# -> GET /                 => 200, demo content in the HTML
```

Dev server: `npm run dev` (Vite, port 3260). Type-check: `npm run check`.
