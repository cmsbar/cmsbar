# Framework support - dependency audit & adapter proposal

> **Status (2026-06-14): shipped (Tier 1 + Astro).** The host seam is
> implemented and frozen (validated on all five hosts), the Phase 0 integration
> harness exists (handler-level tests, 152 green), and live example hosts build
> + run green for **Next, React Router 7, TanStack Start, the Vite SPA, and
> Astro** (`examples/`). The `cmsbar` CLI ships both modes
> (`cmsbar new <dir> --framework <fw>` / `cmsbar init`) for all five
> (`packages/cli`). Remaining: the SvelteKit/Nuxt rewrite tier (roadmap) and
> the Next Pages Router community adapter. Companion to _Framework support_ in
> [PLAN.md](./PLAN.md) §6, which fixed the architecture: **one monorepo, a
> neutral core + per-framework adapters** over a small host interface - not a
> repo per framework. This doc audits the Next.js coupling file by file, specs
> each adapter, and recommends an order.

---

## 1. Dependency audit (template/, ~9,660 lines)

Method: grep every file in `template/` for `next/*` imports, `"use client"` /
`"use server"` directives, route-handler signatures, Node APIs, and DOM
assumptions. Coupling depth legend:

- **none** - imports zero framework code; compiles in any React + TS project as-is.
- **thin-shim** - a handful of import lines; swap them behind a host seam, the
  rest of the file is untouched.
- **structural** - the file _is_ the framework integration; needs a per-host
  implementation, or a neutral-core refactor first.

### Components (`components/cmsbar/`, 6,555 lines)

| File                                                | Next-coupled imports                                                          | Depth     | Adapter strategy                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `T.tsx`                                             | none (contentEditable + context)                                              | none      | shared as-is                                                                   |
| `RichText.tsx`                                      | none (Selection API - browser, not framework)                                 | none      | shared as-is                                                                   |
| `EditableMedia.tsx`                                 | none (`<img>`/`<video>`/`<iframe>` only)                                      | none      | shared as-is                                                                   |
| `EditableInfoList.tsx`                              | none                                                                          | none      | shared as-is                                                                   |
| `FocalPoint.tsx`                                    | none                                                                          | none      | shared as-is                                                                   |
| `Portal.tsx`                                        | none (`react-dom` createPortal)                                               | none      | shared as-is                                                                   |
| `CmsTour.tsx`                                       | none                                                                          | none      | shared as-is                                                                   |
| `SettingsDrawer.tsx`                                | none                                                                          | none      | shared as-is                                                                   |
| `VersionsDialog.tsx`                                | none (navigates via `window.location` already)                                | none      | shared as-is                                                                   |
| `IssuesPanel.tsx`                                   | none (`window.location.href` for page URL)                                    | none      | shared as-is                                                                   |
| `ContentProvider.tsx`                               | none (localStorage, IndexedDB, fetch, document listeners)                     | none      | shared as-is; `initialCms` comes from the host (see seam)                      |
| `icon-registry.ts` / `pageName.ts` / `shared-paths.ts` | none                                                                       | none      | shared as-is                                                                   |
| `CmsBar.tsx`                                        | `usePathname`, `useRouter` from `next/navigation` (one `router.push`; everything else is already `window.location`) | thin-shim | host nav seam (`usePathname` / `navigate`)                                     |
| `IssuesButton.tsx`                                  | `usePathname`                                                                 | thin-shim | host nav seam                                                                  |
| `PageMetaDrawer.tsx`                                | `usePathname`                                                                 | thin-shim | host nav seam                                                                  |
| `EditableImage.tsx`                                 | `next/image` (view mode only - edit/preview mode is already a plain `<img>`)  | thin-shim | host `Image` slot; default plain `<img>`                                       |

### Library (`lib/`, ~1,400 lines)

