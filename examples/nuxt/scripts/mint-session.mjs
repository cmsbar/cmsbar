// Mint a CMSBar editor session cookie for render checks. Imports the REAL
// signSession + SESSION_COOKIE from the neutral session module (run through
// vite-node so the "@/cms.config" alias resolves), then prints:
//
//   <SESSION_COOKIE>=<token>
//
// so the caller can pass it straight to `curl -H "Cookie: <that>"`. Requires
// CMS_SESSION_SECRET in the environment (signSession throws without it).
//
// Pass --draft to embed an active draft in the session, so the store seeds
// editMode = true and <T> renders contenteditable (the editor render check).
// Run with: npx vite-node -c vitest.config.ts scripts/mint-session.mjs [--draft]

import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";

const withDraft = process.argv.includes("--draft");

const draft = withDraft
  ? {
      sessionId: "render-check",
      branch: "cms/render-check",
      title: "Render check draft",
      pagePath: "/",
    }
  : undefined;

const token = signSession({ user: "admin", issuedAt: Date.now(), draft });
process.stdout.write(`${SESSION_COOKIE}=${token}`);
