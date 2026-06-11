# Productizing CMSBar - Strategy, Refactor Plan & Roadmap

> **Status (2026-06-11):** the extraction has started. A standalone repo exists at
> `/var/www/CMSBar` (shadcn-style copy-in product): Phase 1 (config layer) and Phase 2
> (CSS-variable theming) are **done** there, Phase 0 (test harness) is partially done
> (vitest core suite: paths incl. prototype-pollution guards, session sign/verify + edge
> mirror, media allowlists - integration harness still open), Phase 4 (CLI `init`) has a
> **working v1**, and Phase 3 (storage adapter) has the `CmsBackend` interface defined
> (`lib/cmsbar/backend/types.ts`) with GitHub as the reference implementation - routes do
> not consume the interface yet. KEA itself still runs the original in-tree CMS; folding
> KEA onto the extracted template is the next dogfooding milestone.

## Context

CMSBar is a hand-rolled, in-page CMS built into the KEA Next.js site (~8,400 lines across
`src/components/cms/` (~7,200 incl. issue reporting & page-meta drawers), `src/lib/cms/`,
and 17 routes under `src/app/api/cms/` (~1,240)). Editors log in, click any wrapped
piece of content (`<T path="home.hero.badge"/>`), edit it inline, and "Save" - which writes the
change into `content/site-content.json` on a `cms/*` Git branch and opens a GitHub PR. Approval is
a GitHub label; preview renders any branch's content live; uploads stage in IndexedDB and commit as
blobs. No database - content is a JSON file, the production container is stateless.

The architecture is already cleanly compartmentalized and ~65-70% project-agnostic. The goal is to
turn it into a **reusable, configurable product** that other projects - including those built by
"vibe coders" - can adopt.

**Product decisions (confirmed with user):**

- **Deliverable now:** this strategy + roadmap, with concrete refactor instructions (config layer,
  theming, decoupled paths). No code changes yet.
- **Distribution:** shadcn-style CLI - copy the CMS into the target repo so the user owns the code
  (sidesteps the pain of shipping Next.js API route handlers + Tailwind in an npm package).
- **Backend:** pluggable storage adapter (GitHub is the first adapter; GitLab/file/DB later).
- **Onboarding:** invest in auto-setup - a codemod / AI-assisted tool that wraps existing content
  and generates the schema, so adoption isn't "hand-wrap every string."

## Product positioning

"**Git-as-CMS you drop into your own codebase.**" Content lives as JSON in the repo; edits are
branches + PRs; review is your normal Git workflow; no external service, no database, no vendor
lock-in. The CLI installs it; the auto-wrap tool makes existing pages editable in minutes. The
pluggable backend keeps the door open for non-GitHub teams.

---

## What's already reusable (keep as-is)

These are generic and need little to no change:

- **Editable primitives** - `T.tsx`, `RichText.tsx`, `EditableImage.tsx`, `EditableMedia.tsx`,
  `EditableInfoList.tsx`. They take a `path` string and delegate to context. No business logic.
- **State engine** - `ContentProvider.tsx` is generic over content shape. It already receives
  `content` and `initialCms` as props (lines 151-159) and resolves preview > blob > override >
  bundled (lines 296-305).
- **Path helpers** - `resolvePath` / `setPath` in `src/lib/content.ts` (lines 186-225) are fully
  generic. Move them into the package; leave the project's _schema type_ in the project.
- **Local persistence** - `uploadStorage.ts` (IndexedDB), localStorage logic. Generic except the
  hardcoded `kea_` key prefix.
- **Git Data plumbing** - `github.ts` is env-var driven and has no KEA specifics; it becomes the
  reference backend adapter.

---

## Coupling inventory (what blocks reuse) - and the fix for each

