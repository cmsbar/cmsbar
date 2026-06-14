import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This example lives inside the CMSBar monorepo, which has its own lockfile.
  // Pin the workspace root so Turbopack doesn't infer the parent directory.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
