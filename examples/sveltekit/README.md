# CMSBar + SvelteKit example (full native Svelte 5 editing UI)

This example mounts the **framework-neutral CMSBar API** in a SvelteKit app,
server-renders the content, AND ships a **complete native Svelte 5 editing UI**
at feature parity with the React + Vue clients: in-page bar, editable text /
rich-text / image / media / info-list primitives, and the Versions / Page-meta /
Settings / Issues drawers + the opt-in guided tour. It proves three things:

1. The whole CMS API mounts on a SvelteKit endpoint with one call.
2. The CMSBar content model server-renders through a SvelteKit `load` + page.
3. The editing UI is a tractable, finite per-framework rewrite over the shared
   neutral core (this was the first non-React client; the Vue/Nuxt one followed).

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

- **SSR content + in-place editing.** `src/routes/+page.server.ts` calls
  `getContent()` on the server and `resolvePageMeta()` for head meta;
  `src/routes/+page.svelte` renders the fields through the editable primitives -
  inert in the SSR HTML for anonymous visitors, contenteditable in place once a
  logged-in editor has an active draft. `+layout.server.ts` seeds the session
  from the cookie; `+layout.svelte` provides the store + mounts `<CmsBar>`.

- **The `@` alias.** `kit.alias { "@": "./src" }` (in `svelte.config.js`) makes
  the core's internal `@/cms.config`, `@/lib/content`, and `@/lib/cmsbar/*`
  imports resolve unchanged - exactly as on every other host.

## What is committed vs assembled

Committed glue: the host config (`package.json`, `svelte.config.js`,
`vite.config.ts`, `tsconfig.json`, `scripts/setup.mjs`); the **native Svelte UI**
(`src/cmsbar/*.svelte` + the `content.svelte.ts` store + `src/styles/cmsbar.css`);
the layout/page wiring (`src/routes/+layout.svelte`, `+layout.server.ts`,
`+page.server.ts`, `+page.svelte`); the API route
(`src/routes/api/cms/[...path]/+server.ts`); plus `src/cms.config.ts`,
`src/content/site-content.json`, `src/app.html`, `src/app.d.ts`.

Assembled by `npm run setup` (git-ignored): the neutral core `src/lib/cmsbar/*`
and `src/lib/content.ts`.

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
