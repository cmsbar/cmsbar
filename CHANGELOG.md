# Changelog

All notable changes to CMSBar are documented here. The published npm package is
[`cmsbar`](https://www.npmjs.com/package/cmsbar) (the `cmsbar new` / `cmsbar init`
CLI in `packages/cli`); the editor, neutral core, and per-host examples live in
this monorepo. This project follows [semantic versioning](https://semver.org);
pre-1.0, minor versions may add features and the API can still shift.

## [0.2.1] — 2026-06-16

Security patch for the example hosts (the templates `cmsbar new` scaffolds from).

### Security

- **`examples/astro` → Astro 6** (`astro@^6.4.6`, `@astrojs/node@^10.0.5`,
  `@astrojs/react@^5`), clearing the SSR advisories that have no Astro 5.x
  backport: Host-header SSRF (CVE-2026-54299, 7.5), reflected XSS via slot name
  (CVE-2026-50146, 7.1), spread-props XSS (CVE-2026-54298), `define:vars` XSS
  (CVE-2026-41067), server-island replay (CVE-2026-45028), cache poisoning
  (CVE-2026-41322), and Server Islands DoS (CVE-2026-29772).
- **`examples/tanstack-start` → `srvx@^0.11.13`**, clearing the middleware
  bypass (CVE-2026-33732).

### Changed

- The Astro example now requires **Node ≥ 22.12.0** (Astro 6's floor; it
  hard-fails on Node 20) and pins **`cssesc`** so the standalone SSR server
  boots — Astro 6 emits a phantom build-only `import "cssesc"` into the server
  bundle. Verified: the built server boots under Node 22 and serves the SSR
  home (editor-gated), `/cmsbar/login`, and `/api/cms/*`.

## [0.2.0] — 2026-06-16

Framework reach: two native non-React editing UIs, and the CLI now scaffolds
every supported host.

### Added

- **Native SvelteKit UI (Svelte 5)** — `examples/sveltekit`. The whole editing
  layer (the bar, `T` / `RichText` + toolbar, `EditableImage` / `EditableMedia`
  / focal-point, `EditableInfoList`, and the Versions / Page-meta / Settings /
  Issues drawers + the opt-in guided tour) rebuilt natively over the **unchanged
  neutral core + handlers**. SSR; feature parity with the React UI;
  browser-verified.
- **Native Nuxt UI (Vue 3)** — `examples/nuxt`. The Vue counterpart on the same
  protocol, with the whole API mounted through one Nitro catch-all route.
- **`cmsbar new` / `cmsbar init` cover all seven hosts** — added `sveltekit`
  and `nuxt`. Non-React hosts copy their committed SFC UI and assemble only the
  neutral `lib/cmsbar` core (the React component layer and the React-only theme
  are skipped).
- **`docs/PROTOCOL.md`** — the framework-neutral contract non-React UIs build
  against (the dispatcher, the session/handler seam, the content model).

### Changed

- Neutral helpers `shared-paths` and `pageNameForPath` moved into `lib/cmsbar`
  so every UI consumes them unchanged.
- Configurable `mediaRoot` in `cms.config` (default `"public"`; SvelteKit uses
  `"static"`) — the media rules, filesystem listing, and image proxy resolve
  correctly per host.
- The handler-level test harness is now **156 tests**.
- The marketing site marks SvelteKit/Nuxt as shipped and the CLI as covering all
  seven hosts.

### Fixed

- Non-React scaffolds no longer pull in the React-only `cn()` helper
  (`lib/cmsbar/utils.ts` — `clsx` + `tailwind-merge`), which cleared a phantom
  `svelte-check` error and dropped two dependencies those projects never used.

### Packaging

- The published `cmsbar` package now **bundles `template/` + `examples/`** (a
  `prepack` step copies the git-tracked source in; `ROOT` resolves them from the
  install location), so `cmsbar new` / `cmsbar init` work when installed from
  npm. 0.1.0 shipped only `bin/` + `package.json`, so the published CLI could not
  scaffold — **0.2.0 is the first installable release.** Verified by scaffolding
  + building a project from the packed tarball outside the monorepo.

## [0.1.0]

Initial release.

### Added

- Git-as-CMS editing bar: editors change the live site in place; each save is
  one commit on a `cms/*` branch and a GitHub pull request. Merge redeploys.
- Editable primitives — `T`, `RichText` (+ floating toolbar), `EditableImage`,
  `EditableMedia`, `EditableInfoList` — plus focal-point repositioning and a
  repo-backed media browser.
- The CMS bar: multiple drafts, live preview of any branch, fork, the approval
  label, the Versions / Page-meta / Settings / Issues drawers, and an opt-in
  guided tour.
- Framework-neutral core (~64% of the code) + a thin per-host seam; the whole
  API is a single dispatcher (`handleCmsRequest` / `createCmsApi`) mounted as
  one catch-all route, backed by a handler-level test harness.
- Five React hosts, each a runnable app under `examples/`: Next.js (App
  Router), React Router 7, TanStack Start, a Vite + React SPA (+ a Hono
  companion server), and Astro (editor-gated island hydration).
- `cmsbar new` / `cmsbar init` CLI (shadcn-style copy-in — you own the code).
- Publishing modes: `review` (default — a PR per draft) and `direct` (commit
  straight to the base branch).
- GitHub storage backend; bcrypt + HMAC-signed-cookie auth, rate-limited login.

[0.2.1]: https://github.com/cmsbar/cmsbar/releases/tag/v0.2.1
[0.2.0]: https://github.com/cmsbar/cmsbar/releases/tag/v0.2.0
[0.1.0]: https://github.com/cmsbar/cmsbar/releases/tag/v0.1.0
