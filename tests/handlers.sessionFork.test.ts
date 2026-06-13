import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";
// createBranchFrom() reads these directly off the environment.
process.env.GITHUB_OWNER = "owner";
process.env.GITHUB_REPO = "repo";
process.env.GITHUB_TOKEN = "ghtoken";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getBranchSha: vi.fn(),
  createPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
}));

import { sessionFork } from "@/lib/cmsbar/server/handlers/sessionFork";
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
} from "@/lib/cmsbar/session";
import { draftBranch } from "@/lib/cmsbar/keys";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
function req(body?: unknown) {
  return new Request("http://localhost/api/cms/session/fork", {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const liveToken = () =>
  signSession({ user: "admin", issuedAt: Date.now() });

describe("sessionFork handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The inline createBranchFrom() hits the GitHub refs API via global fetch;
    // stub it to a 201 so the happy path stays offline.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 201 })),
    );
    // Deterministic short id so we can assert the generated branch name.
    vi.spyOn(crypto, "randomBytes").mockImplementation(
      (() => Buffer.from([0xab, 0xcd, 0xef])) as never,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 401 with no session cookie", async () => {
    const res = await sessionFork(req({ fromBranch: "cms/x", title: "T" }), ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when fromBranch is missing", async () => {
    const res = await sessionFork(req({ title: "T" }), ctx(liveToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing fromBranch" });
  });

  it("returns 400 when title is missing or blank", async () => {
    const res = await sessionFork(
      req({ fromBranch: "cms/x", title: "   " }),
      ctx(liveToken()),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing title" });
  });

  it("returns 404 when the source branch has no sha", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue(null);
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null);
    const res = await sessionFork(
      req({ fromBranch: "cms/missing", title: "T" }),
      ctx(liveToken()),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Source branch cms/missing not found",
    });
  });

  it("forks: creates a branch + PR, returns ok, and sets a session cookie carrying the new draft", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("sha123");
    // First call (source branch lookup) -> a PR with cms meta in the body;
    // second call (new branch lookup) -> none, so we create one.
    vi.mocked(gh.findOpenPullRequest)
      .mockResolvedValueOnce({
        number: 1,
        html_url: "http://gh/1",
        body: '<!-- cms-meta: {"pagePath":"/about"} -->',
      } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(gh.createPullRequest).mockResolvedValue({
      number: 42,
      html_url: "http://gh/42",
    } as never);

    const res = await sessionFork(
      req({ fromBranch: "cms/src", title: "  My New Draft  " }),
      ctx(liveToken()),
    );

    expect(res.status).toBe(200);
    const expectedBranch = draftBranch("my-new-draft-abcdef");
    expect(await res.json()).toEqual({
      ok: true,
      branch: expectedBranch,
      title: "My New Draft",
      prUrl: "http://gh/42",
    });

    // The branch was created off the source sha via the raw refs API.
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(fetchBody).toEqual({
      ref: `refs/heads/${expectedBranch}`,
      sha: "sha123",
    });

    // The forked PR carries the source's pagePath forward in its cms meta.
    expect(vi.mocked(gh.createPullRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ head: expectedBranch }),
    );
    expect(vi.mocked(gh.createPullRequest).mock.calls[0][0].body).toContain(
      "/about",
    );

    // Set-Cookie installs a session whose draft points at the new branch/PR.
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookieVal = decodeURIComponent(
      /([^=;]+)=([^;]*)/.exec(setCookie!.split(";")[0])![2],
    );
    const newSession = verifySession(cookieVal);
    expect(newSession?.draft).toMatchObject({
      sessionId: "my-new-draft-abcdef",
      branch: expectedBranch,
      title: "My New Draft",
      prNumber: 42,
      prUrl: "http://gh/42",
      pagePath: "/about",
    });
  });

  it("reuses an already-open PR for the new branch instead of creating one", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("sha123");
    vi.mocked(gh.findOpenPullRequest)
      .mockResolvedValueOnce(null) // source branch: no PR
      .mockResolvedValueOnce({
        number: 7,
        html_url: "http://gh/7",
      } as never); // new branch: existing PR
    const res = await sessionFork(
      req({ fromBranch: "cms/src", title: "Draft" }),
      ctx(liveToken()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, prUrl: "http://gh/7" });
    expect(vi.mocked(gh.createPullRequest)).not.toHaveBeenCalled();
  });

  it("tolerates a failing PR creation and still returns ok with no prUrl", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("sha123");
    vi.mocked(gh.findOpenPullRequest)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(gh.createPullRequest).mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await sessionFork(
      req({ fromBranch: "cms/src", title: "Draft" }),
      ctx(liveToken()),
    );
    expect(res.status).toBe(200);
    // JSON serialization drops the undefined prUrl key entirely.
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty("prUrl");
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns 500 when the create-branch refs call fails", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("sha123");
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 422 })),
    );
    const res = await sessionFork(
      req({ fromBranch: "cms/src", title: "Draft" }),
      ctx(liveToken()),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("createBranchFrom");
  });
});
