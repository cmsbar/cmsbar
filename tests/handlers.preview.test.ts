import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getFile: vi.fn(),
}));

import { preview } from "@/lib/cmsbar/server/handlers/preview";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import { BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = (branch?: string) => {
  const u = new URL("http://localhost/api/cms/preview");
  if (branch !== undefined) u.searchParams.set("branch", branch);
  return new Request(u);
};
const draftBranch = `${BRANCH_PREFIX}feature`;
const token = () => signSession({ user: "admin", issuedAt: Date.now() });

describe("preview handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await preview(req(draftBranch), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when the branch is missing", async () => {
    const res = await preview(req(undefined), ctx(token()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `branch must start with ${BRANCH_PREFIX}`,
    });
  });

  it("returns 400 when the branch is not a draft branch", async () => {
    const res = await preview(req("master"), ctx(token()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `branch must start with ${BRANCH_PREFIX}`,
    });
    expect(gh.getFile).not.toHaveBeenCalled();
  });

  it("returns the parsed content for a draft branch", async () => {
    vi.mocked(gh.getFile).mockResolvedValue({
      content: JSON.stringify({ hero: "hi" }),
    } as never);
    const res = await preview(req(draftBranch), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: { hero: "hi" } });
  });

  it("returns content:null with 200 when the file is absent on the branch", async () => {
    vi.mocked(gh.getFile).mockResolvedValue(null as never);
    const res = await preview(req(draftBranch), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: null });
  });

  it("returns 500 when the backend throws", async () => {
    vi.mocked(gh.getFile).mockRejectedValue(new Error("boom"));
    const res = await preview(req(draftBranch), ctx(token()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
