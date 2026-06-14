// Server half of the CMSBar host wiring for React Router.
//
// The root loader runs on the server for every request; it reads the signed
// session cookie off the incoming Request and builds the `initialCms` state the
// ContentProvider hydrates with. This mirrors the Next host's layout.tsx, which
// reads the cookie via next/headers - here we read it straight off the Request,
// which is exactly what the neutral cookieCtxFromRequest helper does.

import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";

// The shape ContentProvider's `initialCms` prop accepts. Kept structural so we
// don't depend on a non-exported internal type.
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

/** Build the initial CMS state for a request from its signed session cookie. */
export function getServerSession(request: Request): CmsState {
  const token = cookieCtxFromRequest(request).cookies.get(SESSION_COOKIE);
  const session = verifySession(token);
  return session
    ? { authenticated: true, user: session.user, draft: session.draft }
    : { authenticated: false };
}
