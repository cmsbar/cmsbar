// Minimal in-memory rate limiter for the CMS login endpoint. Good enough for
// a single-container deployment (Coolify runs one instance); a multi-instance
// deployment would need a shared store, which this site doesn't have or need.

type Bucket = { failures: number; firstFailureAt: number; lockedUntil: number };

const WINDOW_MS = 15 * 60 * 1000; // failures older than this are forgotten
const MAX_FAILURES = 5; // per window, per IP
const LOCKOUT_MS = 15 * 60 * 1000; // lockout once the budget is spent

const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  // Keep the map from growing unboundedly under scanner traffic.
  if (buckets.size < 1000) return;
  for (const [ip, b] of buckets) {
    if (now - b.firstFailureAt > WINDOW_MS && b.lockedUntil < now) {
      buckets.delete(ip);
    }
  }
}

/** The client IP for rate-limiting. Coolify/Traefik sets x-forwarded-for. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Returns the number of seconds the caller must wait, or 0 if allowed. */
export function loginRetryAfter(ip: string): number {
  const b = buckets.get(ip);
  if (!b) return 0;
  const now = Date.now();
  if (b.lockedUntil > now) return Math.ceil((b.lockedUntil - now) / 1000);
  if (now - b.firstFailureAt > WINDOW_MS) {
    buckets.delete(ip);
    return 0;
  }
  return 0;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  prune(now);
  const b = buckets.get(ip);
  if (!b || now - b.firstFailureAt > WINDOW_MS) {
    buckets.set(ip, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }
  b.failures += 1;
  if (b.failures >= MAX_FAILURES) {
    b.lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordLoginSuccess(ip: string): void {
  buckets.delete(ip);
}
