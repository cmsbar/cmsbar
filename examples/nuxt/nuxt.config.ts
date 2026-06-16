// Nuxt 3 host for CMSBar - full native Vue 3 editing UI over the neutral core.
//
// The framework-neutral CMSBar core is copied in by `npm run setup` (from
// ../../template) into lib/cmsbar/* and lib/content.ts at the project root, and
// is git-ignored - this example never forks the core. The committed glue is the
// Nitro catch-all (server/routes/api/cms/[...path].ts -> createCmsApi), the
// native Vue 3 editing UI (cmsbar/*.vue + app.vue + the server session plugin),
// the SSR page (pages/index.vue reading getContent()), cms.config.ts and
// content/site-content.json.
//
// The neutral lib imports itself as "@/lib/cmsbar/..." and the project config as
// "@/cms.config". Nuxt's "@" and "~" both alias the project root (srcDir), so
// "@/lib/cmsbar/server/companion" resolves to ./lib/cmsbar/server/companion and
// "@/cms.config" to ./cms.config.ts. We pin them explicitly to be safe.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  // Server-render the public site so getContent() is baked into the HTML.
  ssr: true,
  compatibilityDate: "2025-01-01",

  // Global CMSBar theme + bar/login chrome (plain CSS, no Tailwind). Ported
  // from examples/sveltekit/src/styles/cmsbar.css.
  css: ["@/assets/styles/cmsbar.css"],

  // Pin "@" / "~" to the project root so the copied core resolves both its
  // self-imports (@/lib/cmsbar/*) and the project config (@/cms.config).
  alias: {
    "@": rootDir,
    "~": rootDir,
  },

  nitro: {
    // node-server preset makes `nuxt build` emit a runnable Node bundle at
    // .output/server/index.mjs (started by `npm start`).
    preset: "node-server",
  },

  typescript: {
    // Don't fail `nuxt build` on type errors inside the copied (git-ignored)
    // core; the host glue is type-checked separately via `npm run typecheck`
    // (vue-tsc --noEmit).
    typeCheck: false,
  },
});
