// Production server entry (Node.js).
//
// A plain Vite build of TanStack Start emits client assets in `dist/client` and
// a fetch-style server entry at `dist/server/server.js` (its default export is
// `{ fetch(request) }`). To serve it on Node we need to: (1) serve the built
// client assets statically, and (2) forward everything else to that fetch
// handler. We use srvx (already a dep) programmatically - the `serveStatic`
// middleware runs first for `dist/client`, then falls through to the Start
// fetch handler for SSR + the /api/cms server route. This avoids hard-coding a
// hosting preset (Nitro/Cloudflare/etc.) while staying a single `node` command.
//
// Mirrors the TanStack Start docs' "Node.js / Docker" guidance for Vite builds.

import { serve } from "srvx";
import { serveStatic } from "srvx/static";
import entry from "./dist/server/server.js";

const port = Number(process.env.PORT) || 3230;

serve({
  port,
  middleware: [serveStatic({ dir: "dist/client" })],
  fetch: (request) => entry.fetch(request),
});

console.log(`[cmsbar] TanStack Start production server on http://localhost:${port}/`);
