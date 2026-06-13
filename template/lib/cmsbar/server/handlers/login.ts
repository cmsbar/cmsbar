import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, signSession } from "@/lib/cmsbar/session";
import {
  clientIp,
  loginRetryAfter,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/cmsbar/rateLimit";
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

// Constant-time string comparison (pads to equal length so length itself
// doesn't leak through timing).
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 1);
  const ab = Buffer.alloc(len);
  const bb = Buffer.alloc(len);
  ab.write(a);
  bb.write(b);
  return crypto.timingSafeEqual(ab, bb) && a.length === b.length;
}

export const login: CmsHandler = async (req) => {
  const ip = clientIp(req);
  const retryAfter = loginRetryAfter(ip);
  if (retryAfter > 0) {
    return json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  const expectedUser = process.env.CMS_USER;
  const expectedHash = process.env.CMS_PASSWORD_HASH;

  if (!expectedUser || !expectedHash) {
    return json(
      { error: "CMS_USER / CMS_PASSWORD_HASH not configured." },
      { status: 500 },
    );
  }
  if (!username || !password) {
    return json({ error: "Missing credentials" }, { status: 400 });
  }

  const userOk = safeEqual(username, expectedUser);
  const passOk = await bcrypt.compare(password, expectedHash);
  if (!userOk || !passOk) {
    recordLoginFailure(ip);
    return json({ error: "Invalid credentials" }, { status: 401 });
  }

  recordLoginSuccess(ip);
  const token = signSession({ user: username, issuedAt: Date.now() });
  const res = json({ ok: true });
  appendCookie(res, sessionCookie(token));
  return res;
};
