// Assemble the framework-neutral CMSBar core into this example's src/ tree.
//
// The core is the single canonical source at ../../template. We copy it in (we
// never fork it) so this example always tracks the real core. Two files in the
// neutral lib/cmsbar tree are not needed by a non-React host and must NOT be
// copied:
//   - lib/cmsbar/page-meta-next.ts  (imports "next")
//   - lib/cmsbar/utils.ts  (the React-only cn() Tailwind merger: clsx +
//     tailwind-merge, imported solely by components/cmsbar)
//
// The native Svelte 5 editing UI ships as committed glue (src/cmsbar/*.svelte +
// the content.svelte.ts store + src/styles/cmsbar.css), NOT assembled here. So
// unlike the React hosts we copy ONLY the neutral TypeScript - lib/cmsbar/*
// (handlers, server/router.ts, server/companion.ts, server/http.ts, session.ts,
// paths.ts, media.ts, config.ts, backend/*, the content model, etc.) plus
// lib/content.ts. We do NOT copy components/cmsbar (those are React).
//
// We also do NOT copy the template's app/ tree (app/api/cms, app/cmsbar): those
// are Next route handlers / pages. SvelteKit mounts the whole API through one
// catch-all endpoint (src/routes/api/cms/[...path]/+server.ts -> createCmsApi())
// and reads content for SSR via getContent() in +page.server.ts.
//
// cms.config.ts and content/site-content.json are committed in this example
// (src/cms.config.ts, src/content/site-content.json) and are never overwritten.
//
// Adapted from examples/vite-spa/scripts/setup.mjs; same destination root
// (src/) and "@/..." -> src/ resolution.

import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const template = resolve(root, "..", "..", "template");
const src = join(root, "src");

if (!existsSync(template)) {
  console.error(`[cmsbar setup] template not found at ${template}`);
  process.exit(1);
}

// Files inside the otherwise-neutral core not needed by a non-React host
// (page-meta-next.ts imports "next"; utils.ts is the React-only cn() helper).
const SKIP = new Set(["page-meta-next.ts", "utils.ts"]);

// Copy a directory tree, skipping SKIP entries by basename. Replaces the
// destination dir so removed core files don't linger between runs.
async function copyTree(srcDir, destDir, label) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, {
    recursive: true,
    filter: (s) => {
      const base = s.split("/").pop();
      return !SKIP.has(base);
    },
  });
  const count = (await readdir(destDir, { recursive: true })).length;
  console.log(`[cmsbar setup] ${label}: ${count} entries`);
}

async function main() {
  // 1. lib/cmsbar/* (skip page-meta-next.ts) -> src/lib/cmsbar/
  await copyTree(
    join(template, "lib", "cmsbar"),
    join(src, "lib", "cmsbar"),
    "lib/cmsbar",
  );

  // 2. lib/content.ts -> src/lib/content.ts
  await mkdir(join(src, "lib"), { recursive: true });
  await cp(join(template, "lib", "content.ts"), join(src, "lib", "content.ts"));
  console.log("[cmsbar setup] lib/content.ts");

  console.log("[cmsbar setup] done. Run `npm install` then `npm run build`.");
}

main().catch((err) => {
  console.error("[cmsbar setup] failed:", err);
  process.exit(1);
});
