# cmsbar

**Git-as-CMS you drop into your own codebase.** Editors log in on the live
site, click any text or image, change it in place, and hit Save — the change
becomes a branch and a GitHub Pull Request. Review runs through your normal Git
workflow; merging deploys it. No database, no dashboard to host, no vendor
lock-in, and you own every line of the code.

This package is the **installer CLI**. shadcn-style, it copies the source into
your project and gets out of the way — there is no runtime dependency on
`cmsbar` afterward.

```bash
# scaffold a fresh site on any supported host
npx cmsbar new my-site --framework next

# …or add CMSBar to an existing project
npx cmsbar init
```

## Two commands

```bash
cmsbar new <dir> --framework <fw> [--namespace <id>]
    Scaffold a fresh CMSBar site: a per-host starter + the assembled core.

cmsbar init [--framework <fw>] [--namespace <id>] [--dir <project>]
    Add CMSBar to an existing project (defaults to Next.js).
```

After either, you own the code: edit it, theme it, delete it — nothing phones
home.

## Supported frameworks

`--framework` accepts: `next` · `react-router` · `tanstack-start` · `vite` ·
`astro` · `sveltekit` · `nuxt`

| Host | UI | Notes |
| --- | --- | --- |
| **Next.js** (App Router) | React | Reference host — route handlers, login page, RSC layout wiring |
| **React Router 7** (framework mode) | React | One resource route → `handleCmsRequest`; root-loader session |
| **TanStack Start** | React | One server route → `handleCmsRequest`; needs Node ≥ 20.19 / 22.12 |
| **Vite + React SPA** | React | DOM-default client + a small Hono companion server |
| **Astro** | React islands | Editor-gated hydration — public visitors get static, zero-JS HTML |
| **SvelteKit** | native Svelte 5 | Same protocol, UI rebuilt natively; plain CSS (no Tailwind) |
| **Nuxt** | native Vue 3 | Same protocol, UI rebuilt natively; plain CSS (no Tailwind) |

The five React hosts share a framework-neutral core (~64% of the code) plus a
thin per-host seam; SvelteKit and Nuxt reuse that same core + server handlers
with the component layer rewritten natively, at feature parity. See
[docs/PROTOCOL.md](https://github.com/cmsbar/cmsbar/blob/main/docs/PROTOCOL.md).

## How it works

One draft = **one branch = one PR = one version**. Editors see *New draft*,
*Save*, *Preview*, *Versions* — never Git. Under the hood:

| The editor sees | Under the hood |
| --- | --- |
| “New draft” | branch `cms/<slug>` + PR `[CMS draft] <title>` |
| “Save” | one commit, all changes batched (GitHub Git Data API) |
| “Preview” | the page rendered from that branch's content JSON |
| “Approved · locked” | a reviewer added the approval label |
| Merge | redeploy with the new content baked into the build |

Content lives in `content/site-content.json`; its full history is `git log`.
Two publishing modes: `review` (default — a PR per draft) and `direct` (commit
straight to the base branch).

## What gets installed

`cmsbar init` copies the editor + neutral core into your project:

- `components/cmsbar/*` (React hosts) **or** the native `cmsbar/*` SFC UI
  (SvelteKit / Nuxt)
- `lib/cmsbar/*` — the dispatcher, session, GitHub backend, media + path rules
- `cms.config.ts`, the theme CSS, and (for Next) the API route handlers + login
  page

It then prints the wiring steps (mount one catch-all API route, wrap your root
with the provider + `<CmsBar/>`) and appends the env keys to `.env.example`.

## Requirements

- One of the supported hosts above. React hosts use **Tailwind v4** for the
  editor chrome; the SvelteKit / Nuxt UIs ship **plain CSS** (no Tailwind).
- A GitHub repo + a fine-grained PAT (Contents + Pull requests, read/write).
- Node ≥ 18.

## Links

- **Repo:** https://github.com/cmsbar/cmsbar
- **Docs:** https://github.com/cmsbar/cmsbar/blob/main/docs/FRAMEWORKS.md ·
  [PROTOCOL.md](https://github.com/cmsbar/cmsbar/blob/main/docs/PROTOCOL.md)
- **Changelog:** https://github.com/cmsbar/cmsbar/blob/main/CHANGELOG.md
- **Examples:** https://github.com/cmsbar/cmsbar/tree/main/examples (a runnable
  app per host)

## License

MIT © Mario Ivančić
