import { describe, it, expect, vi } from "vitest";

process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// Some handlers reach GitHub; unauthenticated requests short-circuit before that,
// but mock the backend modules so nothing hits the network if routing slips.
vi.mock("@/lib/cmsbar/backend/github", () => ({
  getPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
  baseBranchName: () => "main",
}));

import { handleCmsRequest, CMS_ROUTES } from "@/lib/cmsbar/server/router";

const req = (method: string, path: string) =>
  new Request(`http://localhost${path}`, { method });

describe("handleCmsRequest dispatcher", () => {
  it("routes GET /api/cms/session to the session handler", async () => {
    const res = await handleCmsRequest(req("GET", "/api/cms/session"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("routes GET /api/cms/session/check (nested path)", async () => {
    const res = await handleCmsRequest(req("GET", "/api/cms/session/check"));
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("routes POST /api/cms/commit (unauthenticated → 401 from the handler)", async () => {
    const res = await handleCmsRequest(req("POST", "/api/cms/commit"));
    expect(res.status).toBe(401);
  });

  it("prefers exact /issues over the /issues/:number pattern", async () => {
    // GET /issues exists; GET /issues/5 does not (only PATCH) → 405, proving the
    // param route is matched but method-checked, and the bare path is distinct.
    const bare = await handleCmsRequest(req("GET", "/api/cms/issues"));
    expect(bare.status).toBe(401); // listIssues requires a session
    const param = await handleCmsRequest(req("GET", "/api/cms/issues/5"));
    expect(param.status).toBe(405);
  });

  it("routes the parameterized PATCH /issues/:number", async () => {
    const res = await handleCmsRequest(req("PATCH", "/api/cms/issues/5"));
    expect(res.status).toBe(401); // patchIssue requires a session
  });

  it("404 for an unknown path", async () => {
    const res = await handleCmsRequest(req("GET", "/api/cms/nope"));
    expect(res.status).toBe(404);
  });

  it("405 for a known path with the wrong method", async () => {
    const res = await handleCmsRequest(req("DELETE", "/api/cms/session"));
    expect(res.status).toBe(405);
  });

  it("honors a custom basePath", async () => {
    const res = await handleCmsRequest(req("GET", "/cms/session"), {
      basePath: "/cms",
    });
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("every route in the table has a handler", () => {
    expect(CMS_ROUTES.length).toBe(18); // 17 routes; /issues has GET + POST
    for (const r of CMS_ROUTES) expect(typeof r.handler).toBe("function");
  });
});
