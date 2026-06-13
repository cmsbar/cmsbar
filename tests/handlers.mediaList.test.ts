import { describe, it, expect, vi, beforeEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

// The handler reads the deployed public/ folder via fs/promises - mock it so
// tests are deterministic and offline (no real filesystem dependency).
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
}));

import { mediaList } from "@/lib/cmsbar/server/handlers/mediaList";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import { readdir } from "fs/promises";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = (query = "") =>
  new Request("http://localhost/api/cms/media/list" + query);

const token = () => signSession({ user: "admin", issuedAt: Date.now() });

describe("mediaList handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session cookie", async () => {
    const res = await mediaList(req(), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("lists videos from the default (media) root, filtered and sorted", async () => {
    vi.mocked(readdir).mockResolvedValue([
      "clip.mp4",
      "notes.txt",
      "sub/intro.webm",
      "image.png",
    ] as never);
    const res = await mediaList(req(), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [{ path: "/media/clip.mp4" }, { path: "/media/sub/intro.webm" }],
    });
  });

  it("lists images from the images root when ?type=image", async () => {
    vi.mocked(readdir).mockResolvedValue([
      "zebra.png",
      "notes.txt",
      "apple.JPG",
      "anim.mp4",
    ] as never);
    const res = await mediaList(req("?type=image"), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [{ path: "/images/apple.JPG" }, { path: "/images/zebra.png" }],
    });
  });

  it("returns an empty library when the directory is missing", async () => {
    vi.mocked(readdir).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    const res = await mediaList(req(), ctx(token()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
  });
});
