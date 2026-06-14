// Framework-neutral request dispatcher: routes a web Request to the matching
// CMS handler. Mount it on any server - a React Router resource route, a
// TanStack server route, a Hono/Express handler, or an Astro endpoint all do
// `handleCmsRequest(request)`. Tests call it directly too.

import {
  cookieCtxFromRequest,
  type CmsHandler,
  type CmsRequestContext,
} from "./http";
import { commit } from "./handlers/commit";
import { imagesList } from "./handlers/imagesList";
import { imagesRaw } from "./handlers/imagesRaw";
import { patchIssue } from "./handlers/issueByNumber";
import { createIssueHandler, listIssuesHandler } from "./handlers/issues";
import { login } from "./handlers/login";
import { logout } from "./handlers/logout";
import { mediaList } from "./handlers/mediaList";
import { preview } from "./handlers/preview";
import { resolveMap } from "./handlers/resolveMap";
import { checkSession } from "./handlers/sessionCheck";
import { sessionClear } from "./handlers/sessionClear";
import { sessionFork } from "./handlers/sessionFork";
import { sessionInfo } from "./handlers/sessionInfo";
import { sessionStart } from "./handlers/sessionStart";
import { sessionSwitch } from "./handlers/sessionSwitch";
import { versions } from "./handlers/versions";

export interface CmsRoute {
  method: string;
  /** Path under the API base, e.g. "/session/check" or "/issues/:number". */
  path: string;
  handler: CmsHandler;
}

// The single source of truth mapping (method, path) → neutral handler. The Next
// route wrappers mirror this; non-Next hosts dispatch through it.
export const CMS_ROUTES: CmsRoute[] = [
  { method: "POST", path: "/commit", handler: commit },
  { method: "GET", path: "/images/list", handler: imagesList },
  { method: "GET", path: "/images/raw", handler: imagesRaw },
  { method: "GET", path: "/issues", handler: listIssuesHandler },
  { method: "POST", path: "/issues", handler: createIssueHandler },
  { method: "PATCH", path: "/issues/:number", handler: patchIssue },
  { method: "POST", path: "/login", handler: login },
  { method: "POST", path: "/logout", handler: logout },
  { method: "GET", path: "/media/list", handler: mediaList },
  { method: "GET", path: "/preview", handler: preview },
  { method: "POST", path: "/resolve-map", handler: resolveMap },
  { method: "GET", path: "/session", handler: sessionInfo },
  { method: "GET", path: "/session/check", handler: checkSession },
  { method: "POST", path: "/session/clear", handler: sessionClear },
  { method: "POST", path: "/session/fork", handler: sessionFork },
  { method: "POST", path: "/session/start", handler: sessionStart },
  { method: "POST", path: "/session/switch", handler: sessionSwitch },
  { method: "GET", path: "/versions", handler: versions },
];

const DEFAULT_BASE = "/api/cms";

function pathMatches(pattern: string, actual: string): boolean {
  if (pattern === actual) return true;
  const pp = pattern.split("/");
  const ap = actual.split("/");
  if (pp.length !== ap.length) return false;
  return pp.every((seg, i) => seg.startsWith(":") || seg === ap[i]);
}

export interface CmsDispatchOptions {
  /** API base prefix to strip from the pathname (default "/api/cms"). */
  basePath?: string;
  /** Override how cookies are read (default: parse the request Cookie header). */
  ctx?: CmsRequestContext;
}

/**
 * Route a web Request to the matching CMS handler.
 * - 404 if no route path matches
 * - 405 if the path exists but not for this method
 */
export async function handleCmsRequest(
  req: Request,
  options: CmsDispatchOptions = {},
): Promise<Response> {
  const base = (options.basePath ?? DEFAULT_BASE).replace(/\/+$/, "");
  const url = new URL(req.url);
  let path = url.pathname;
  // Only strip the base when the path equals it or is genuinely nested under
  // base + "/" - a bare startsWith would mis-strip sibling prefixes like
  // /api/cms-internal or /api/cmsx.
  if (base && (path === base || path.startsWith(base + "/"))) {
    path = path.slice(base.length);
  }
  if (!path.startsWith("/")) path = "/" + path;
  path = path.replace(/\/+$/, "") || "/";

  const byMethod = CMS_ROUTES.filter((r) => r.method === req.method);
  // Exact-path match first, then parameterized patterns - so /issues beats
  // /issues/:number for the bare path.
  const route =
    byMethod.find((r) => r.path === path) ??
    byMethod.find((r) => pathMatches(r.path, path));
  if (route) {
    const ctx = options.ctx ?? cookieCtxFromRequest(req);
    return route.handler(req, ctx);
  }

  // Distinguish "no such path" (404) from "wrong method" (405).
  const pathExists = CMS_ROUTES.some(
    (r) => r.path === path || pathMatches(r.path, path),
  );
  return Response.json(
    { error: pathExists ? "Method not allowed" : "Not found" },
    { status: pathExists ? 405 : 404 },
  );
}
