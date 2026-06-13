import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reaches GitHub through the backend module - mock it so tests are
// deterministic and offline (the doc's "GitHub mocked" integration harness).
vi.mock("@/lib/cmsbar/backend/github", () => ({
  listOpenPullRequests: vi.fn(),
  countCommits: vi.fn(),
}));

import { versions } from "@/lib/cmsbar/server/handlers/versions";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import { approvedLabelName } from "@/lib/cmsbar/approved";
import * as gh from "@/lib/cmsbar/backend/github";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () => new Request("http://localhost/api/cms/versions");

describe("versions handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await versions(req(), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("lists open draft PRs with commit counts and approval flags", async () => {
    const approvedLabel = approvedLabelName();
    vi.mocked(gh.listOpenPullRequests).mockResolvedValue([
      {
        number: 7,
        title: "[CMS draft] Tweak homepage",
        head: { ref: "cms/abc", sha: "deadbeef" },
        user: { login: "alice" },
        updated_at: "2026-06-13T10:00:00Z",
        html_url: "https://github.com/o/r/pull/7",
        labels: [{ name: approvedLabel.toUpperCase() }],
      },
    ] as never);
    vi.mocked(gh.countCommits).mockResolvedValue(3 as never);

    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await versions(req(), ctx(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approvedLabel: string;
      versions: Array<{
        number: number;
        title: string;
        branch: string;
        headSha: string;
        author: string | null;
        updatedAt: string;
        commitCount: number;
        prUrl: string;
        approved: boolean;
        labels: string[];
      }>;
    };
    expect(body.approvedLabel).toBe(approvedLabel);
    expect(body.versions).toEqual([
      {
        number: 7,
        // [CMS draft] prefix stripped.
        title: "Tweak homepage",
        branch: "cms/abc",
        headSha: "deadbeef",
        author: "alice",
        updatedAt: "2026-06-13T10:00:00Z",
        commitCount: 3,
        prUrl: "https://github.com/o/r/pull/7",
        // matched case-insensitively against the approved label.
        approved: true,
        labels: [approvedLabel.toUpperCase()],
      },
    ]);
  });

  it("falls back to commitCount 0 when countCommits throws, leaving approved false", async () => {
    vi.mocked(gh.listOpenPullRequests).mockResolvedValue([
      {
        number: 8,
        title: "No prefix here",
        head: { ref: "cms/xyz", sha: "cafe" },
        user: null,
        updated_at: "2026-06-13T11:00:00Z",
        html_url: "https://github.com/o/r/pull/8",
        labels: [{ name: "other" }],
      },
    ] as never);
    vi.mocked(gh.countCommits).mockRejectedValue(new Error("boom"));

    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await versions(req(), ctx(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      versions: Array<{
        title: string;
        author: string | null;
        commitCount: number;
        approved: boolean;
      }>;
    };
    expect(body.versions[0].commitCount).toBe(0);
    expect(body.versions[0].author).toBeNull();
    expect(body.versions[0].approved).toBe(false);
    expect(body.versions[0].title).toBe("No prefix here");
  });

  it("returns 500 when listing PRs fails", async () => {
    vi.mocked(gh.listOpenPullRequests).mockRejectedValue(
      new Error("GitHub down"),
    );
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await versions(req(), ctx(token));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: GitHub down" });
  });
});
