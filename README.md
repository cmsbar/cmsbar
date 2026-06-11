# CMSBar

**Git-as-CMS you drop into your own codebase.** Editors log in on the live
site, click any text or image, change it in place, and hit Save — the change
becomes a branch and a GitHub Pull Request. Review runs through your normal
Git workflow; merging deploys it. No database, no dashboard to host, no
vendor lock-in, and you own every line of the code.

```
npx cmsbar init
```

## Why

- **Your repo is the CMS.** Content is a JSON file in the repo. Drafts are
  branches. Versions are open PRs. Approval is a label. History is `git log`.
- **Copy-in, shadcn-style.** The CLI copies the source into your project.
  Nothing phones home, nothing to subscribe to, nothing that can break under
  you when a vendor pivots.
- **Stateless by design.** The production container never writes to disk —
  all commits go through the GitHub Git Data API with a fine-scoped PAT.
  Restarts lose nothing; editors' unsaved work survives reloads in
  localStorage + IndexedDB.
- **Editors never see Git.** They see *drafts*, *Save*, *Preview*, and
  *Versions*. One draft = one branch = one PR = one version-in-progress.

## The editor's mental model

| Editor sees | Under the hood |
| --- | --- |
| New draft | branch `cms/<slug>` + PR `[CMS draft] <title>` |
| Save | one commit on the draft branch (all changes batched) |
| Versions | open PRs whose branch starts with `cms/` |
| Preview | renders the site with that branch's content JSON |
| Approved (locked) | reviewer added the `cmsbar approved` label |
| Fork | new branch off any version |

## What's in the box

- **Primitives** — `T` (inline text + rich-text toolbar), `RichText`,
  `EditableImage` (upload, library, reposition), `EditableMedia`
  (video/map/image), `EditableInfoList`. Wrap content with a dotted path:
  `<T path="home.hero.headline" />`.
- **The bar** — fixed editor chrome: draft state, Save, Discard, Versions,
  Preview, per-page SEO drawer, site settings (launch gate), GitHub issue
  reporting, shared-element highlighting.
- **Server routes** under `app/api/cms/*` — session (HMAC cookie + bcrypt +
  rate-limited login), commit (Git Data API, one commit per Save), preview,
  versions, media proxy, uploads, issues.
- **Config** — one typed `cms.config.ts` owns everything project-specific:
  namespace, content file, media folders, branch prefix, shared prefixes,
  pages, approval label, rich-text decor class.
- **Theme** — all editor chrome colors are CSS variables (`--cmsbar-*`) in
  `styles/cmsbar.css`. Re-brand without touching components.
- **Launch gate (optional)** — serve a teaser to the public until the site is
  flipped live from the bar (`middleware.example.ts`).

## Install

```bash
# in your Next.js (App Router) project
npx cmsbar init --namespace mysite
npm i bcryptjs clsx tailwind-merge lucide-react
```

Then wire the layout (once):

```tsx
// app/layout.tsx
import { cookies } from "next/headers";
import { getContent } from "@/lib/content";
import { SESSION_COOKIE } from "@/lib/cmsbar/keys";
import { verifySession } from "@/lib/cmsbar/session";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { CmsBar } from "@/components/cmsbar/CmsBar";

export default async function RootLayout({ children }) {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <html>
      <body>
        <ContentProvider
          content={getContent()}
          initialCms={{
            authenticated: !!session,
            user: session?.user,
            draft: session?.draft,
          }}
        >
          {children}
          <CmsBar />
        </ContentProvider>
      </body>
    </html>
  );
}
```

Import the theme once in `app/globals.css`:

```css
@import "../../styles/cmsbar.css";
```

Fill in the env vars (`cmsbar init` appends the block to `.env.example`:
credentials, session secret, GitHub PAT). Full walkthrough, including the
PAT scopes and the bcrypt `$`-escaping gotcha: **docs/SETUP.md**.

## Make something editable

```tsx
<T path="home.hero.headline" as="h1" className="text-5xl font-bold" />
<RichText path="home.hero.subtitle" as="p" />
<EditableImage path="home.hero.image" positionPath="home.hero.imagePosition" fill alt="" />
```

Add the matching keys to `content/site-content.json`. The `SiteContent` type
is inferred from the JSON, so the schema follows the file.

## Repo layout

```
template/    the canonical source `cmsbar init` copies into your project
packages/cli the installer
tests/       vitest suite for the core (paths, session, media allowlists)
docs/        SETUP.md (full guide) · PLAN.md (productization roadmap)
```

## Development

```bash
npm install
npm run check   # typecheck + tests
```

## Status & roadmap

Extracted from a production deployment (kidsenglishacademy.hr) where it runs
daily. Decoupling status: config layer ✔ · theming ✔ · namespace isolation ✔ ·
storage seam interface defined (`lib/cmsbar/backend/types.ts`), GitHub is the
reference adapter; a `fileAdapter` for offline dev, additional framework
hosts, and the hosted control plane are tracked in **docs/PLAN.md**.

## License

MIT
