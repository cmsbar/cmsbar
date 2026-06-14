// SvelteKit config for the CMSBar example.
//
// adapter-node so `npm run build` produces a standalone Node server we can run
// with `node build/index.js` (and smoke-test headlessly). The "@" alias maps to
// ./src so the framework-neutral CMSBar core - copied into src/lib/cmsbar by
// `npm run setup` - resolves its internal "@/cms.config", "@/lib/content", and
// "@/lib/cmsbar/*" imports unchanged, exactly as it does on every other host.

import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      "@": "./src",
    },
  },
};

export default config;
