# CMSBar × Nuxt 3 (V0: server + read-only content)

A real Nuxt 3 app that mounts the **framework-neutral CMSBar API** and
server-renders the content **read-only**. This is V0 — the server protocol and
SSR content, proving Vue/Nuxt is the same recipe as the SvelteKit host. There is
**no editing UI yet** (the native Vue editor components are a later phase).

## The assembly model (same as the other examples)

CMSBar has two layers, and only one was ever React:

1. **The protocol** — framework- and language-neutral. The API routes behind one
   dispatcher (`createCmsApi`), the content model, the signed-cookie session.
   Plain TypeScript, no React, no Next. This is what V0 mounts.
2. **The editing UI** — a *client* of the protocol (React first, then Svelte).
   A native Vue UI is the same proven recipe; it is not in V0.

The neutral core is the single canonical source at `../../template`. It is
**copied in** by `npm run setup` — never forked — into `lib/cmsbar/*` and
`lib/content.ts`, which are **git-ignored**. Only the host glue is committed:

| Committed glue                         | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `server/routes/api/cms/[...path].ts`   | Nitro catch-all that mounts the whole CMS API      |
| `pages/index.vue`                      | SSR demo page reading `getContent()` (read-only)   |
| `cms.config.ts`                        | Project CMSBar config (`@/cms.config`)             |
| `content/site-content.json`            | The content the site renders from                  |
| `nuxt.config.ts`, `tsconfig.json`      | Nuxt host config + `@`/`~` → root alias            |
| `scripts/setup.mjs`                    | Copies the neutral core in (skips `page-meta-next`)|

## Run it

```bash
npm run setup     # copy the neutral core from ../../template into lib/
npm install
npm run build     # nuxt build -> .output/server/index.mjs (node-server preset)
npm start         # node .output/server/index.mjs  (needs CMS_SESSION_SECRET)
```

Dev: `npm run dev` (port 3268).

## How the server integration works

The entire API is one Nitro route:

```ts
// server/routes/api/cms/[...path].ts
import { toWebRequest } from "h3";
import { createCmsApi } from "@/lib/cmsbar/server/companion";
const cms = createCmsApi();
export default defineEventHandler((event) => cms(toWebRequest(event)));
```

`createCmsApi()` returns a single `(req: Request) => Promise<Response>` covering
every CMS route. It strips the `/api/cms` base, reads cookies off the request's
`Cookie` header, and 404s unknown paths.

SSR content is just the JSON: `getContent()` (from `lib/content.ts`) returns the
typed content object; `resolvePageMeta()` (from `lib/cmsbar/page-meta-core`)
builds the page `<head>`, fed to `useHead`.

## Smoke checks

- `GET /api/cms/session` → `{"authenticated":false}` (Nitro catch-all →
  `createCmsApi` → dispatcher)
- `GET /` → 200 with the demo content baked into the HTML (Vue SSR of
  `getContent()`)

## Env

Copy `.env.example` to `.env.local`. `CMS_SESSION_SECRET` is required to run; the
GitHub vars only matter once you start saving drafts via the API.