| File                                  | Next-coupled imports                                            | Depth      | Adapter strategy                                                                 |
| -------------------------------------- | ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `paths.ts` / `keys.ts` / `media.ts` / `config.ts` / `approved.ts` / `launch.ts` / `cmsMeta.ts` / `utils.ts` | none | none | shared as-is (config.ts is deliberately isomorphic already)                      |
| `backend/github.ts` / `backend/issues.ts` / `backend/types.ts` | none (fetch + env vars)                | none       | shared as-is - the storage seam is orthogonal to the framework seam               |
| `session.ts`                            | none from Next; `node:crypto` (HMAC)                            | none       | runs on any Node/Bun server; edge runtimes use `verifyEdge.ts`                    |
| `verifyEdge.ts`                         | none (Web Crypto, by design)                                    | none       | shared as-is                                                                      |
| `rateLimit.ts`                          | none (in-memory `Map`; assumes a long-lived process)            | none       | shared; document the serverless caveat per host                                   |
| `uploadStorage.ts`                      | none (IndexedDB, browser)                                       | none       | shared as-is                                                                      |
| `content.ts`                            | none (JSON import - any bundler inlines it, not Next-specific)  | none       | shared as-is                                                                      |
| `page-meta.ts`                          | `import type { Metadata } from "next"`; builds `generateMetadata` results | structural | split: neutral `resolvePageMeta()` in core, per-host head/meta builder on top |

### Server surface (structural by definition)

