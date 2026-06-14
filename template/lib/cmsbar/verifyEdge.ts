// Web Crypto (edge/middleware-safe) verifier for the CMSBar session cookie.
//
// `signSession` in session.ts uses node:crypto, which can't run in middleware.
// This mirrors the exact token format - `<b64url(payload)>.<b64url(HMAC-SHA256)>`
// signed with CMS_SESSION_SECRET - using crypto.subtle so the gate can tell an
// editor from the public without pulling in Node APIs. Verification only (the
// route handlers still sign with session.ts).

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h - keep in sync with session.ts

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** True when `token` is a valid, unexpired CMS session cookie. */
export async function isEditorToken(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.CMS_SESSION_SECRET;
  if (!secret || secret.length < 16) return false;

  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  // Constant-time compare of the HMAC bytes (crypto.timingSafeEqual from
  // node:crypto is unavailable in the edge runtime, so length-guard then
  // XOR-accumulate over the decoded byte arrays). Mirrors verifySession in
  // session.ts, which uses crypto.timingSafeEqual for the same comparison.
  const macBytes = new Uint8Array(mac);
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromB64url(sig);
  } catch {
    return false;
  }
  if (sigBytes.length !== macBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < macBytes.length; i++) diff |= macBytes[i] ^ sigBytes[i];
  if (diff !== 0) return false;

  try {
    const json = new TextDecoder().decode(fromB64url(payload));
    const parsed = JSON.parse(json) as { issuedAt?: number };
    if (typeof parsed.issuedAt !== "number") return false;
    if (Date.now() - parsed.issuedAt > SESSION_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}