| #   | Coupling (file)                                                                                                  | Fix                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Schema type + bundled JSON import `../../content/site-content.json` (`content.ts:4-6,180`)                       | Make CMS **generic over content shape**. Package owns `resolvePath/setPath`; the _project_ owns its `SiteContent` type + `site-content.json`, passed into `ContentProvider content={...}`. |
| 2   | Route→title map, Croatian slugs (`pageName.ts:STATIC`)                                                           | Config option `pageTitles: Record<string,string> \| (path)=>string`.                                                                                                                       |
| 3   | Hardcoded `kea_cms_pending_*` / `kea_cms_preview` keys (`ContentProvider.tsx:31,430`)                            | Config `namespace` → `${namespace}_cms_*`.                                                                                                                                                 |
| 4   | Cookie name `kea_cms`, env names `CMS_*`/`GITHUB_*` (`session.ts`, `github.ts:3-12`)                             | Read from config; default cookie `${namespace}_cms`.                                                                                                                                       |
| 5   | Media folder allowlist `public/images/`,`public/media/` (`commit/route.ts:93-95`, `ContentProvider.tsx:356-361`) | Config `mediaFolders: string[]`.                                                                                                                                                           |
| 6   | Login route `/cmsbar/login` baked into UI                                                                        | Config `basePath`/`loginPath`.                                                                                                                                                             |
| 7   | Tailwind tokens `kea-pink/kea-blue/kea-peach`, `font-hand` in primitives + `CmsBar`                              | **Theming via CSS variables** (see below).                                                                                                                                                 |
| 8   | `SHARED_PREFIXES` list (`shared-paths.ts:6-14`)                                                                  | Config `sharedPrefixes: string[]`.                                                                                                                                                         |
| 9   | GitHub hardwired in every `api/cms/*` route                                                                      | **Storage adapter interface** (see below).                                                                                                                                                 |
| 10  | Content-at-rest path `content/site-content.json` (commit/preview routes)                                         | Config `contentFile`.                                                                                                                                                                      |
| 11  | RichText sanitizer allows `span.font-hand` (`RichText.tsx:65-99`)                                                | Config `allowedTags`/`allowedClasses`.                                                                                                                                                     |

---

## Architecture at a glance - before vs. after

### Today (locked to one project)

```
┌─────────────────────────────── KEA Next.js app ───────────────────────────────┐
│                                                                                │
│  Pages  ──<T path="home.hero.badge"/>──┐                                       │
│                                        ▼                                       │
│  ┌─────────────────────────────────────────────────┐                          │
│  │ CMS primitives  T · RichText · EditableImage ·…  │  ← kea-pink / font-hand  │
│  │ (generic, but styled with KEA Tailwind tokens)   │     hardcoded            │
│  └───────────────────────┬─────────────────────────┘                          │
│                          ▼                                                     │
│  ┌─────────────────────────────────────────────────┐                          │
│  │ ContentProvider  (kea_cms_* localStorage keys)   │  ← KEA-specific keys     │
│  └───────────────────────┬─────────────────────────┘                          │
│                          ▼                                                     │
│  content/site-content.json  +  SiteContent type   ← schema hardcoded in repo   │
│                          ▼                                                     │
│  app/api/cms/*  ──────────────────────────────────►  github.ts  ──► GitHub PR  │
│  (17 routes, GitHub calls inlined)                    (only backend)           │
│                                                                                │
│  Bound to: Next.js App Router · GitHub · KEA schema · KEA theme · /cmsbar      │
└────────────────────────────────────────────────────────────────────────────────┘

   ✗ Can't install elsewhere   ✗ One backend   ✗ One framework   ✗ One look
```

### After refactor (a product anyone installs)

```
                         ╔══════════════════════════════════════╗
                         ║   cms.config.ts  (one typed config)   ║
                         ║  namespace · theme · backend · paths  ║
                         ╚════════════════════╦═════════════════╝
                                              │ injected everywhere
   ┌──────────────────────────────────────────┼──────────────────────────────────┐
   │  @cms/core  (framework-neutral package)   │                                  │
   │                                           ▼                                  │
   │  CMS primitives ──► ContentProvider ──► resolvePath / setPath               │
   │  (themed via CSS vars: --cms-accent …)   (generic over YOUR content type)   │
   │            │                                                                 │
   │            │ depends on two small interfaces ↓↓                              │
   │   ┌────────┴─────────┐                  ┌─────────────────────┐              │
   │   │   CmsHost        │                  │   CmsBackend        │              │
   │   │ (framework seam) │                  │ (storage seam)      │              │
   │   └────────┬─────────┘                  └──────────┬──────────┘              │
   └────────────┼───────────────────────────────────────┼─────────────────────────┘
                │ pick one adapter                       │ pick one adapter
       ┌────────┴────────┐                      ┌────────┴─────────┬─────────────┐
       ▼                 ▼                      ▼                  ▼             ▼
  @cms/next      @cms/tanstack-start      githubAdapter      fileAdapter   gitlab/db…
  (App Router)   (Start server fns)       (PR workflow)      (local JSON)   (future)

  Installed by:  npx <product> init   +   npx <product> wrap  (auto-make existing pages editable)

   ✓ Drop into any project   ✓ Swap backend   ✓ Swap framework   ✓ Re-theme to match your brand
```

