import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handlers reach GitHub through the backend module - mock it so tests are
// deterministic and offline. The issues backend (label conventions + parseIssue)
// is pure, so it runs for real.
vi.mock("@/lib/cmsbar/backend/github", () => ({
  listIssues: vi.fn(),
  createIssue: vi.fn(),
}));

import {
  listIssuesHandler,
  createIssueHandler,
} from "@/lib/cmsbar/server/handlers/issues";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import { CMS_ISSUE_LABEL } from "@/lib/cmsbar/backend/issues";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const getReq = () => new Request("http://localhost/api/cms/issues");
const postReq = (body?: unknown) =>
  new Request("http://localhost/api/cms/issues", {
    method: "POST",
    body: body === undefined ? "not json" : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const authToken = () => signSession({ user: "admin", issuedAt: Date.now() });

// A minimal raw GitHub issue that parseIssue can digest.
function rawIssue(over: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "Button is broken",
    body: "details here",
    html_url: "https://github.com/o/r/issues/7",
    updated_at: "2026-01-01T00:00:00Z",
    state: "open",
    user: { login: "admin" },
    labels: [{ name: CMS_ISSUE_LABEL }, { name: "priority:medium" }],
    ...over,
  };
}

describe("listIssuesHandler (GET)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s with no session cookie", async () => {
    const res = await listIssuesHandler(getReq(), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns parsed issues for a logged-in user", async () => {
    vi.mocked(gh.listIssues).mockResolvedValue([rawIssue()] as never);
    const res = await listIssuesHandler(getReq(), ctx(authToken()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { issues: { number: number }[] };
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0].number).toBe(7);
    expect(gh.listIssues).toHaveBeenCalledWith({
      labels: CMS_ISSUE_LABEL,
      state: "all",
    });
  });

  it("500s when the backend throws", async () => {
    vi.mocked(gh.listIssues).mockRejectedValue(new Error("boom"));
    const res = await listIssuesHandler(getReq(), ctx(authToken()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});

describe("createIssueHandler (POST)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s with no session cookie", async () => {
    const res = await createIssueHandler(
      postReq({ title: "x" }),
      ctx(undefined),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400s when the title is missing/blank", async () => {
    const res = await createIssueHandler(
      postReq({ title: "   " }),
      ctx(authToken()),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("400s when the JSON body is unparseable", async () => {
    const res = await createIssueHandler(postReq(), ctx(authToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("creates the issue with built labels and a context footer", async () => {
    vi.mocked(gh.createIssue).mockResolvedValue(rawIssue() as never);
    const res = await createIssueHandler(
      postReq({
        title: "Button is broken",
        details: "tapping does nothing",
        priority: "high",
        scope: "page",
        page: "/about",
        pageUrl: "https://site/about",
        elementPath: "hero.title",
      }),
      ctx(authToken()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issue: { number: number } };
    expect(body.issue.number).toBe(7);

    expect(gh.createIssue).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(gh.createIssue).mock.calls[0][0];
    expect(arg.title).toBe("Button is broken");
    expect(arg.labels).toEqual([
      CMS_ISSUE_LABEL,
      "priority:high",
      "cms-page:/about",
    ]);
    expect(arg.body).toContain("tapping does nothing");
    expect(arg.body).toContain("[/about](https://site/about)");
    expect(arg.body).toContain("**Element:** `hero.title`");
    expect(arg.body).toContain("**Reporter:** admin");
    expect(arg.body).toContain("<!-- cms-element: hero.title -->");
  });

  it("defaults priority/scope/page and omits page details for editor scope", async () => {
    vi.mocked(gh.createIssue).mockResolvedValue(rawIssue() as never);
    await createIssueHandler(
      postReq({ title: "Editor feedback", scope: "editor" }),
      ctx(authToken()),
    );
    const arg = vi.mocked(gh.createIssue).mock.calls[0][0];
    expect(arg.labels).toEqual([
      CMS_ISSUE_LABEL,
      "priority:medium",
      "cms-scope:editor",
    ]);
    expect(arg.body).not.toContain("**Page:**");
    expect(arg.body).toContain("(about the CMS / editing experience)");
  });

  it("500s when the backend throws", async () => {
    vi.mocked(gh.createIssue).mockRejectedValue(new Error("boom"));
    const res = await createIssueHandler(
      postReq({ title: "x" }),
      ctx(authToken()),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
