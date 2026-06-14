import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  addIssueLabels: vi.fn(),
  removeIssueLabel: vi.fn(),
  setIssueState: vi.fn(),
}));

import { patchIssue } from "@/lib/cmsbar/server/handlers/issueByNumber";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import { IN_PROGRESS_LABEL } from "@/lib/cmsbar/backend/issues";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}

const token = () => signSession({ user: "admin", issuedAt: Date.now() });

function req(number: string | number, body?: unknown) {
  return new Request(`http://localhost/api/cms/issues/${number}`, {
    method: "PATCH",
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
}

describe("patchIssue handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await patchIssue(req(5, { status: "closed" }), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(gh.setIssueState).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer / non-positive issue number", async () => {
    const res = await patchIssue(req("abc", { status: "open" }), ctx(token()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid issue number" });

    const zero = await patchIssue(req(0, { status: "open" }), ctx(token()));
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({ error: "Invalid issue number" });
  });

  it("closes an issue: sets closed state and removes the in-progress label", async () => {
    const res = await patchIssue(req(7, { status: "closed" }), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(gh.setIssueState).toHaveBeenCalledWith(7, "closed");
    expect(gh.removeIssueLabel).toHaveBeenCalledWith(7, IN_PROGRESS_LABEL);
    expect(gh.addIssueLabels).not.toHaveBeenCalled();
  });

  it("parses the issue number from /issues/5 and /issues/5/ alike", async () => {
    // The dispatcher normalizes a trailing slash before matching, so the handler
    // must strip it too - otherwise pop() yields "" → Number("") === 0 → 400.
    const noSlash = await patchIssue(req(5, { status: "closed" }), ctx(token()));
    expect(noSlash.status).toBe(200);
    expect(gh.setIssueState).toHaveBeenCalledWith(5, "closed");

    vi.clearAllMocks();

    const trailing = new Request("http://localhost/api/cms/issues/5/", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
      headers: { "content-type": "application/json" },
    });
    const withSlash = await patchIssue(trailing, ctx(token()));
    expect(withSlash.status).toBe(200);
    expect(await withSlash.json()).toEqual({ ok: true });
    expect(gh.setIssueState).toHaveBeenCalledWith(5, "closed");
  });

  it("reopens an issue: sets open state and removes the in-progress label", async () => {
    const res = await patchIssue(req(8, { status: "open" }), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(gh.setIssueState).toHaveBeenCalledWith(8, "open");
    expect(gh.removeIssueLabel).toHaveBeenCalledWith(8, IN_PROGRESS_LABEL);
    expect(gh.addIssueLabels).not.toHaveBeenCalled();
  });

  it("marks in-progress: sets open state and adds the in-progress label", async () => {
    const res = await patchIssue(req(9, { status: "in-progress" }), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(gh.setIssueState).toHaveBeenCalledWith(9, "open");
    expect(gh.addIssueLabels).toHaveBeenCalledWith(9, [IN_PROGRESS_LABEL]);
    expect(gh.removeIssueLabel).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown status", async () => {
    const res = await patchIssue(req(10, { status: "frozen" }), ctx(token()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown status" });
    expect(gh.setIssueState).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is missing / not JSON", async () => {
    const res = await patchIssue(req(11), ctx(token()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown status" });
  });

  it("returns 500 when a backend call throws", async () => {
    vi.mocked(gh.setIssueState).mockRejectedValueOnce(new Error("boom"));
    const res = await patchIssue(req(12, { status: "closed" }), ctx(token()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
