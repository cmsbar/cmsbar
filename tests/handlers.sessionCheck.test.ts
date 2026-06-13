import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
}));

import { checkSession } from "@/lib/cmsbar/server/handlers/sessionCheck";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () =>
  new Request("http://localhost/api/cms/session/check");

describe("checkSession handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns authenticated:false with no session cookie", async () => {
    const res = await checkSession(req(), ctx(undefined));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("returns authenticated:true, draft:null for a logged-in user with no draft", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await checkSession(req(), ctx(token));
    expect(await res.json()).toEqual({ authenticated: true, draft: null });
  });

  it("reports approved when the open PR carries the approved label", async () => {
    vi.mocked(gh.getPullRequest).mockResolvedValue({
      number: 5,
      state: "open",
      labels: [{ name: "cmsbar approved" }],
    } as never);
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "s", branch: "cms/x", title: "t", prNumber: 5 },
    });
    const res = await checkSession(req(), ctx(token));
    const body = (await res.json()) as { draft: { approved: boolean } };
    expect(body.draft.approved).toBe(true);
  });

  it("re-issues the session cookie once it is older than the roll window", async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const token = signSession({ user: "admin", issuedAt: twoHoursAgo });
    const res = await checkSession(req(), ctx(token));
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("does NOT re-issue the cookie inside the roll window", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await checkSession(req(), ctx(token));
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
