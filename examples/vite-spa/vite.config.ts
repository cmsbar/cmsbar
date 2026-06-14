import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

// A plain Vite client build (no SSR): `vite build` emits the SPA into dist/,
// index.html as the shell + the hashed JS/CSS bundles. The companion server
// (server/index.ts) serves those statics and mounts the CMS API on the same
// origin in production.
//
// In dev, server.proxy forwards /api/cms to the long-lived companion so the
// session cookie is set on the SAME origin Vite serves the SPA from - without
// the proxy the cookie would be cross-origin and silently dropped.
export default defineConfig({
  plugins: [tsconfigPaths(), react(), tailwindcss()],
  server: {
    port: 3240,
    proxy: {
      "/api/cms": {
        target: "http://localhost:3241",
        changeOrigin: true,
      },
    },
  },
});
