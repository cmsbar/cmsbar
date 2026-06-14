# CMSBar × Nuxt 3 (full native Vue 3 editing UI)

A real Nuxt 3 app that mounts the **framework-neutral CMSBar API**,
server-renders the content, AND ships a **complete native Vue 3 editing UI** at
feature parity with the React + Svelte clients: in-page bar, editable text /
rich-text / image / media / info-list primitives, and the Versions / Page-meta /
Settings / Issues drawers + the opt-in guided tour. The whole edit→Save→PR→
preview→approve flow runs in Vue, reusing the neutral core unchanged.

## The assembly model (same as the other examples)

CMSBar has two layers, and only one was ever React:

1. **The protocol** — framework- and language-neutral. The API routes behind one
   dispatcher (`createCmsApi`), the content model, the signed-cookie session.
   Plain TypeScript, no React, no Next.
2. **The editing UI** — a *client* of the protocol. React was first, then Svelte
   (`examples/sveltekit`); this app is the **Vue 3** client, written natively in
   SFCs under `cmsbar/` and reusing the same neutral `lib/cmsbar` core.

The neutral core is the single canonical source at `../../template`. It is
**copied in** by `npm run setup` — never forked — into `lib/cmsbar/*` and
`lib/content.ts`, which are **git-ignored**. Only the host glue is committed:

| Committed glue                         | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `server/routes/api/cms/[...path].ts`   | Nitro catch-all that mounts the whole CMS API      |
| `cmsbar/*.vue` + `content.ts`          | The native Vue 3 editing UI (store, primitives, bar, drawers) |
| `app.vue`                              | Builds + provides the store, mounts `<CmsBar>`     |
| `plugins/cmsbar-session.server.ts`     | Server-only: seeds CmsState from the session cookie |
| `pages/index.vue`                      | Demo page rendering every editable primitive       |
| `cms.config.ts`                        | Project CMSBar config (`@/cms.config`)             |
| `content/site-content.json`            | The content the site renders from                  |
| `assets/styles/cmsbar.css`             | The CMSBar theme (CSS variables + `.cmsbar-prose`) |
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

## Editing

Log in via the bar (bottom of the page) with `CMS_USER` + `CMS_PASSWORD`, then
**New draft** (review mode) or **Edit site** (direct mode). The session cookie is
read server-side by `plugins/cmsbar-session.server.ts`, so an active draft makes
the same SSR-rendered elements editable in place — no client-only flash. Saving
commits through the API to a `cms/*` branch (review) or the base branch (direct).

## Smoke checks

- `GET /api/cms/session` → `{"authenticated":false}` (Nitro catch-all →
  `createCmsApi` → dispatcher)
- `GET /` (anonymous) → 200 with the demo content baked into the HTML, fully
  inert (no `contenteditable`, no bar)
- `GET /` with a valid editor session cookie that carries an active draft →
  the same page server-renders in edit mode (the bar, `contenteditable` fields,
  `data-cms-path` hooks, the editable image/media/info controls)

## Env

Copy `.env.example` to `.env.local`. `CMS_SESSION_SECRET` is required to run; the
GitHub vars only matter once you start saving drafts via the API.