**What changes, in one line:** everything KEA-specific moves out of the code and into a single
`cms.config.ts`, and the two hardwired dependencies - _framework_ and _storage_ - become swappable
adapters behind small interfaces. The editing experience stays identical; only the coupling leaves.

---

## Target architecture

### 1. Single config object - `cms.config.ts`

One typed config consumed by both client and server:

```ts
export const cmsConfig = {
  namespace: "mysite",                 // storage keys + cookie prefix
  basePath: "/cmsbar",                 // login + UI routes
  contentFile: "content/site-content.json",
  mediaFolders: ["public/images", "public/media"],
  sharedPrefixes: ["site.", "nav.", "header.", "footer."],
  pageTitles: { "/": "Home", "/about": "About" },
  richText: { allowedTags: [...], allowedClasses: ["font-hand"] },
  theme: { /* CSS var overrides, see below */ },
  approvedLabel: "cmsbar approved",
  backend: githubAdapter({ owner, repo, base }), // pluggable
};
```

Thread it via a server-read singleton + pass the client-safe subset into `ContentProvider`.

### 2. Theming via CSS variables

Replace `kea-*` utility classes in CMS chrome/primitives with CSS custom properties
(`--cms-accent`, `--cms-accent-shared`, `--cms-ring`, etc.) defaulted in a stylesheet the CLI
installs. Editors' outline rings (`T.tsx:86-92`, `RichText.tsx:170-177`) and `CmsBar` colors read
the vars; projects override in their globals. `font-hand` becomes an optional themable class.

### 3. Pluggable storage adapter

Define the interface the API routes depend on; today's `github.ts` becomes the first impl:

```ts
interface CmsBackend {
  startDraft(title, pagePath): Promise<Draft>;
  fork(fromBranch, title): Promise<Draft>;
  commit(
    branch,
    { edits, uploads, folders, deletes }
  ): Promise<{ prUrl; prNumber }>;
  getContent(branch): Promise<SiteContent>; // preview
  listDrafts(): Promise<DraftSummary[]>; // versions
  checkApproval(branch): Promise<{ approved; label }>;
  readMedia(branch, path): Promise<Bytes>; // image proxy
  listMedia(branch): Promise<string[]>;
}
```

The 17 `api/cms/*` routes shrink to thin wrappers: `const backend = cmsConfig.backend; return backend.x()`.
Ship `githubAdapter` (port `github.ts` + commit/route logic) and stub `fileAdapter` (local FS, for
single-author / no-GitHub use) to prove the abstraction.

### 4. Distribution - shadcn-style CLI

`npx <product> init` copies `components/cms/`, `lib/cms/`, `app/api/cms/`, the login page, theme
CSS, and a generated `cms.config.ts` into the target repo; prompts for env (`CMS_USER`,
`CMS_PASSWORD_HASH`, backend creds) and writes `.env.local`; injects `<ContentProvider>` into the
root layout. User owns the code thereafter.

### 5. Auto-setup - `npx <product> wrap`

Codemod (ts-morph/jscodeshift) + optional AI pass that: scans page JSX for static text/images,
wraps them (`<T path>` / `<EditableImage path>`), hoists values into `site-content.json`, and
generates/extends the `SiteContent` type. AI handles judgement calls (sensible path names, which
strings are content vs. layout). This is the biggest adoption lever and the riskiest piece - ship
it last, behind the stable config + adapter foundations.

### 6. Framework support - neutral core + thin adapters (not separate repos)

CMSBar is Next.js App Router-bound today, but the framework-specific surface is _small_: server-side
session reading, the API route handlers, navigation hooks (`usePathname`/`useRouter`), and
`next/image`. Everything else (primitives, `ContentProvider`, path helpers, IndexedDB, the GitHub
adapter logic) is already framework-neutral.

**The design: one monorepo, a neutral core + per-framework adapter packages** - _not_ a repo per
framework (that fragments the core and creates version-sync hell). The core depends on a small
**host interface**; each framework package implements it:

