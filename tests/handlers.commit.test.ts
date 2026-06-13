import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";
process.env.GITHUB_OWNER = "acme";
process.env.GITHUB_REPO = "site";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
// baseBranchName drives both 409 mode-switch guards, so it must be stable.
vi.mock("@/lib/cmsbar/backend/github", () => ({
  baseBranchName: vi.fn(() => "main"),
  ensureBranch: vi.fn(async () => {}),
  getBranchSha: vi.fn(),
  getFile: vi.fn(),
  getCommit: vi.fn(),
  getPullRequest: vi.fn(),
  createBlob: vi.fn(),
  createTree: vi.fn(),
  createCommit: vi.fn(),
  updateRef: vi.fn(),
  createPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
}));

// publishingMode decides direct vs reviewed flow; default to "review" and let
// individual tests flip it to "direct". Keep the real defineCmsConfig (cms.config
// imports it) and only stub the mode selector.
vi.mock("@/lib/cmsbar/config", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/cmsbar/config")>(
      "@/lib/cmsbar/config",
    );
  return { ...actual, publishingMode: vi.fn(() => "review") };
});

// getContent is the fallback content snapshot merged into edits; keep it tiny
// and avoid loading the project content JSON.
vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content");
  return { ...actual, getContent: vi.fn(() => ({ hero: { title: "old" } })) };
});

import { commit } from "@/lib/cmsbar/server/handlers/commit";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";
import { publishingMode } from "@/lib/cmsbar/config";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}

const req = (body?: unknown) =>
  new Request("http://localhost/api/cms/commit", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

// A reviewed-mode session pointing at a cms/* draft branch (not the base).
function reviewedToken(overrides: Record<string, unknown> = {}) {
  return signSession({
    user: "admin",
    issuedAt: Date.now(),
    draft: {
      sessionId: "s-1",
      branch: "cms/hero-fix",
      title: "Hero fix",
      ...overrides,
    },
  });
}

// Wire the github backend so commitTo() completes one full round.
function wireHappyCommit() {
  vi.mocked(gh.getBranchSha).mockResolvedValue("head-sha");
  vi.mocked(gh.getCommit).mockResolvedValue({ tree: { sha: "tree-sha" } } as never);
  vi.mocked(gh.getFile).mockResolvedValue({
    content: JSON.stringify({ hero: { title: "old" } }),
  } as never);
  vi.mocked(gh.createBlob).mockResolvedValue("blob-sha");
  vi.mocked(gh.createTree).mockResolvedValue("new-tree-sha");
  vi.mocked(gh.createCommit).mockResolvedValue("new-commit-sha");
  vi.mocked(gh.updateRef).mockResolvedValue(undefined as never);
}

describe("commit handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gh.baseBranchName).mockReturnValue("main");
    vi.mocked(publishingMode).mockReturnValue("review");
  });

  it("401s with no session cookie", async () => {
    const res = await commit(req({ edits: [] }), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400s when the session has no active draft", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await commit(req({ edits: [] }), ctx(token));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "No active draft. Start one via /api/cms/session/start.",
    });
  });

  it("400s on a non-JSON body", async () => {
    const bad = new Request("http://localhost/api/cms/commit", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const res = await commit(bad, ctx(reviewedToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
  });

  it("400s when there is nothing to commit", async () => {
    const res = await commit(req({}), ctx(reviewedToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing to commit" });
  });

  it("400s on an upload outside the allowed media folders", async () => {
    const res = await commit(
      req({ uploads: [{ repoPath: "etc/passwd", contentBase64: "x" }] }),
      ctx(reviewedToken()),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Upload outside");
  });

  it("commits to the draft branch and returns branch + PR info (reviewed)", async () => {
    wireHappyCommit();
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null);
    vi.mocked(gh.createPullRequest).mockResolvedValue({
      number: 7,
      html_url: "https://github.com/acme/site/pull/7",
    } as never);

    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken()),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      branch: "cms/hero-fix",
      branchUrl: "https://github.com/acme/site/tree/cms/hero-fix",
      commit: "new-commit-sha",
      prUrl: "https://github.com/acme/site/pull/7",
    });
    expect(gh.ensureBranch).toHaveBeenCalledWith("cms/hero-fix");
  });

  it("refreshes the session cookie when a new PR number is learned", async () => {
    wireHappyCommit();
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null);
    vi.mocked(gh.createPullRequest).mockResolvedValue({
      number: 7,
      html_url: "https://github.com/acme/site/pull/7",
    } as never);

    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken()),
    );
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("does NOT refresh the cookie when the draft already has a PR number", async () => {
    wireHappyCommit();
    // Draft already carries a PR; the approval check sees an unlocked PR.
    vi.mocked(gh.getPullRequest).mockResolvedValue({
      number: 7,
      labels: [],
    } as never);
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(
        reviewedToken({
          prNumber: 7,
          prUrl: "https://github.com/acme/site/pull/7",
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(gh.createPullRequest).not.toHaveBeenCalled();
  });

  it("409s and locks when the draft PR carries the approved label", async () => {
    vi.mocked(gh.getPullRequest).mockResolvedValue({
      number: 7,
      labels: [{ name: "cmsbar approved" }],
    } as never);
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ prNumber: 7 })),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.approved).toBe(true);
    expect(body.error).toContain("approved");
  });

  it("409s in reviewed mode when the draft points at the base branch", async () => {
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ branch: "main" })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(
      "predates the switch back to reviewed publishing",
    );
  });

  it("409s in direct mode when the draft carries a cms/* draft branch", async () => {
    vi.mocked(publishingMode).mockReturnValue("direct");
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ branch: "cms/hero-fix" })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(
      "predates the switch to direct publishing",
    );
  });

  it("direct mode commits straight to base and returns the commit URL", async () => {
    vi.mocked(publishingMode).mockReturnValue("direct");
    wireHappyCommit();
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ branch: "main" })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      direct: true,
      branch: "main",
      commitSha: "new-commit-sha",
      branchUrl: "https://github.com/acme/site/commit/new-commit-sha",
    });
    expect(gh.ensureBranch).not.toHaveBeenCalled();
  });

  it("direct mode retries once on a non-fast-forward and then succeeds", async () => {
    vi.mocked(publishingMode).mockReturnValue("direct");
    wireHappyCommit();
    // First updateRef loses the race (non-FF), second wins.
    vi.mocked(gh.updateRef)
      .mockRejectedValueOnce(
        new Error("updateRef main failed: 422 Update is not a fast forward"),
      )
      .mockResolvedValueOnce(undefined as never);

    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ branch: "main" })),
    );
    expect(res.status).toBe(200);
    expect(gh.updateRef).toHaveBeenCalledTimes(2);
    expect(await res.json()).toMatchObject({ ok: true, direct: true });
  });

  it("direct mode does NOT retry a non-fast-forward-unrelated error (returns 500)", async () => {
    vi.mocked(publishingMode).mockReturnValue("direct");
    wireHappyCommit();
    vi.mocked(gh.updateRef).mockRejectedValue(new Error("403 rate limited"));

    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken({ branch: "main" })),
    );
    expect(res.status).toBe(500);
    expect(gh.updateRef).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).toContain("403 rate limited");
  });

  it("500s when a backend call throws inside the commit round", async () => {
    wireHappyCommit();
    vi.mocked(gh.getBranchSha).mockResolvedValue(null);
    const res = await commit(
      req({ edits: [{ path: "hero.title", value: "new" }] }),
      ctx(reviewedToken()),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Editing branch vanished");
  });
});
