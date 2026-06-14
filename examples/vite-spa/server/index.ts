// Production / companion server (Node.js, Hono).
//
// One long-lived process on ONE port that does two jobs:
//
//   (a) Mounts the ENTIRE CMSBar API. createCmsApi() returns a single
//       (req: Request) => Promise<Response> covering every /api/cms/* route
//       (session, login, logout, commit, issues, images, media, preview, …).
//       Hono hands it the raw web Request: app.all("/api/cms/*", c => cms(c.req.raw)).
//
//   (b) In production, serves the built SPA from dist/ (static assets) with an
//       index.html SPA-fallback for any non-API, non-asset path - so a deep
//       link like /anything returns the shell and the client router takes over.
//
// Same-origin by design: API + SPA share this origin, so the signed session
// cookie set by /api/cms/login is sent back on every fetch. In dev, Vite serves
// the SPA on :3240 and proxies /api/cms here (:3241) to preserve that.
//
// Run with tsx so the "@/..." TS path alias resolves at runtime (see the
// register import below) - the same alias Vite uses for the client build.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { createCmsApi } from "@/lib/cmsbar/server/companion";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = join(root, "dist");
const port = Number(process.env.PORT) || 3241;

const app = new Hono();

// (a) The whole CMS API, one line. `app.all` covers GET/POST/PATCH/etc; the
// neutral dispatcher inside createCmsApi() strips "/api/cms" and 404s unknown
// paths itself, so a /api/cms/nope correctly returns 404 from here.
const cms = createCmsApi();
app.all("/api/cms/*", (c) => cms(c.req.raw));

// (b) Production static serving. Only meaningful once `vite build` has produced
// dist/; in dev you run `npm run dev` (Vite) instead and never hit this server
// for HTML. Guard so a missing dist/ gives a clear message rather than 500s.
if (existsSync(distDir)) {
  // Serve hashed assets and public files straight from dist/.
  app.use("/*", serveStatic({ root: "./dist" }));

  // SPA fallback: any non-API path that didn't match a file returns index.html
  // so the client renders. (API 404s already returned above.)
  const indexHtml = await readFile(join(distDir, "index.html"), "utf8");
  app.get("/*", (c) => c.html(indexHtml));
} else {
  app.get("/*", (c) =>
    c.text(
      "SPA not built. Run `npm run build` first, or use `npm run dev` for the Vite dev server.",
      503,
    ),
  );
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[cmsbar] Vite SPA companion on http://localhost:${info.port}/ (API: /api/cms/*)`,
  );
});