```ts
interface CmsHost {
  getServerSession(): Promise<CmsState>; // read auth cookie server-side
  usePathname(): string;
  navigate(href: string): void;
  ImageComponent: React.ComponentType<ImgProps>; // next/image or <img>
  mountApiHandlers(backend: CmsBackend): RouteHandlers; // framework route glue
}
```

- `@cms/core` - primitives, provider, path helpers, upload storage, `CmsBackend` interface +
  `githubAdapter`. Imports zero framework code.
- `@cms/next` - implements `CmsHost` for App Router (the current code, re-homed).
- `@cms/tanstack-start` - implements `CmsHost` via TanStack Start server functions/routes.
- The CLI installs **core + the matching adapter**.

**Critical caveat - TanStack _Start_ vs TanStack _Router_:**

- **TanStack Start** (full-stack, has a server) → straightforward. Server functions host the
  GitHub-calling endpoints; `GITHUB_TOKEN` stays server-side. Just another adapter.
- **TanStack Router alone** (client-only SPA, _no server_) → the blocker isn't routing, it's that a
  repo-write token can't live in the browser. Needs either a small deployable serverless endpoint
  for the `api/cms/*` surface, or a token-less **GitHub OAuth device flow** using the editor's own
  identity. This is a real architectural decision, not a thin adapter - scope it explicitly when an
  SPA target comes up.

---

## Roadmap (phased)

- **Phase 0 - Test harness (new; partially done):** the extraction is a refactor of a working
  production system that previously had _zero_ automated tests. Before deeper refactors land:
  unit suite for the core (✔ shipped in the standalone repo - paths/proto-guards, session,
  media allowlists) plus an **integration harness** (mock the GitHub API with msw/nock; drive
  start→edit→commit→preview→approve→fork end-to-end) (✘ open). Phases 1-3 changes ride on this.
- **Phase 1 - Config layer (decouple): ✔ done in the standalone repo.** `cms.config.ts` owns
  namespace, content file, media folders, branch prefix, shared prefixes, pages, approval label,
  rich-text decor class; storage keys derive from the namespace (`lib/cmsbar/keys.ts`).
  **`CmsHost` caveat:** the seam is _identified_ (session read, nav hooks, Image, route glue) but
  deliberately **not frozen as an interface yet** - an interface extracted from a single
  implementation is usually the wrong interface. Validate it against a second host (a TanStack
  Start spike) _before_ publishing it as a public contract.
- **Phase 2 - Theming: ✔ done in the standalone repo.** All editor chrome reads `--cmsbar-*` CSS
  variables (`styles/cmsbar.css`); projects re-brand by overriding variables, no component edits.
- **Phase 3 - Storage adapter (in progress):** `CmsBackend` interface defined
  (`lib/cmsbar/backend/types.ts`); GitHub remains the reference implementation the routes import
  directly. Remaining: make the routes consume the interface, move the Git-Data commit
  choreography into the adapter, add a minimal `fileAdapter` to validate the seam.
- **Phase 3b - Content drift & merge (new; load-bearing for product):** today, concurrent drafts
  and base-branch movement resolve as "last merge wins, silently" - the known
  `GITHUB_BASE_BRANCH`-stale gotcha is one instance of a general class. A multi-tenant product
  needs: (a) **draft freshness detection** (draft behind base → visible "rebase?" state in the
  bar), (b) **path-level three-way merge** of the content JSON (the dotted-path machinery makes
  this tractable), (c) **schema versioning** - a version field in the content file plus a "this
  draft predates a schema change" warning, so renaming a content key doesn't strand open drafts.
  For an agency product this is the #1 support-ticket generator; rank it above polish.
- **Phase 4 - CLI (`init`): ✔ v1 done in the standalone repo.** `npx cmsbar init` detects
  src/root layout, copies the template, sets the namespace, appends env keys to `.env.example`,
  prints wiring steps. Remaining: automatic layout injection, `--existing-project` ergonomics,
  npm publish.
- **Phase 5 - Auto-wrap (`wrap`):** Codemod + AI-assisted content extraction & schema generation.
- **Phase 6 - Docs, examples, PoC:** Rewrite `CMS.md` as product docs (per-project schema, config
  reference, theming, writing a backend adapter); add a starter example; dogfood by installing into
  a blank Next.js app end-to-end.
