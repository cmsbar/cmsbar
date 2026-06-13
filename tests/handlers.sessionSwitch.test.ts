import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getBranchSha: vi.fn(),
  findOpenPullRequest: vi.fn(),
}));

import { sessionSwitch } from "@/lib/cmsbar/server/handlers/sessionSwitch";
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
} from "@/lib/cmsbar/session";
import { BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = (body?: unknown) =>
  new Request("http://localhost/api/cms/session/switch", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const validToken = () => signSession({ user: "admin", issuedAt: Date.now() });

describe("sessionSwitch handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await sessionSwitch(req({ branch: `${BRANCH_PREFIX}x` }), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when the branch is missing or not a draft branch", async () => {
    const res = await sessionSwitch(req({ branch: "main" }), ctx(validToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `Branch must start with ${BRANCH_PREFIX}`,
    });
  });

  it("returns 400 when the JSON body is absent", async () => {
    const res = await sessionSwitch(req(undefined), ctx(validToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `Branch must start with ${BRANCH_PREFIX}`,
    });
  });

  it("returns 404 when the branch does not exist on GitHub", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue(null as never);
    const branch = `${BRANCH_PREFIX}gone`;
    const res = await sessionSwitch(req({ branch }), ctx(validToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `Branch ${branch} not found` });
  });

  it("switches the draft, returns PR metadata, and sets a fresh session cookie", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("abc123" as never);
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue({
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
      body: "intro",
    } as never);
    const branch = `${BRANCH_PREFIX}feature`;
    const res = await sessionSwitch(req({ branch, title: "My draft" }), ctx(validToken()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      branch,
      title: "My draft",
      prUrl: "https://github.com/o/r/pull/7",
      pagePath: undefined,
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // The re-signed session must carry the switched draft.
    const token = setCookie!.slice(
      setCookie!.indexOf("=") + 1,
      setCookie!.indexOf(";"),
    );
    const session = verifySession(token);
    expect(session?.draft).toMatchObject({
      sessionId: "feature",
      branch,
      title: "My draft",
      prNumber: 7,
      prUrl: "https://github.com/o/r/pull/7",
    });
  });

  it("defaults the draft title to the sessionId when no title is supplied", async () => {
    vi.mocked(gh.getBranchSha).mockResolvedValue("abc123" as never);
    vi.mocked(gh.findOpenPullRequest).mockResolvedValue(null as never);
    const branch = `${BRANCH_PREFIX}solo`;
    const res = await sessionSwitch(req({ branch }), ctx(validToken()));
    const body = (await res.json()) as { title: string; prUrl?: string };
    expect(body.title).toBe("solo");
    expect(body.prUrl).toBeUndefined();
  });

  it("returns 500 when a backend call throws", async () => {
    vi.mocked(gh.getBranchSha).mockRejectedValue(new Error("boom"));
    const res = await sessionSwitch(
      req({ branch: `${BRANCH_PREFIX}x` }),
      ctx(validToken()),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
