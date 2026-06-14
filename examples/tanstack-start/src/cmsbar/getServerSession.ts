// Server half of the CMSBar host wiring for TanStack Start.
//
// Wrapped as a `createServerFn` so it is guaranteed to run only on the server
// (the root route's loader runs isomorphically, so we cannot call getRequest()
// there directly). Inside the server fn, getRequest() yields the incoming web
// Request; we read the signed session cookie straight off it - exactly what the
// neutral cookieCtxFromRequest helper does - and build the `initialCms` state
// the ContentProvider hydrates with. This mirrors the Next host's layout.tsx
// (next/headers) and the React Router host's root loader (request off Request).

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
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

/** Build the initial CMS state for the current request from its session cookie. */
export const getServerSession = createServerFn({ method: "GET" }).handler(
  (): CmsState => {
    const request = getRequest();
    const token = cookieCtxFromRequest(request).cookies.get(SESSION_COOKIE);
    const session = verifySession(token);
    return session
      ? { authenticated: true, user: session.user, draft: session.draft }
      : { authenticated: false };
  },
);