- **Phase 7 - OSS launch (the free funnel):** Marketing site + Product Hunt. No paid infra yet -
  this exists to drive adoption, stars, and inbound. _Gated on Phases 4-6 being usable._
- **Phase 8 - AI-wrap credits (the wedge):** Ship the hosted auto-wrap API + credit billing.
  Lowest infra, clearest willingness-to-pay, sellable even to OSS self-hosters - the first dollar in.
- **Phase 9 - Cloud control plane (the recurring product):** GitHub App token custody, editor
  identity (no GitHub account for clients), preview deploys + media CDN, approval dashboard, and
  seat/project billing. **Gated on OSS traction** - do not build this before adoption proves demand.
  See _Monetization_ below for what each piece sells. **Include a rate-limit budget line item:**
  per-editor 30s draft polling + media proxied through the Contents API + version listings all
  ride one PAT's 5,000 req/h today. At agency scale that ceiling arrives fast. The control plane
  is also the natural fix - GitHub App installation tokens get per-installation limits, plus
  ETag/conditional-request caching in the gateway - which materially strengthens the
  control-plane pitch; say so explicitly when selling it.

**Parallel track - framework adapters (on demand, not blocking the Next.js path):** once the
`CmsHost` seam exists (Phase 1) and the core is package-split (alongside Phase 3-4), a new framework
is one thin adapter package. Build `@cms/tanstack-start` when a real target appears. The
TanStack-Router-SPA case is _not_ in this track - it needs a backend/auth decision first (serverless
endpoint or OAuth device flow) and should be scoped separately.

KEA stays on the same code throughout - each phase keeps the live site working by having KEA supply
its own config/theme/adapter, so the product and the production site never fork.

## Critical files to touch (Phase 1-3)

- `src/lib/content.ts` - split generic helpers (package) from project schema/JSON (project).
- `src/components/cms/ContentProvider.tsx` - config-driven keys; generic content type.
- `src/components/cms/{T,RichText,EditableImage,EditableMedia,EditableInfoList,CmsBar}.tsx` - theme
  vars; config-driven media folders / sanitizer.
- `src/components/cms/{pageName.ts,shared-paths.ts}` - config-driven.
- `src/lib/cms/{session.ts,github.ts}` - config-driven names; github → adapter.
- `src/app/api/cms/**` - route handlers become thin adapter wrappers.

## Verification

- **KEA regression (every phase):** `pnpm dev`, log in at `/cmsbar/login`, start a draft, edit text
  - swap an image + edit an info list, Save → confirm a `cms/*` PR is created with the JSON +
    blob changes, preview the branch, verify approval label locks editing. Live site must behave
    identically to today after each phase.
- **Adapter seam (Phase 3):** run KEA against `githubAdapter` (current behavior) and a throwaway
  project against `fileAdapter` (edits land in a local JSON file) - same UI, different backend.
- **CLI (Phase 4):** in a fresh `create-next-app`, run `init`, add one `<T>` to a page, log in, edit,
  Save - confirm the configured backend persists it. No KEA-specific strings anywhere in output.
- **Auto-wrap (Phase 5):** run `wrap` on an unmodified page; confirm rendered output is unchanged,
  content moved into JSON, schema compiles, and every wrapped node is editable.

---

## Adoption: greenfield vs. brownfield

Both are supported by design - they just lean on different parts of this plan.

### Greenfield (starting fresh) - the happy path

- `npx <product> init` scaffolds the provider, login, API routes, config, and theme into a new
  Next.js app.
- Author content as JSON + schema from day one; build pages with the `<T>` / `<EditableImage>` / …
  primitives. Editability is native - nothing to retrofit.

### Brownfield (already in development) - supported, incrementally

The primitives are **additive**: `<T path>` renders the bundled value when not editing, so you can
make a single section editable and leave the rest untouched. Retrofit relies on four things:

1. **Auto-wrap codemod (Phase 5) is the enabler, not a nicety.** It scans existing JSX, lifts static
   text/images into the content JSON, generates the schema, and swaps in `<T>`. Without it, retrofit
   means hand-wrapping hundreds of strings. Run it per-page/per-section - big-bang or gradual.
2. **Non-destructive CLI injection.** `init` needs an "existing project" mode: detect the root
   layout, insert `<ContentProvider>` _around_ (not replacing) existing providers, mount `<CmsBar>`,
   merge env/config.
