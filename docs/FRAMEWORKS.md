# Framework support - dependency audit & adapter proposal

> **Status (2026-06-12): proposal, nothing here is built.** Companion to
> _Framework support_ in [PLAN.md](./PLAN.md) §6, which fixed the architecture:
> **one monorepo, a neutral `@cms/core` + per-framework adapter packages** over a
> small host interface - not a repo per framework. This doc does the work that
> decision implies: audit the actual Next.js coupling file by file, spec each
> target adapter against that audit, estimate effort honestly, and recommend an
> order. The Phase 0 integration harness is a hard prerequisite and **does not
> exist yet** - see _Sequencing_.

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

PLAN.md's caveat stands and is repeated here on purpose: **do not freeze or
publish this interface from n=1.** It becomes a public contract only after the
second host (React Router) proves it.

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

### Tier 1 - build these, in this order

#### React Router 7 (framework mode, formerly Remix) - the seam validator

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

#### TanStack Start

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

#### Vite + React SPA (+ server companion)

The genuine architectural case PLAN.md flags: **no server means nowhere for
`GITHUB_TOKEN`, session signing, or fs media listing to live.** The answer is
not a thin adapter - it is a thin adapter _plus a small server you also ship_:

1. **Client adapter: trivial.** The HostProvider DOM defaults already cover an
   SPA. `initialCms` comes from `GET /api/cms/session` on boot (the endpoint
   exists), with a brief "checking session" state before the chrome mounts.
2. **`@cms/server` - the companion (spec):**
   - exports `createCmsApi(config): (req: Request) => Promise<Response>` - one
     fetch-style dispatcher over the neutral core handlers - plus ready-made
     mounts: Hono (`app.route("/api/cms", …)`) and Express
     (`app.use("/api/cms", toNodeHandler(…))`).
   - Runtime: Node/Bun (the audit's `node:crypto` + `fs` rows). The
     filesystem-backed `media/list` needs a `public/` dir where the API runs -
     configurable media root, or that tab degrades to branch-based listing.
   - Deployment: **(a) same origin via reverse proxy** `/api/cms/* →` companion
     (recommended - cookies just work; Vite dev gets a one-line
     `server.proxy` entry), or (b) separate origin with CORS +
     `SameSite=None` - works, but third-party-cookie headwinds make it the
     documented fallback, not the default.
- **Honest limitations to print in the SPA docs:** no SSR, so pageMeta/SEO
  drawer edits affect nothing a crawler sees (keep the drawer, label it); the
  teaser middleware has no equivalent; `rateLimit` is fine (the companion is a
  long-lived process).
- **Effort: M** (client S, companion M). The companion is also the seed of the
  Phase 9 gateway story and is directly reusable by Astro - it earns its cost
  twice.

### Tier 2 - proposed, build on demand

#### Astro (React islands) - strong fit, hard economics

The server seam is the easy part: Astro endpoints are `Request → Response`, so
the companion handlers mount in an afternoon. The hard part is the client:
**every editable node is a hydrated React island.** Wrapping all site copy in
`<T client:load>` defeats Astro's zero-JS pitch for the public visitor. The
honest options:

- (a) **editor-gated hydration** - public visitors get static HTML, a detected
  editor cookie switches the page to hydrated primitives. Needs a small Astro
  integration and real design work; this is the version worth shipping.
- (b) always hydrate - works today, wrong default for the audience.

**Verdict:** conceptually the best non-Next audience for a Git-as-CMS content
product; do a design spike _after_ Tier 1. **Effort: L** - not because of the
seam, because of island-gating UX.

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

| Framework             | Adapter implements                                        | Stays 100% shared                          | Effort | When                          |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------- | ------ | ------------------------------ |
| React Router 7         | resource-route mount, root-loader session, nav hooks, meta | lib/, all components, CSS, content model    | M      | first - validates the seam     |
| TanStack Start         | server-route mount, root-loader session, nav hooks, head() | same                                        | S-M    | second - confirms the seam     |
| Vite SPA + `@cms/server` | boot-time session, Hono/Express companion mount          | same (client side)                          | M      | third - unlocks SPA + Astro    |
| Astro                  | endpoint mount + editor-gated island hydration             | lib/, handlers; primitives need integration | L      | design spike after Tier 1      |
| Next Pages Router      | router shim, (req,res) wrapper, GSSP session               | almost everything                           | S      | community adapter              |
| SvelteKit / Nuxt       | full UI rewrite over shared lib/ + handlers                | lib/ + server handlers only (~20%)          | XL     | not until demand proves it     |

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
   Phase 9 gateway.
7. **Astro design spike** - go/no-go on editor-gated hydration.

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
- Order: **React Router 7 → TanStack Start → Vite SPA via `@cms/server`
  (Hono/Express mount) → Astro spike.** Pages Router: community adapter.
  SvelteKit/Nuxt: rewrite tier, not now.
- One monorepo, one core. **Adapters are thin, or they are wrong.**
