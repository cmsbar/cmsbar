// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// SSR ("server" output) is required so that:
//   - the editor-gating page can read the session cookie off Astro.request and
//     decide per-request whether to ship the React island (client:load) or
//     server-render it to static HTML with no CMS JS, and
//   - the /api/cms/[...path] endpoint can run the CMSBar API.
// The standalone Node adapter gives us a built server we can `node` and curl.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  vite: {
    plugins: [tsconfigPaths(), tailwindcss()],
  },
});
