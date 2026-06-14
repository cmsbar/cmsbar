import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Plugin order matters: tsconfig-paths first so "@/..." resolves, then the
// TanStack Start plugin, then React's plugin (must come after Start's), then
// Tailwind v4's Vite plugin.
export default defineConfig({
  server: {
    port: 3230,
  },
  plugins: [tsConfigPaths(), tanstackStart(), viteReact(), tailwindcss()],
});
