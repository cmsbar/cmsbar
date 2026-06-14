# The CMSBar protocol — non-React frameworks (SvelteKit / Nuxt / anything)

> **Status (2026-06-14): the server protocol is real and works today; the
> Svelte/Vue editing UI is the open "rewrite tier", deliberately not built.**
> Companion to [FRAMEWORKS.md](./FRAMEWORKS.md). For React hosts (Next, React
> Router, TanStack Start, Vite, Astro) use the thin adapters + `cmsbar` CLI —
> this doc is only for hosts whose UI is **not** React.

CMSBar is two layers, and only one of them is React:

1. **The protocol (framework- and language-neutral).** The 18 API routes behind
   one dispatcher, the content model, and the signed-cookie session. This is the
   actual product — Git-as-CMS — and it runs on any JS server.
2. **The editing UI (React today).** The in-page bar, the editable primitives,
   the drawers/panels. This is a *client* of the protocol.

A Svelte or Vue site can adopt layer 1 **now**. Layer 2 is a port, not an
adapter — see _Scope_.

---

## 1. Mount the server — trivial, and already proven

The whole API is one function, `createCmsApi()`, returning
`(req: Request) => Promise<Response>`. It is the same dispatcher already running
in production-shape on Next route handlers, a React Router resource route, a
TanStack server route, a Hono companion (the Vite SPA), and an Astro endpoint.
Any framework that can hand you a web `Request` mounts it in a few lines.

**SvelteKit** — `src/routes/api/cms/[...path]/+server.ts`:

```ts
import { createCmsApi } from "$lib/cmsbar/server/companion";
const cms = createCmsApi(); // (req) => Promise<Response>
export const GET = ({ request }) => cms(request);
export const POST = ({ request }) => cms(request);
export const PATCH = ({ request }) => cms(request);
// SvelteKit RequestEvent.request is a web Request; the handler returns a Response.
```

**Nuxt / Nitro** — `server/routes/api/cms/[...path].ts`:

```ts
import { createCmsApi } from "~/lib/cmsbar/server/companion";
const cms = createCmsApi();
export default defineEventHandler((event) => cms(toWebRequest(event)));
// Nitro's toWebRequest(event) yields a web Request; returning a Response is fine.
```

That is the entire server integration. `lib/cmsbar` (paths, session, media
rules, the GitHub backend, the neutral handlers + dispatcher) is plain TS with
no React and no Next — copy it in exactly as the React examples do
(`scripts/setup.mjs`), minus the two Next-only files.

**Reading content** for server-rendering the public site is just the JSON:
`getContent()` (from `lib/content.ts`) returns the typed content object in any
runtime; render it with Svelte/Vue templates. `resolvePageMeta()` builds the
page `<head>` the same way React Router's `meta` and Astro's head do.

So a Svelte/Vue site can today: serve the live content (SSR), and run the full
edit→Save→PR→preview→approve flow **through the API** — the server half is done.

## 2. What's NOT here — the editing UI (the rewrite tier)

The in-page editing experience is ~6,500 lines of React under
`components/cmsbar/`. Porting it is a rewrite per framework, not a shim, because
the seam that makes the React hosts cheap (`host.tsx`) abstracts *navigation and
an image component* — it does **not** make React components run in Svelte/Vue.

A Svelte (and separately, a Vue) client must reimplement, natively:

| React component(s) | What the port must rebuild |
| --- | --- |
| `ContentProvider` | a store/composable: overrides, pending edits/uploads/deletes, blob previews, localStorage + IndexedDB staging, preview mode |
| `T`, `RichText` | inline `contentEditable` editing + the Selection-API rich-text toolbar |
| `EditableImage`, `EditableMedia`, `FocalPoint` | media picker/upload/library, focal-point drag, embed normalization |
| `EditableInfoList` | the block-repeater with drag-to-reorder |
| `CmsBar`, `SettingsDrawer`, `VersionsDialog`, `IssuesPanel`/`Button`, `PageMetaDrawer`, `CmsTour`, `Portal` | the bar, drawers, panels, guided tour |

Estimate: **XL per framework** (~the component-layer line count, each), with
permanent sync debt against the React UI.

## 3. Recommendation

- **Now:** if a Svelte/Vue team wants CMSBar, give them the protocol — mount
  `createCmsApi`, render content from `getContent()`. They get versioned,
  PR-reviewed content immediately; editing happens via the API (e.g. a small
  custom form, or a shared React editor mounted on an `/admin` route).
- **Build the native Svelte/Vue editing UI only when demand is proven.** It is a
  dedicated, ongoing client — ideally owned by people who live in that
  ecosystem — published against this protocol as the contract. This matches
  PLAN.md §6 and FRAMEWORKS.md's "not until demand proves it."

The protocol is the stable thing. The React UI is the first client; a Svelte or
Vue UI would be the second — and this document is the contract it builds against.
