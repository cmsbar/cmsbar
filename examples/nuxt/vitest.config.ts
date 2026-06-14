// Vitest config for the CMSBar Vue editing-store unit tests.
//
// The store is plain Composition-API logic (reactive/ref/computed/watch), so we
// don't need @vue/test-utils or a component mount - just the `@` -> project-root
// alias (so the store's "@/lib/..." / "@/cms.config" imports resolve) and a
// jsdom environment giving us window + localStorage for the persistence helpers.
// The browser-only effects (poll/restore/persist) only install when a host calls
// store.start(); the action tests never call it, so no watch() scheduling runs.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror nuxt.config.ts's "@"/"~" -> rootDir alias so the store's
    // "@/lib/..." / "@/cms.config" imports resolve in the test runner too.
    alias: {
      "@": rootDir,
      "~": rootDir,
      "@/": `${resolve(rootDir)}/`,
      "~/": `${resolve(rootDir)}/`,
    },
  },
  test: {
    environment: "jsdom",
    include: ["cmsbar/**/*.{test,spec}.ts"],
  },
});
