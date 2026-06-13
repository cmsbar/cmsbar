import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  baseBranchName: vi.fn(() => "main"),
  ensureBranch: vi.fn(),
  createPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
}));

// publishingMode drives the review-vs-direct branch; mock it so each test picks
// a mode without touching the real cms.config. Partial mock so defineCmsConfig
// (used by cms.config.ts / keys.ts) keeps its real implementation.
vi.mock("@/lib/cmsbar/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cmsbar/config")>()),
  publishingMode: vi.fn(() => "review"),
}));

import { sessionStart } from "@/lib/cmsbar/server/handlers/sessionStart";
import { signSession, verifySession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";
import { publishingMode } from "@/lib/cmsbar/config";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
function req(body?: unknown) {
  return new Request("http://localhost/api/cms/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const validToken = () => signSession({ user: "admin", issuedAt: Date.now() });

// Pull the signed session token out of the response's Set-Cookie header.
function tokenFromSetCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? m[1] : "";
}

describe("sessionStart handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publishingMode).mockReturnValue("review");
  });

  it("returns 401 when there is no session cookie", async () => {
    const res = await sessionStart(req({ title: "x" }), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when the title is missing or blank", async () => {
    const res = await sessionStart(req({ title: "   " }), ctx(validToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing title" });
  });

  it("returns 400 when the JSON body is absent/unparseable", async () => {
    const res = await sessionStart(req(undefined), ctx(validToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing title" });
  });

  it("review mode: opens a draft branch + PR and sets the session cookie", async () => {
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null as never);
    vi.mocked(gh.createPullRequest).mockResolvedValue({
      number: 42,
      html_url: "https://github.com/o/r/pull/42",
    } as never);

    const res = await sessionStart(
      req({ title: "My Draft", pagePath: "/about" }),
      ctx(validToken()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      branch: expect.stringMatching(/^cms\/my-draft-[0-9a-f]{6}$/),
      title: "My Draft",
      prUrl: "https://github.com/o/r/pull/42",
    });
    expect(gh.ensureBranch).toHaveBeenCalledTimes(1);
    expect(gh.createPullRequest).toHaveBeenCalledTimes(1);

    // Cookie carries the freshly-minted draft session.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const minted = verifySession(tokenFromSetCookie(res));
    expect(minted?.draft).toMatchObject({
      title: "My Draft",
      prNumber: 42,
      prUrl: "https://github.com/o/r/pull/42",
      pagePath: "/about",
    });
  });

  it("review mode: reuses an existing open PR instead of creating one", async () => {
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue({
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
    } as never);

    const res = await sessionStart(req({ title: "Reuse" }), ctx(validToken()));
    expect(res.status).toBe(200);
    expect(gh.createPullRequest).not.toHaveBeenCalled();
    const body = (await res.json()) as { prUrl: string };
    expect(body.prUrl).toBe("https://github.com/o/r/pull/7");
  });

  it("review mode: PR creation failure does not fail session start", async () => {
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null as never);
    vi.mocked(gh.createPullRequest).mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await sessionStart(req({ title: "Resilient" }), ctx(validToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; prUrl?: string };
    expect(body.ok).toBe(true);
    expect(body.prUrl).toBeUndefined();
    // Session still minted (no prNumber).
    const minted = verifySession(tokenFromSetCookie(res));
    expect(minted?.draft?.prNumber).toBeUndefined();
    errSpy.mockRestore();
  });

  it("review mode: returns 500 when ensureBranch throws", async () => {
    vi.mocked(gh.ensureBranch).mockRejectedValue(new Error("git down"));
    const res = await sessionStart(req({ title: "x" }), ctx(validToken()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: git down" });
  });

  it("direct mode: points the draft at the base branch, no PR, sets cookie", async () => {
    vi.mocked(publishingMode).mockReturnValue("direct");

    const res = await sessionStart(
      req({ title: "Anything", pagePath: "/contact" }),
      ctx(validToken()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      branch: "main",
      title: "Live edits",
    });
    expect(gh.ensureBranch).not.toHaveBeenCalled();
    expect(gh.createPullRequest).not.toHaveBeenCalled();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    const minted = verifySession(tokenFromSetCookie(res));
    expect(minted?.draft).toMatchObject({
      branch: "main",
      title: "Live edits",
      pagePath: "/contact",
    });
    expect(minted?.draft?.sessionId).toMatch(/^live-[0-9a-f]{6}$/);
  });
});
