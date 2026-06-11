// OPTIONAL pre-launch teaser gate. Rename to middleware.ts (or merge into
// your existing middleware) to serve a teaser page to the public until the
// site is flipped to "live" from the CMS bar (Settings → Site launch).
// Logged-in editors always see the real site.
//
// Requires: a /teaser route in your app, and `launch: { mode }` in your
// content JSON (the starter content has it).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getContent } from "@/lib/content";
import { isSiteLive, type SiteLaunch } from "@/lib/cmsbar/launch";
import { isEditorToken } from "@/lib/cmsbar/verifyEdge";
import { SESSION_COOKIE, TEASER_HEADER } from "@/lib/cmsbar/keys";

// Paths always reachable regardless of launch state.
function isAlwaysAllowed(pathname: string): boolean {
  return (
    pathname === "/teaser" ||
    pathname.startsWith("/cmsbar/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/favicon.ico"
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isAlwaysAllowed(pathname)) {
    const isLoggedIn = await isEditorToken(
      request.cookies.get(SESSION_COOKIE)?.value,
    );
    const launch = (getContent() as { launch?: SiteLaunch }).launch;
    if (!isSiteLive(launch, isLoggedIn)) {
      const url = request.nextUrl.clone();
      url.pathname = "/teaser";
      // Tag the rewrite so the root layout can render a minimal shell -
      // without serialising the (unreleased) site content into the public DOM.
      const headers = new Headers(request.headers);
      headers.set(TEASER_HEADER, "1");
      return NextResponse.rewrite(url, { request: { headers } });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals, static files, and any path that looks like a file
  // (has a dot-extension), so image optimisation fetches aren't intercepted.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.[^/]+$).*)",
  ],
};
