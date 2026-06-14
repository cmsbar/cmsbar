# The CMSBar protocol — non-React frameworks (SvelteKit / Nuxt / anything)

> **Status (2026-06-14): the server protocol works today AND two full native
> non-React UIs now ship** — Svelte 5 in [`examples/sveltekit`](../examples/sveltekit)
> and Vue 3 in [`examples/nuxt`](../examples/nuxt), both at feature parity with
> the React UI and browser-verified. Companion to [FRAMEWORKS.md](./FRAMEWORKS.md).
> For React hosts (Next, React Router, TanStack Start, Vite, Astro) use the thin
> adapters + `cmsbar` CLI — this doc is for hosts whose UI is **not** React.

CMSBar is two layers, and only one of them was ever React:

1. **The protocol (framework- and language-neutral).** The 18 API routes behind
   one dispatcher, the content model, and the signed-cookie session. This is the
   actual product — Git-as-CMS — and it runs on any JS server.
2. **The editing UI (a *client* of the protocol).** The in-page bar, the
   editable primitives, the drawers/panels. React was the first client;
   `examples/sveltekit` (Svelte 5) and `examples/nuxt` (Vue 3) are the second and
   third, written natively in their frameworks.

A Svelte or Vue site adopts layer 1 in a few lines (below); layer 2 is a port,
not an adapter — and both SvelteKit's and Nuxt's prove it's a tractable, finite
one (see _Scope_).

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

## 2. The editing UI — SvelteKit AND Nuxt/Vue both done

The in-page editing experience is ~6,500 lines of React under
`components/cmsbar/`. Porting it is a rewrite per framework, not a shim — the
seam that makes the React hosts cheap (`host.tsx`) abstracts *navigation and an
image component*, it does **not** make React components run in Svelte/Vue. But
the rewrite is **finite and proven twice**: `examples/sveltekit` is a complete
Svelte 5 port and `examples/nuxt` a complete Vue 3 port, both at feature parity.
Each React piece has a native counterpart in each:

The Vue port (`examples/nuxt/cmsbar/*.vue`) mirrors the Svelte filenames 1:1
(`content.ts` store via provide/inject, `T.vue`, `RichText.vue` +
`RichTextToolbar.vue`, the media set, `EditableInfoList.vue`, `CmsBar.vue` + the
five drawers/panels, an inline-SVG `Icon.vue`); React Portal → Vue `<Teleport>`,
Svelte attachments → a focus-guarded `v-inline` directive.

| React component(s) | Svelte port (`examples/sveltekit/src/cmsbar/`) |
| --- | --- |
| `ContentProvider` | `content.svelte.ts` — a $state store/context: overrides, pending edits/uploads/deletes, blob previews, localStorage + IndexedDB staging, preview mode |
| `T`, `RichText` | `T.svelte`, `RichText.svelte` + `RichTextToolbar.svelte` — contentEditable + the Selection-API toolbar |
| `EditableImage`, `EditableMedia`, `FocalPoint` | `EditableImage.svelte`, `EditableMedia.svelte`, `MediaBrowser.svelte`, `MediaPicker.svelte`, `FocalPoint.svelte` |
| `EditableInfoList` | `EditableInfoList.svelte` — block-repeater + drag-reorder |
| `CmsBar`, `SettingsDrawer`, `VersionsDialog`, `IssuesPanel`/`Button`, `PageMetaDrawer`, `CmsTour` | `CmsBar.svelte`, `SettingsDrawer.svelte`, `VersionsDialog.svelte`, `IssuesPanel.svelte`, `PageMetaDrawer.svelte`, `CmsTour.svelte` (+ a `portal` action + inline-SVG `Icon`) |

Both ports reuse the neutral `lib/cmsbar` (handlers, dispatcher, session, paths,
media rules, GitHub backend) unchanged — zero core fork. Effort was **XL per
framework**; the remaining cost is sync debt keeping the three UIs aligned.

## 3. Recommendation

- **SvelteKit: use the native UI now** — `examples/sveltekit` is the runnable
  starting point (mount `createCmsApi`, copy the Svelte `cmsbar` components,
  wire the layout). Build + svelte-check green; the edit loop is browser-verified.
- **Nuxt/Vue: use the native UI now** — `examples/nuxt` is the Vue 3 counterpart
  at feature parity (mount `createCmsApi` in one Nitro catch-all route, copy the
  Vue `cmsbar` components, wire `app.vue`). vue-tsc + `nuxt build` green; the edit
  loop, rich-text toolbar, info list, and every drawer/panel are browser-verified
  (headless Chromium). Only HTML5 drag-reorder is manual-verify.

The protocol is the stable thing. React was the first UI client, Svelte the
second, Vue the third — and this document is the contract any further client
builds against.