3. **Scoped, themed chrome (Phase 2 matters more here).** The CMS UI must ship self-contained styles
   / a class namespace + CSS variables so it doesn't inherit or pollute the host's Tailwind / design
   tokens.
4. **Coexistence with existing content sources.** Copy hardcoded in JSX → auto-wrap moves it into
   CMSBar's JSON. Copy already from a DB / headless CMS / MDX → either wrap only the static/marketing
   copy and leave dynamic data alone, or write a backend adapter (Phase 3) that reads/writes the
   existing store instead of a JSON file. You only make editable what you wrap.

**The honest constraint:** drop-in retrofit is clean for **Next.js App Router** today. Other
server-backed frameworks (**TanStack Start**, Remix) are reachable via a thin `CmsHost` adapter once
the seam is carved - see _Framework support_ in the architecture. **Client-only SPAs** (TanStack
Router alone, Vite SPA) are the genuine exception: with no server, a repo-write token has nowhere
safe to live, so they need a backend/auth decision (serverless endpoint or GitHub OAuth device flow)
before adoption. Vet a brownfield target on the _has-a-server?_ axis first.

> Implication: **Phase 2 (scoped theming)** and **Phase 5 (auto-wrap)** are load-bearing for
> brownfield, not optional polish. Weight them accordingly.

---

## Monetization (upgraded)

### Why the obvious model - "free OSS + paid Pro license key" - doesn't hold here

Three structural problems, each fatal on its own:

- **Copy-in defeats license enforcement.** The shadcn-style CLI puts the code _in the user's repo_.
  A license-gated feature sitting in their own source is one deleted `if` away from free. You cannot
  reliably gate or meter code you've already handed over.
- **No billing surface.** Pure copy-in core + a Git backend has _zero_ marginal cost and _no server
  in the loop_ - nothing to meter, nothing that recurs. Recurring revenue needs something you operate.
- **The old "Pro" list was a grab-bag.** AI auto-wrap, SSO, audit log, theming presets, extra
  adapters - wildly different buyers. SSO/audit are enterprise; theming presets are trivial; adapters
  get OSS'd by the community. None is a defensible willingness-to-pay anchor.

### Who actually pays - and who doesn't

- **Solo devs / vibe coders (own projects):** ≈ $0 recurring. Technical, price-sensitive, will
  self-host. **They are the funnel, not the revenue.** Charging them recurring just kills adoption.
- **Agencies & freelancers (many client sites):** **the real buyer.** They ship N sites/year and
  must hand content editing to non-technical clients _without_ hosting a CMS, teaching Git, or
  fielding "I broke the site" calls. Their cost scales with their client book - and they rebill it.
- **The non-technical client (the editor):** doesn't buy, but is the **unit of recurring value** -
  an active editor on a live site is what the agency is paying to keep turnkey.

### The principle: sell the managed control plane, not the code

Keep the **OSS core fully functional self-hosted** (own PAT, bcrypt auth, GitHub-label approval).
**Charge for a hosted control plane** - the parts that genuinely cost money to run and that an agency
would never want to build or operate:

- **GitHub App token custody** - no PAT juggling, and the _only_ clean way to serve client-only SPAs
  (the repo-write token lives in the service, never the browser).
- **Editor identity** - magic-link / email auth so clients edit _without a GitHub account, never
  seeing GitHub at all_.
