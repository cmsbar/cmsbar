import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getBranchSha: vi.fn(),
  countCommits: vi.fn(),
  deleteBranch: vi.fn(),
}));

import { sessionClear } from "@/lib/cmsbar/server/handlers/sessionClear";
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
} from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () => new Request("http://localhost/api/cms/session/clear");

// Pull the token out of the Set-Cookie the handler appended, so we can verify
// what the re-issued session actually carries.
function tokenFromSetCookie(setCookie: string | null): string {
  const m = (setCookie ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m?.[1] ?? "";
}

describe("sessionClear handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 Unauthorized with no session cookie", async () => {
    const res = await sessionClear(req(), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clears a draft-less session and re-issues the session cookie", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await sessionClear(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedBranch: undefined });
    // No draft → no GitHub cleanup calls.
    expect(gh.getBranchSha).not.toHaveBeenCalled();
    expect(gh.deleteBranch).not.toHaveBeenCalled();
    // Re-issued cookie present, with the session attributes (rolling 12h window).
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    // The new session keeps the user but drops any draft.
    const reissued = verifySession(tokenFromSetCookie(setCookie));
    expect(reissued?.user).toBe("admin");
    expect(reissued?.draft).toBeUndefined();
  });

  it("deletes the orphan branch when the draft has no commits ahead of base", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("abc123");
    vi.mocked(gh.countCommits).mockResolvedValue(0);
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "s", branch: "cms/x", title: "t" },
    });
    const res = await sessionClear(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedBranch: "cms/x" });
    expect(gh.deleteBranch).toHaveBeenCalledWith("cms/x");
  });

  it("leaves a branch with real commits intact (no delete, no deletedBranch)", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("abc123");
    vi.mocked(gh.countCommits).mockResolvedValue(3);
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "s", branch: "cms/x", title: "t" },
    });
    const res = await sessionClear(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedBranch: undefined });
    expect(gh.deleteBranch).not.toHaveBeenCalled();
  });

  it("never blocks discarding the draft on a cleanup failure", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(gh.getBranchSha).mockRejectedValue(new Error("boom"));
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "s", branch: "cms/x", title: "t" },
    });
    const res = await sessionClear(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedBranch: undefined });
    expect(gh.deleteBranch).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
