// SPA boot entry.
//
// Unlike the SSR examples (Next layout.tsx / React Router root loader / TanStack
// server fn), an SPA has no server render to read the session cookie during. So
// `initialCms` comes from a boot-time fetch: GET /api/cms/session, which the
// Hono companion answers off the (same-origin) signed session cookie. We show a
// brief "checking session" state, then mount the providers + demo App + CmsBar.
//
// The host seam needs NO framework adapter here: <HostProvider apiBase="/api/cms">
// with no `value` uses the neutral DOM defaults (window.location pathname +
// popstate, a plain <img> for images). useHost() and the primitives work
// client-side out of the box.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles/app.css";
import { getContent } from "@/lib/content";
import { HostProvider } from "@/components/cmsbar/host";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { CmsBar } from "@/components/cmsbar/CmsBar";
import { App } from "./App";

// The structural shape ContentProvider's `initialCms` accepts (kept local so we
// don't depend on a non-exported internal type). Mirrors GET /api/cms/session.
type CmsState = {
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

const API_BASE = "/api/cms";

async function fetchSession(): Promise<CmsState> {
  try {
    const res = await fetch(`${API_BASE}/session`, {
      credentials: "same-origin",
    });
    if (!res.ok) return { authenticated: false };
    const body = (await res.json()) as CmsState & { draft?: CmsState["draft"] | null };
    return {
      authenticated: !!body.authenticated,
      user: body.user,
      draft: body.draft ?? undefined,
    };
  } catch {
    // Companion unreachable - render read-only (not authenticated).
    return { authenticated: false };
  }
}

function Boot() {
  const [initialCms, setInitialCms] = useState<CmsState | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSession().then((s) => {
      if (alive) setInitialCms(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (initialCms === null) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#64748b",
        }}
      >
        Checking session…
      </div>
    );
  }

  // Neutral host seam, no framework adapter: pass only the apiBase through
  // `value` (everything else - pathname/popstate, navigate, a plain <img> -
  // falls back to the DOM defaults). apiBase happens to equal the default
  // "/api/cms", so `<HostProvider>` with no props would work too; we pass it
  // explicitly to document where the API base is wired.
  return (
    <HostProvider value={{ apiBase: API_BASE }}>
      <ContentProvider content={getContent()} initialCms={initialCms}>
        <App />
        <CmsBar />
      </ContentProvider>
    </HostProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