- **AI auto-wrap as a metered service** - inference has real COGS; the value ("make this existing
  site editable in minutes") is concrete and one-time-painful. The cleanest meter in the product.
- **Draft preview deploys + media CDN** - committing images as Git blobs bloats repos; hosted media
  - per-branch preview URLs are a real, ongoing service.
- **Approval dashboard** - the agency's cockpit across many client sites.

This is the **Decap / TinaCMS playbook, done deliberately.** TinaCMS gives away the Git-backed editor
and sells _Tina Cloud_ (auth + media + data layer); Decap is free and Netlify monetizes the
_Identity + Git Gateway_. The CMS is the funnel; the **gateway / identity / media / AI layer is the
product.** This isn't crippling OSS - it sells custody, identity, AI, and convenience, which
_segment naturally_: a dev self-hosting for themselves needs none of it; an agency serving clients
needs all of it.

### The unit of value

Bill on what scales with delivered value: **connected projects × active editor seats, plus AI credits
as a usage adder.** Per-site alone undercharges multi-editor agencies; per-seat alone is clumsy for
many tiny sites; the combination lets agencies predict cost and grow spend with their client book.

### Tiers

- **OSS - Free (MIT):** CLI, primitives, `githubAdapter` + `fileAdapter`, self-hosted auth, label
  approval. Goal: adoption, stars, inbound, switching cost. _Every install is a lead._
- **Cloud Hobby - Free:** 1 project, 2 editors, capped AI-wrap credits. Keeps the funnel alive on the
  hosted side; converts as the client book grows.
- **Cloud Studio - paid (agencies):** N projects + M editor seats + monthly AI credits; overage per
  extra project / seat / credit. **The core revenue tier.**
- **Agency / White-label - paid:** the client never sees "CMSBar"; wholesale per-seat or rev-share.
  The agency does sales + support, so margin is best here.
- **Enterprise / self-managed cloud:** SSO/SAML, audit log, VPC/on-prem control plane, SLA. _This_ is
  where SSO and audit log belong - enterprise buyers pay for them, indies don't.

### The wedge - sell AI-wrap credits first (revised: validate before you build billing)

The AI auto-wrap remains the **first metered product candidate**: lowest infra (a stateless
inference endpoint + credit billing), concrete value, sellable **even to OSS self-hosters**
(they run the CMS but call your hosted wrap API). _(Roadmap Phase 8.)_

**But be honest about the moat.** The exact target buyer (agencies, vibe coders) already sits in
Cursor / Claude Code, and "wrap my JSX in `<T>` and extract a schema" is precisely the kind of
task they'll hand to their own agent - especially if CMSBar's docs are good enough to teach the
transformation. The wrap _capability_ is a huge adoption lever; the wrap _revenue_ has a thin
moat in the agentic era.

**Cheaper test of the same hypothesis:** ship the wrap first as a free, open codemod + agent
skill (near-zero infra), instrument adoption, and only build the hosted credit-billed API if
people who already have AI tooling still ask for the hosted version (one-click, no setup, schema
quality guarantees). If the wedge underperforms, the durable revenue is where the rest of this
section already puts it: token custody, editor identity, previews/CDN, dashboard. The sequencing
principle ("never build billing infra ahead of adoption signal") applies to the wedge itself.

### Secondary streams (real, smaller)

- **Managed media / CDN add-on** - real COGS, clean upsell, keeps repos lean.
- **Starter / template marketplace** - paid pre-wrapped Next.js + schema kits for agencies;
  community-extensible with rev-share.
- **Support / SLA contracts** - for shops running self-hosted at scale.

### Viability - honest

- **Cannibalization?** No: cloud sells what's painful to _self-operate_ (client identity, token
  custody, AI COGS, preview/CDN). A dev self-hosting for themselves needs none of those; an agency
  serving clients needs all of them. The segmentation is natural, not artificial crippling.
- **GitHub-only ceiling?** The hosted gateway + pluggable backend widen it - cloud can manage the git
  backend so the end client needs no GitHub org at all.
- **Don't meter OSS.** No phone-home (privacy-hostile and trivially stripped). Meter _only_ the cloud
  plane, where you legitimately see the traffic.
- **The ceiling is real.** This is a strong indie-SaaS / acquisition-bait shape, not a venture
  rocket - _unless_ AI-wrap usage and the agency white-label motion compound. Expectations: modest,
  durable, low-COGS, with one genuine upside vector (AI-wrap revenue scaling with the AI-coding wave).

### Marketing site + launch

A single Next.js landing page, **dogfooded - built _with_ CMSBar so the demo is the product:**

- Hero: _"Git-as-CMS you drop into any site - your client edits, you get a PR."_
- One-line install + a 20s inline-edit→PR GIF, live playground, pricing, docs + OSS repo links.
- Product Hunt angle: _"Let your AI agent build the site - let your client edit it. No CMS, no
  dashboard."_ Distribute through AI-coding / vibe-coder communities alongside the PH push.

> The OSS launch (Phase 7) only makes sense once Phases 4-6 make adoption one-command-easy; the paid
> control plane (Phase 9) only makes sense once that launch proves demand. **Sequence: free funnel →
> AI-wrap wedge → control plane.** Don't build billing infrastructure ahead of adoption signal.
