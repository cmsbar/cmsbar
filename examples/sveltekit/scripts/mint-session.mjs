// Mint a CMSBar editor session cookie for render checks. Imports the REAL
// signSession + SESSION_COOKIE from the neutral session module (run through
// vite-node so the "@/cms.config" alias resolves), then prints:
//
//   <SESSION_COOKIE>=<token>
//
// so the caller can pass it straight to `curl -H "Cookie: <that>"`. Requires
// CMS_SESSION_SECRET in the environment (signSession throws without it).

import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";

const token = signSession({ user: "admin", issuedAt: Date.now() });
process.stdout.write(`${SESSION_COOKIE}=${token}`);
