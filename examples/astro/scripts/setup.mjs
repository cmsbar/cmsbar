// Assemble the framework-neutral CMSBar core into this example's src/ tree.
//
// The core is the single canonical source at ../../template. We copy it in (we
// never fork it) so this example always tracks the real core. Two files in the
// "neutral" tree are Next-coupled and must NOT be copied:
//   - components/cmsbar/NextCmsHost.tsx  (imports next/navigation, next/image)
//   - lib/cmsbar/page-meta-next.ts       (imports "next")
//
// Astro mounts React via islands. The neutral host.tsx (HostProvider with DOM
// defaults - window.location + popstate + a plain <img>) is exactly what the
// editor-gated island needs, so there is no framework host adapter file like the
// React Router / TanStack examples have. The host-specific wiring that *is*
// committed lives under src/cmsbar/ (CmsApp island + getServerSession), the
// Astro pages (src/pages/*), and src/cms.config.ts / src/content/.
//
// We also do NOT copy the template's app/ tree (app/api/cms, app/cmsbar): those
// are Next route handlers / pages. Astro mounts the whole API through one
// catch-all endpoint (src/pages/api/cms/[...path].ts -> createCmsApi()).
//
// cms.config.ts and content/site-content.json are committed in this example
// (src/cms.config.ts, src/content/site-content.json) and are never overwritten.
//
// Mirrors examples/tanstack-start/scripts/setup.mjs; same destination root
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

// Files inside the otherwise-neutral core that are framework-coupled.
const SKIP = new Set(["NextCmsHost.tsx", "page-meta-next.ts"]);

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
  // 1. components/cmsbar/* (skip NextCmsHost.tsx) -> src/components/cmsbar/
  await copyTree(
    join(template, "components", "cmsbar"),
    join(src, "components", "cmsbar"),
    "components/cmsbar",
  );

  // 2. lib/cmsbar/* (skip page-meta-next.ts) -> src/lib/cmsbar/
  await copyTree(
    join(template, "lib", "cmsbar"),
    join(src, "lib", "cmsbar"),
    "lib/cmsbar",
  );

  // 3. lib/content.ts -> src/lib/content.ts
  await mkdir(join(src, "lib"), { recursive: true });
  await cp(join(template, "lib", "content.ts"), join(src, "lib", "content.ts"));
  console.log("[cmsbar setup] lib/content.ts");

  // 4. styles/cmsbar.css -> src/styles/cmsbar.css
  await mkdir(join(src, "styles"), { recursive: true });
  await cp(
    join(template, "styles", "cmsbar.css"),
    join(src, "styles", "cmsbar.css"),
  );
  console.log("[cmsbar setup] styles/cmsbar.css");

  console.log("[cmsbar setup] done. Run `npm install` then `npm run dev`.");
}

main().catch((err) => {
  console.error("[cmsbar setup] failed:", err);
  process.exit(1);
});
