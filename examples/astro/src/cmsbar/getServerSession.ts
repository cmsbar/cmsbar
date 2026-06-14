// Server half of the CMSBar host wiring for Astro.
//
// Astro pages run on the server for every request (output: "server"), and
// Astro.request is a web Request carrying the Cookie header. So this is the
// simplest host of all: a plain function that reads the signed session cookie
// straight off the Request - exactly what the neutral cookieCtxFromRequest
// helper does - and builds the `initialCms` state the ContentProvider hydrates
// with. This mirrors the Next host's layout.tsx (next/headers) and the React
// Router / TanStack hosts' request-off-Request reads.

import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";

// The shape ContentProvider's `initialCms` prop accepts. Kept structural so we
// don't depend on a non-exported internal type. Every field is plain JSON so it
// serializes cleanly across the Astro -> React island prop boundary.
export type CmsState = {
  authenticated: boolean;
  user?: string;
  draft?: {
    sessionId: string;
    branch: string;
    title: string;
    prNumber?: number;
    prUrl?: string;
    pagePath?: string;
  };
};

/** Build the initial CMS state for the current request from its session cookie. */
export function getServerSession(request: Request): CmsState {
  const token = cookieCtxFromRequest(request).cookies.get(SESSION_COOKIE);
  const session = verifySession(token);
  return session
    ? { authenticated: true, user: session.user, draft: session.draft }
    : { authenticated: false };
}
