// Framework-neutral HTTP seam for CMSBar's API surface.
//
// Every route body lives as a `CmsHandler: (req, ctx) => Response`, using the
// web-standard Request/Response types. `ctx` carries cookie reads. A Next route,
// a React Router resource route, a TanStack server route, or a Hono/Express
// mount all build a `ctx` and return the handler's Response - and tests call
// handlers directly with a constructed Request, no framework server needed.

import { SESSION_COOKIE } from "@/lib/cmsbar/session";

// STABLE CONTRACT (frozen 2026-06-14, validated by @cms/next + the React Router
// host). The server-side half of the host seam; changing it is breaking.
export interface CmsRequestContext {
  /** Read a request cookie by name (returns the decoded value, or undefined). */
  cookies: { get(name: string): string | undefined };
}

export type CmsHandler = (
  req: Request,
  ctx: CmsRequestContext,
) => Promise<Response> | Response;

/** Parse a `Cookie` request header into a name → value map. */
function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build a {@link CmsRequestContext} from a web Request by reading its `Cookie`
 * header. The raw header is present in every target framework's route layer, so
 * this is the universal default; hosts with an ambient cookie API may construct
 * their own ctx instead.
 */
export function cookieCtxFromRequest(req: Request): CmsRequestContext {
  const jar = parseCookieHeader(req.headers.get("cookie"));
  return { cookies: { get: (name) => jar[name] } };
}

const SESSION_MAX_AGE = 60 * 60 * 12; // 12h, mirrors SESSION_TTL_MS in session.ts

interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions,
): string {
  const segs = [`${name}=${value}`];
  if (opts.maxAge !== undefined) {
    segs.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  }
  if (opts.path) segs.push(`Path=${opts.path}`);
  if (opts.httpOnly) segs.push("HttpOnly");
  if (opts.secure) segs.push("Secure");
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
  return segs.join("; ");
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * `Set-Cookie` value that installs the signed session for the rolling 12h
 * window. Attributes match the previous per-route Next cookie writes exactly:
 * HttpOnly, Secure in production, SameSite=Lax, Path=/, Max-Age 12h.
 */
export function sessionCookie(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** `Set-Cookie` value that clears the session (Max-Age=0). */
export function clearedSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Append a `Set-Cookie` header to a Response and return the same Response. */
export function appendCookie(res: Response, cookie: string): Response {
  res.headers.append("set-cookie", cookie);
  return res;
}

/** JSON Response helper (drop-in for the previous `NextResponse.json`). */
export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}
