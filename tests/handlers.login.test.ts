import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";
// The handler reads the configured credentials from the environment.
process.env.CMS_USER = "admin";
process.env.CMS_PASSWORD_HASH = "$2a$10$fakehashforthetestsuiteonly000000";

// bcrypt's compare is the password check - mock it so tests are deterministic
// and don't depend on a real hash.
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}));

// The rate limiter keeps in-memory state across calls; mock it so each test
// controls the gate and the failure/success bookkeeping is observable.
vi.mock("@/lib/cmsbar/rateLimit", () => ({
  clientIp: vi.fn(() => "1.2.3.4"),
  loginRetryAfter: vi.fn(() => 0),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));

import { login } from "@/lib/cmsbar/server/handlers/login";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import bcrypt from "bcryptjs";
import * as rl from "@/lib/cmsbar/rateLimit";

const ctx = { cookies: { get: () => undefined } };

function req(body?: unknown, headers?: Record<string, string>) {
  return new Request("http://localhost/api/cms/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("login handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rl.clientIp).mockReturnValue("1.2.3.4");
    vi.mocked(rl.loginRetryAfter).mockReturnValue(0);
    process.env.CMS_USER = "admin";
    process.env.CMS_PASSWORD_HASH = "$2a$10$fakehashforthetestsuiteonly000000";
  });

  it("sets the session cookie and returns ok on valid credentials", async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    const res = await login(req({ username: "admin", password: "secret" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    // The cookie carries a valid signed session for the logged-in user.
    const token = setCookie!.slice(
      setCookie!.indexOf("=") + 1,
      setCookie!.indexOf(";"),
    );
    expect(verifySession(token)?.user).toBe("admin");

    expect(rl.recordLoginSuccess).toHaveBeenCalledWith("1.2.3.4");
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the IP is locked out", async () => {
    vi.mocked(rl.loginRetryAfter).mockReturnValue(42);
    const res = await login(req({ username: "admin", password: "secret" }), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.json()).toEqual({
      error: "Too many failed attempts. Try again later.",
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns 500 when CMS_USER / CMS_PASSWORD_HASH are not configured", async () => {
    delete process.env.CMS_USER;
    delete process.env.CMS_PASSWORD_HASH;
    const res = await login(req({ username: "admin", password: "secret" }), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "CMS_USER / CMS_PASSWORD_HASH not configured.",
    });
  });

  it("returns 400 when credentials are missing", async () => {
    const res = await login(req({ username: "admin" }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing credentials" });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const bad = new Request("http://localhost/api/cms/login", {
      method: "POST",
      body: "not json",
    });
    const res = await login(bad, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing credentials" });
  });

  it("returns 401 and records a failure on a wrong password", async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    const res = await login(
      req({ username: "admin", password: "wrong" }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(rl.recordLoginFailure).toHaveBeenCalledWith("1.2.3.4");
    expect(rl.recordLoginSuccess).not.toHaveBeenCalled();
  });

  it("returns 401 and records a failure on a wrong username", async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    const res = await login(
      req({ username: "intruder", password: "secret" }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
    expect(rl.recordLoginFailure).toHaveBeenCalledWith("1.2.3.4");
  });
});
