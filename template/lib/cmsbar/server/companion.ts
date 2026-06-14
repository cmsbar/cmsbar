// @cms/server entry: a fetch-style dispatcher over the neutral CMS handlers,
// for standalone backends - a Vite SPA's companion server, an Astro endpoint,
// or any Node/Bun web server. Anywhere you hold a web Request, call the result:
//
//   const cms = createCmsApi();
//   // Hono:    app.all("/api/cms/*", (c) => cms(c.req.raw));
//   // Bun:     Bun.serve({ fetch: (req) => req.url.includes("/api/cms") ? cms(req) : ... });
//   // Astro:   export const ALL = ({ request }) => cms(request);
//
// For Node servers without a web Request (Express/connect), wrap the node req
// into a web Request first (e.g. via @hono/node-server or srvx) and pass it in.

import { handleCmsRequest } from "./router";

export interface CreateCmsApiOptions {
  /** Path prefix the API is mounted under (default "/api/cms"). */
  basePath?: string;
}

/**
 * Build the CMS API as a single `(req: Request) => Promise<Response>` function.
 * Thin wrapper over the neutral dispatcher, fixing the base path so a host only
 * has to route everything under it to one handler.
 */
export function createCmsApi(
  options: CreateCmsApiOptions = {},
): (req: Request) => Promise<Response> {
  const basePath = options.basePath ?? "/api/cms";
  return (req) => handleCmsRequest(req, { basePath });
}
