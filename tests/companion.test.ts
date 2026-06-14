import { describe, it, expect, vi } from "vitest";

process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

vi.mock("@/lib/cmsbar/backend/github", () => ({
  getPullRequest: vi.fn(),
  findOpenPullRequest: vi.fn(),
  baseBranchName: () => "main",
}));

import { createCmsApi } from "@/lib/cmsbar/server/companion";

describe("createCmsApi", () => {
  it("dispatches a web Request to the right handler under the default base", async () => {
    const cms = createCmsApi();
    const res = await cms(
      new Request("http://localhost/api/cms/session", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("honors a custom basePath", async () => {
    const cms = createCmsApi({ basePath: "/cms" });
    const res = await cms(new Request("http://localhost/cms/session"));
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("404s an unknown route", async () => {
    const cms = createCmsApi();
    const res = await cms(new Request("http://localhost/api/cms/nope"));
    expect(res.status).toBe(404);
  });
});
