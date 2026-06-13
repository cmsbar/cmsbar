import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline.
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getFileBinary: vi.fn(),
}));

import { imagesRaw } from "@/lib/cmsbar/server/handlers/imagesRaw";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}

// cms.config.ts allows public/images and public/media; cms/* is a draft branch.
const ALLOWED_PATH = "public/images/photo.png";
const DRAFT_BRANCH = "cms/edit-123";

function req(query = "") {
  return new Request(`http://localhost/api/cms/images/raw${query}`);
}

const authedToken = () => signSession({ user: "admin", issuedAt: Date.now() });

describe("imagesRaw handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s with no session cookie", async () => {
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}&path=${ALLOWED_PATH}`),
      ctx(undefined),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400s when branch or path is missing", async () => {
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing branch or path" });
  });

  it("400s for a path outside the allowed media folders", async () => {
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}&path=${encodeURIComponent("public/secrets/x.png")}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/^Path outside /);
  });

  it("400s when the branch is not a draft branch", async () => {
    const res = await imagesRaw(
      req(`?branch=master&path=${ALLOWED_PATH}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/^Branch must start with /);
  });

  it("404s when the file is not on the branch", async () => {
    vi.mocked(gh.getFileBinary).mockResolvedValue(null);
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}&path=${ALLOWED_PATH}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found on branch" });
  });

  it("serves the binary bytes with mime + cache headers on the happy path", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    vi.mocked(gh.getFileBinary).mockResolvedValue({ bytes, sha: "abc" });
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}&path=${ALLOWED_PATH}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=30, must-revalidate",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(bytes),
    );
    expect(gh.getFileBinary).toHaveBeenCalledWith(DRAFT_BRANCH, ALLOWED_PATH);
  });

  it("500s when the backend throws", async () => {
    vi.mocked(gh.getFileBinary).mockRejectedValue(new Error("boom"));
    const res = await imagesRaw(
      req(`?branch=${DRAFT_BRANCH}&path=${ALLOWED_PATH}`),
      ctx(authedToken()),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
  });
});
