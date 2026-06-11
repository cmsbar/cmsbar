import crypto from "node:crypto";

// A logged-in editor may or may not have an "active draft" - meaning they
// are currently working on a specific cms/<slug> branch / PR. Until they
// start (or pick) a draft, draft fields are undefined.
export type ActiveDraft = {
  sessionId: string;
  branch: string;
  title: string;
  prNumber?: number;
  prUrl?: string;
  pagePath?: string;
};

export type Session = {
  user: string;
  issuedAt: number;
  draft?: ActiveDraft;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function getSecret(): string {
  const s = process.env.CMS_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "CMS_SESSION_SECRET is not set or is too short (>=16 chars).",
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad),
    "base64",
  );
}

export function signSession(session: Session): string {
  const payload = b64url(Buffer.from(JSON.stringify(session)));
  const sig = b64url(
    crypto.createHmac("sha256", getSecret()).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(
    crypto.createHmac("sha256", getSecret()).update(payload).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(fromB64url(payload).toString("utf8")) as Session;
    if (Date.now() - parsed.issuedAt > SESSION_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE } from "./keys";

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "draft"
  );
}
