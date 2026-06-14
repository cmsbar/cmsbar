// Vitest config for the CMSBar editing-store unit tests.
//
// We use the plain `svelte()` plugin (not the full `sveltekit()` plugin) so
// vitest compiles `.svelte.ts` rune modules without pulling in SvelteKit's
// virtual modules ($app/*, $types). `resolve.conditions: ["browser"]` makes
// Vite load Svelte's client runtime, so $state/$effect/$effect.root actually
// run (the server runtime is a no-op). jsdom gives us window + localStorage.

import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    // Mirror svelte.config.js's "@" -> ./src alias so the store's
    // "@/lib/..." / "@/cms.config" imports resolve in the test runner too.
    alias: { "@": path.resolve(__dirname, "src") },
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
});
