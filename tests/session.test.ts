import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession, slugify } from "@/lib/cmsbar/session";
import { isEditorToken } from "@/lib/cmsbar/verifyEdge";

beforeAll(() => {
  process.env.CMS_SESSION_SECRET = "test-secret-with-enough-length-123456";
});

describe("session sign/verify", () => {
  it("round-trips a session", () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const parsed = verifySession(token);
    expect(parsed?.user).toBe("admin");
  });

  it("rejects tampered tokens", () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const [payload] = token.split(".");
    expect(verifySession(`${payload}.deadbeef`)).toBeNull();
    expect(verifySession(payload)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });

  it("rejects expired sessions", () => {
    const token = signSession({
      user: "admin",
      issuedAt: Date.now() - 13 * 60 * 60 * 1000, // 13h ago, TTL is 12h
    });
    expect(verifySession(token)).toBeNull();
  });

  it("carries the draft payload", () => {
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "x-1", branch: "cms/x-1", title: "X" },
    });
    expect(verifySession(token)?.draft?.branch).toBe("cms/x-1");
  });
});

describe("verifyEdge mirrors session.ts", () => {
  it("accepts a token signed by signSession", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    expect(await isEditorToken(token)).toBe(true);
  });

  it("rejects tampered and expired tokens", async () => {
    const stale = signSession({
      user: "admin",
      issuedAt: Date.now() - 13 * 60 * 60 * 1000,
    });
    expect(await isEditorToken(stale)).toBe(false);
    expect(await isEditorToken("garbage.token")).toBe(false);
    expect(await isEditorToken(undefined)).toBe(false);
  });
});

describe("slugify", () => {
  it("makes branch-safe slugs", () => {
    expect(slugify("Update Fall Schedule!")).toBe("update-fall-schedule");
    // NFD strips combining diacritics; đ (no decomposition) is dropped.
    expect(slugify("Čćžšđ diacritics")).toBe("cczs-diacritics");
    expect(slugify("   ")).toBe("draft");
  });
});
