// Assemble the framework-neutral CMSBar core into this Nuxt example's tree.
//
// The core is the single canonical source at ../../template. We copy it in (we
// never fork it) so this example always tracks the real core. One file in the
// neutral lib/cmsbar tree is Next-coupled and must NOT be copied:
//   - lib/cmsbar/page-meta-next.ts  (imports "next")
//
// The native Vue 3 editing UI ships as committed host glue (cmsbar/*.vue +
// app.vue + plugins/cmsbar-session.server.ts + assets/styles/cmsbar.css), NOT
// assembled here. So, like SvelteKit, setup copies ONLY the neutral TypeScript -
// lib/cmsbar/* (handlers, server/router.ts, server/companion.ts, server/http.ts,
// session.ts, paths.ts, media.ts, config.ts, backend/*, page-meta-core.ts, the
// content model, etc.) plus lib/content.ts. We do NOT copy components/cmsbar
// (those are React).
//
// We also do NOT copy the template's app/ tree (Next route handlers / pages):
// Nuxt mounts the whole API through one Nitro catch-all
// (server/routes/api/cms/[...path].ts -> createCmsApi()) and reads content for
// SSR via getContent() in pages/index.vue.
//
// cms.config.ts and content/site-content.json are committed at the project root
// (cms.config.ts imports ./lib/cmsbar/config; lib/content.ts imports
// ../content/site-content.json, so content/ sits beside lib/). Neither is
// overwritten by setup.
//
// Adapted from examples/sveltekit/scripts/setup.mjs; destination root is the
// project root here (lib/...), and "@/..." -> rootDir resolution.

import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const template = resolve(root, "..", "..", "template");

if (!existsSync(template)) {
  console.error(`[cmsbar setup] template not found at ${template}`);
  process.exit(1);
}

// Files inside the otherwise-neutral core that are framework-coupled.
const SKIP = new Set(["page-meta-next.ts"]);

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
  // 1. lib/cmsbar/* (skip page-meta-next.ts) -> lib/cmsbar/
  await copyTree(
    join(template, "lib", "cmsbar"),
    join(root, "lib", "cmsbar"),
    "lib/cmsbar",
  );

  // 2. lib/content.ts -> lib/content.ts
  await mkdir(join(root, "lib"), { recursive: true });
  await cp(join(template, "lib", "content.ts"), join(root, "lib", "content.ts"));
  console.log("[cmsbar setup] lib/content.ts");

  console.log("[cmsbar setup] done. Run `npm install` then `npm run build`.");
}

main().catch((err) => {
  console.error("[cmsbar setup] failed:", err);
  process.exit(1);
});
