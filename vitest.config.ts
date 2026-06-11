import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/cms.config": path.resolve(__dirname, "template/cms.config.ts"),
      "@/lib": path.resolve(__dirname, "template/lib"),
      "@/components": path.resolve(__dirname, "template/components"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
