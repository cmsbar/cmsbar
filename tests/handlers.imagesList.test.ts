import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  ensureBranch: vi.fn(),
  listTree: vi.fn(),
}));

import { imagesList } from "@/lib/cmsbar/server/handlers/imagesList";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () => new Request("http://localhost/api/cms/images/list");

describe("imagesList handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await imagesList(req(), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("filters to images, strips public/, and sorts by path", async () => {
    vi.mocked(gh.listTree).mockResolvedValue([
      { path: "public/images/zebra.png", type: "blob", size: 30 },
      { path: "public/images/notes.txt", type: "blob", size: 10 },
      { path: "public/images/apple.JPG", type: "blob", size: 20 },
    ] as never);
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await imagesList(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      images: [
        { path: "/images/apple.JPG", repoPath: "public/images/apple.JPG", size: 20 },
        { path: "/images/zebra.png", repoPath: "public/images/zebra.png", size: 30 },
      ],
    });
    // No draft -> reads the base branch and skips the branch-ensure step.
    expect(gh.ensureBranch).not.toHaveBeenCalled();
  });

  it("ensures the draft branch and lists from it when a draft is active", async () => {
    vi.mocked(gh.listTree).mockResolvedValue([] as never);
    const token = signSession({
      user: "admin",
      issuedAt: Date.now(),
      draft: { sessionId: "s", branch: "cms/x", title: "t" },
    });
    const res = await imagesList(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ images: [] });
    expect(gh.ensureBranch).toHaveBeenCalledWith("cms/x");
    expect(gh.listTree).toHaveBeenCalledWith("cms/x", expect.any(String));
  });

  it("returns 500 with the stringified error when the backend throws", async () => {
    vi.mocked(gh.listTree).mockRejectedValue(new Error("boom"));
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await imagesList(req(), ctx(token));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