| File                                                  | Next-coupled imports                                        | Depth      | Adapter strategy                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `app/api/cms/*` - 17 routes, 1,513 lines               | `NextResponse`, ambient `cookies()` from `next/headers` (`resolve-map` also `NextRequest`) | structural | hoist bodies into neutral `(req: Request, ctx) => Response` handlers in core; each host mounts them (see seam) |
| ↳ `media/list/route.ts`                                 | plus `fs/promises` `readdir`                                 | structural | Node-only: needs `public/` on disk wherever the API runs - flag per host                                      |
| ↳ `login/route.ts`                                      | plus `node:crypto`, bcryptjs, rateLimit                      | structural | neutral handler; Node/Bun runtime requirement                                                                 |
| `middleware.example.ts`                                 | `next/server` (edge middleware, rewrite)                     | structural | per-host equivalent: RR root-loader gate / Start `beforeLoad` / SPA: not applicable                           |
| `app/cmsbar/login/page.tsx`                             | none (plain form + fetch + `window.location.assign`)         | none       | shared component; each host provides the route file                                                           |
| _host layout wiring_ (lives in the project, e.g. KEA's root layout) | `cookies()` → `verifySession` → `initialCms` prop | structural | this is `getServerSession` in the host seam                                                                   |

**A note on `"use client"`:** every component carries the directive. In RSC
frameworks (Next) it is load-bearing; in non-RSC hosts (React Router 7 today,
Vite SPA) it is inert - Vite/Rollup logs "module level directives" warnings.
Either strip it in the adapter build step or accept the warnings; do **not**
remove it from the source, because RSC hosts need it and React Router's
experimental RSC mode will too.

**A note on Tailwind:** the chrome is styled with Tailwind v4 utilities +
`styles/cmsbar.css` variables. Every Tier-1 target supports Tailwind v4, so it
stays a documented host prerequisite for now. Precompiling the chrome CSS to
drop the prerequisite is possible but out of scope here.

### Headline numbers

| Depth      | Lines      | Share | What it actually means                                                          |
| ---------- | ---------- | ----- | -------------------------------------------------------------------------------- |
| none       | ~6,000     | 64%   | ships in `@cms/core` untouched                                                   |
| thin-shim  | ~1,840     | 20%   | 4 files; the genuinely coupled surface is **~a dozen import/hook lines**         |
| structural | ~1,520     | 16%   | 17 API routes + middleware + page-meta + layout wiring - the real per-host work  |

The audit confirms PLAN.md's claim: the framework-specific surface is small,
and almost all of it is the server glue, not the editing UI.

---

## 2. The host seam, refined

PLAN.md sketched `CmsHost` as one interface. The audit says it is really **two
halves that ship separately** - the client half must be importable from browser
bundles without dragging in server code:

```ts
// Client half - provided via a HostProvider context, with DOM defaults.
interface CmsClientHost {
  usePathname(): string;                       // default: window.location.pathname (+ popstate)
  navigate(href: string): void;                // default: window.location.href = href
  Image: React.ComponentType<CmsImageProps>;   // default: plain <img>; @cms/next supplies next/image
  apiBase: string;                             // default: "/api/cms"
}

// Server half - per-host glue, never bundled client-side.
interface CmsServerHost {
  getServerSession(req: Request): CmsState | null; // → initialCms for ContentProvider
  mountApiHandlers(handlers: CmsApiHandlers): void; // framework route registration
  // head/meta: per-host builder over the neutral resolvePageMeta()
}
```

**The render gate** (RSC vs no-RSC): in Next, `ContentProvider` sits at a
server/client boundary and `initialCms` is computed in an RSC layout. In
non-RSC hosts everything is client: `initialCms` comes from the root
loader (React Router / Start) or, in a pure SPA, from a `GET /api/cms/session`
fetch on boot. The core never needs to know which - it just receives the prop.

PLAN.md's original caveat (kept here for the record): **do not freeze or publish
this interface from n=1** - it becomes a public contract only after the second
host proves it. **Resolved:** React Router validated it, TanStack Start
confirmed it held, and the Vite SPA + Astro exercised it without a core patch -
the seam is now frozen across all five hosts.

### Prerequisite core refactors (framework-neutral, pay off even if no adapter ever ships)

1. **Neutral route handlers.** Move the 17 route bodies into core functions
   `(req: Request, ctx: CmsRequestContext) => Promise<Response>` where `ctx`
   carries cookie read/write. The bodies are already mostly
   `(req: Request) => Response`-shaped - the only ambient Next API in use is
   `cookies()`. This is the **same motion Phase 3 needs** (routes consuming
   `CmsBackend` instead of importing `github.ts`) - do them together, once.
2. **One fetch wrapper.** 17 hardcoded `fetch("/api/cms/…")` call sites across
   the components → a single `cmsFetch()` reading `apiBase`. Small, do it in
   the template now.
3. **HostProvider with DOM defaults.** With the defaults above, the core runs
   in _any_ React host with zero adapter; adapters only improve it (next/image
   optimization, soft navigation). This is what keeps adapters honest-thin.

---

## 3. Target frameworks

### Tier 1 - shipped (built in this order)

#### React Router 7 (framework mode, formerly Remix) - the seam validator — SHIPPED

Built and proven end-to-end in **`examples/react-router`** (the whole API mounts
as one resource route → `handleCmsRequest`; root-loader session; nav via
`useLocation`/`useNavigate`; route `meta` from `resolvePageMeta()`). This host
validated and froze the seam.

| Seam            | Implementation                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Route mount      | resource routes: `({ request }) => Response` - the neutral handlers mount near-verbatim (one catch-all or a generated route file) |
| Session/cookies  | standard `Cookie` / `Set-Cookie` headers on Request/Response; no ambient API needed                              |
| `initialCms`     | root route loader reads the cookie via `getServerSession`, provider consumes loader data                          |
| Navigation       | `useLocation` / `useNavigate`                                                                                    |
| Image            | plain `<img>` default (RR has no blessed image component); optionally unpic later                                  |
| Page meta        | route `meta` export built from `resolvePageMeta()` - same per-page opt-in wiring as Next's `generateMetadata` today |
| Teaser gate      | root loader renders the teaser component when `!isSiteLive(...)` - full equivalent of the middleware              |

- **Shared 100%:** all of `lib/cmsbar` (incl. the GitHub backend), all components, login form, CSS, content model.
- **Effort: M** - the port itself is S once the neutral-handler refactor exists; it is M because that refactor lands _with_ this adapter.
- **Why first:** PLAN.md already points here. Loaders/actions over Web
  Request/Response are the strictest test of the handler seam without RSC
  noise, and it is the largest non-Next React community.

#### TanStack Start — SHIPPED

Built and proven end-to-end in **`examples/tanstack-start`** (the whole API
mounts as one splat server route → `handleCmsRequest`; root-loader session; page
meta via route `head()`). Mirrors the React Router example one-for-one and
confirmed the frozen seam held. Note: its Vite 7 toolchain needs a modern Node
(20.19+ / 22.12+).

| Seam            | Implementation                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Route mount      | file-based server routes with Web Request/Response - same neutral handlers. Plain routes, **not** server functions: the cookie-based session and the binary image proxy don't want serialized RPC |
| Session/cookies  | standard headers, as above                                                                              |
| `initialCms`     | root route loader / server function via `getServerSession`                                              |
| Navigation       | `@tanstack/react-router` `useLocation` / `useNavigate`                                                  |
| Image            | plain `<img>` default                                                                                   |
| Page meta        | route `head()` option over `resolvePageMeta()`                                                          |
| Teaser gate      | root route `beforeLoad`                                                                                 |

- **Shared 100%:** same list as React Router.
- **Effort: S-M** - S if the React Router adapter landed first and the seam
  held; M if it didn't (which is exactly the information we want early).

#### Vite + React SPA (+ server companion) — SHIPPED

The genuine architectural case PLAN.md flags: **no server means nowhere for
`GITHUB_TOKEN`, session signing, or fs media listing to live.** The answer is
not a thin adapter - it is a thin adapter _plus a small server you also ship_.
Built and proven end-to-end in **`examples/vite-spa`** (client-only Vite SPA +
a Hono companion on one origin):

1. **Client adapter: trivial — there is none.** The `HostProvider` DOM defaults
   already cover an SPA (`window.location` pathname + popstate, plain `<img>`,
   `apiBase` `/api/cms`). The example mounts the neutral host directly:
   `<HostProvider value={{ apiBase: "/api/cms" }}>`. `initialCms` comes from a
   boot-time `GET /api/cms/session` (the endpoint exists), with a brief
   "checking session" state before the chrome mounts.
2. **`@cms/server` - the companion (shipped):**
   - `createCmsApi(): (req: Request) => Promise<Response>` - one fetch-style
     dispatcher over the neutral core handlers
     (`lib/cmsbar/server/companion.ts`). Mount the whole API in one line; the
     example uses Hono: `app.all("/api/cms/*", (c) => cms(c.req.raw))`. The
     dispatcher strips `/api/cms` and 404s unknown paths itself.
   - Runtime: Node/Bun (the audit's `node:crypto` + `fs` rows). The
     filesystem-backed `media/list` needs a `public/` dir where the API runs -
     configurable media root, or that tab degrades to branch-based listing. The
     example runs the companion with `tsx` (it resolves the `@/…` path alias at
     runtime, same alias Vite uses for the client build).
   - Deployment: **(a) same origin** - the companion serves the built SPA from
     `dist/` (with an `index.html` SPA-fallback) AND the API on one port, so the
     signed session cookie just works; Vite dev gets a one-line `server.proxy`
     `/api/cms → companion` entry to preserve same-origin. This is what the
     example does. Or (b) separate origin with CORS + `SameSite=None` - works,
     but third-party-cookie headwinds make it the documented fallback.
- **Honest limitations (printed in the example README):** this is a CLIENT-ONLY
  SPA, no SSR. So:
  - **pageMeta / SEO drawer edits affect nothing a crawler sees.** A curl of
    `/` returns the static `index.html` shell + the bundle script, not the
    rendered content. Keep the drawer (it still writes the metadata into the
    content PR for a future SSR/SSG host), but label it as no-op for this target.
  - **The teaser ("coming soon") middleware has no equivalent** - there is no
    server render to gate, so `launch.mode` does not hide the site.
  - **Content ships inside the JS bundle** (`getContent()` is an import-time JSON
    read inlined at build), so the page renders only after the bundle boots.
  - `rateLimit` **is fine** - the companion is a single long-lived process, so
    the in-memory `Map` it relies on persists across requests.
- **Effort: M** (client S, companion M). The companion is also the seed of the
  Phase 9 gateway story and is directly reusable by Astro - it earns its cost
  twice.

### Tier 2 - Astro shipped; the rest build on demand

#### Astro (React islands) - strong fit, hard economics — SHIPPED

Built and proven end-to-end in **`examples/astro`**, with the design decision
resolved in favor of option (a), **editor-gated hydration**. The server seam was
the easy part: Astro endpoints are `Request → Response`, so the whole API mounts
as one catch-all endpoint —
`export const ALL = ({ request }) => createCmsApi()(request)`. The hard part was
the client: **every editable node would otherwise be a hydrated React island**,
and wrapping all site copy in `<T client:load>` defeats Astro's zero-JS pitch.
The shipped answer:

- (a) **editor-gated hydration (shipped)** - the content region is authored once
  as a React component; `index.astro` reads the editor session cookie
  server-side and applies `client:load` **only when an editor is present**.
  Public visitors and crawlers get fully server-rendered static HTML with zero
  CMS JS (SEO-equivalent to a static page, not a SPA); the hydrated island is
  served only to a logged-in editor. No double-authoring, no per-node islands.
- (b) always hydrate - works too, wrong default for the audience; not used.

**Verdict:** conceptually the best non-Next audience for a Git-as-CMS content
product, now shipped. **Effort was L** - not because of the seam, because of the
island-gating UX, which `examples/astro` resolves.

#### Next.js Pages Router - cheap, low value

Same `next/image`; `next/router` instead of `next/navigation` (one hook shim);
API routes are Node `(req, res)` style - a small adapter over the neutral
handlers; middleware works as-is; `initialCms` needs `getServerSideProps` /
`getInitialProps` plumbing (worse DX, fully workable). **Effort: S.** But the
audience is legacy and shrinking - don't spend core-team time. Publish the
seam, **accept/curate a community adapter**.

#### SvelteKit / Nuxt - a different product, not an adapter

The seam doesn't help here: the ~6,000 neutral lines are neutral **React**. A
Svelte/Vue port keeps `lib/` (~1,400 lines: paths, session, media rules,
GitHub backend) and the neutral server handlers, and **rewrites the entire
component layer** - provider, primitives, bar, drawers, panels. That is a
rewrite of most of the product per framework, with permanent sync debt. If
demand materializes, the honest shape is "CMSBar protocol": the neutral
handlers + content model are the product, and the Svelte UI is a new client
maintained by people who live there. **Effort: XL each. Not before the React
adapters have adoption.**

### Summary

| Framework             | Adapter implements                                        | Stays 100% shared                          | Effort | Status                                 |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------- | ------ | --------------------------------------- |
| Next.js (App Router)   | route handlers, login page, RSC layout wiring              | lib/, all components, CSS, content model    | —      | **shipped** — `examples/next` (reference) |
| React Router 7         | resource-route mount, root-loader session, nav hooks, meta | lib/, all components, CSS, content model    | M      | **shipped** — `examples/react-router` (froze the seam) |
| TanStack Start         | server-route mount, root-loader session, nav hooks, head() | same                                        | S-M    | **shipped** — `examples/tanstack-start` (Node 20.19+/22.12+) |
| Vite SPA + `@cms/server` | boot-time session, Hono/Express companion mount          | same (client side)                          | M      | **shipped** — `examples/vite-spa` (no SSR caveats) |
| Astro                  | endpoint mount + editor-gated island hydration             | lib/, handlers; primitives need integration | L      | **shipped** — `examples/astro` (editor-gated) |
| Next Pages Router      | router shim, (req,res) wrapper, GSSP session               | almost everything                           | S      | community adapter (seam published)      |
| SvelteKit / Nuxt       | full UI rewrite over shared lib/ + handlers                | lib/ + server handlers only (~20%)          | XL     | roadmap — not until demand proves it    |

---

## 4. Sequencing

1. **Phase 0 harness first - it does not exist yet.** The extraction is a
   refactor of a working production system, and PLAN.md gates Phases 1-3 on an
   integration harness that is still open. Honest order of operations: a thin
   smoke harness against the running Next routes first (a few end-to-end
   flows, GitHub mocked with msw/nock), **then** the neutral-handler refactor,
   **then** the full suite at the handler level - where tests construct
   `Request` objects and call handlers directly, no framework server needed.
   The refactor makes the harness cheap; the harness makes the refactor safe.
   KEA's manual regression checklist (PLAN.md _Verification_) backs both.
2. **Core seams in the template** - `cmsFetch`, HostProvider with DOM
   defaults, neutral `resolvePageMeta()`. These land in the existing copy-in
   template without breaking Next/KEA, and propagate to playground + KEA as
   usual.
3. **Package split** - `@cms/core` + `@cms/next` (the current code, re-homed).
   Only now does the monorepo shape appear; the copy-in template becomes a
   build artifact of the packages, so KEA and the playground never fork.
4. **`@cms/react-router`** - the seam validator. The host interface becomes a
   public contract only after this ships green.
5. **`@cms/start`** - cheap second confirmation.
6. **`@cms/server` + the Vite SPA guide** - unlocks SPAs, seeds Astro and the
   Phase 9 gateway. _Shipped: `examples/vite-spa`._
7. **Astro design spike** - go/no-go on editor-gated hydration. _Shipped:
   editor-gated hydration chosen, `examples/astro`._
8. **`cmsbar` CLI** - both modes (`cmsbar new <dir> --framework <fw>` /
   `cmsbar init`) across all five hosts. _Shipped: `packages/cli`._

### What NOT to do

- **No half-ports.** An adapter ships only when
  login → draft → edit → Save → PR → preview → approve-lock is green in the
  integration harness **and** a live example app exists. A README that says
  "should work with Remix" is worse than no adapter.
- **No per-framework forks of the core.** If an adapter needs to patch a core
  file, the seam is wrong - fix the seam. Copy-in distribution makes forking
  tempting; the monorepo + byte-identical propagation discipline is the defense.
- **Don't publish the host interface from n=1** (PLAN.md's caveat). Freeze it
  after React Router proves it, not before.
- **Don't rewrite the UI in Svelte/Vue for a hypothetical user.**
- **Don't build the SPA OAuth-device-flow path now.** The companion server
  covers SPAs sooner, and the Cloud control plane (Phase 9 token custody) is
  the long-term answer for serverless SPAs.

---

## TL;DR

- The audit says the product is already ~64% framework-neutral by line count;
  ~20% needs about a dozen shim lines behind a client host seam; the real
  per-framework work is the ~16% server glue (17 API routes, middleware,
  page-meta, layout wiring).
- Do the **neutral-handler refactor + integration harness as one motion** - it
  is the same work Phase 3 needs and it pays off even if no adapter ever ships.
- Shipped in this order: **Next (reference) → React Router 7 → TanStack Start
  → Vite SPA via `@cms/server` (Hono mount) → Astro (editor-gated).** All five
  have a live example in `examples/`; the `cmsbar` CLI scaffolds and adds them
  (`packages/cli`). Pages Router: community adapter. SvelteKit/Nuxt: rewrite
  tier, roadmap.
- One monorepo, one core. **Adapters are thin, or they are wrong.**
