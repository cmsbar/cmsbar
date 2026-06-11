import { describe, it, expect } from "vitest";
import {
  isAllowedRepoPath,
  isAllowedFolder,
  clampFolder,
  MEDIA_ROOTS,
} from "@/lib/cmsbar/media";

// The template config allows public/images and public/media.
describe("media allowlist", () => {
  it("accepts paths inside configured folders", () => {
    expect(isAllowedRepoPath("public/images/team/photo.jpg")).toBe(true);
    expect(isAllowedRepoPath("public/media/intro.mp4")).toBe(true);
  });

  it("rejects paths outside configured folders", () => {
    expect(isAllowedRepoPath("public/secrets.txt")).toBe(false);
    expect(isAllowedRepoPath("content/site-content.json")).toBe(false);
    expect(isAllowedRepoPath("public/images/../../.env")).toBe(false);
  });

  it("validates folder creation paths", () => {
    expect(isAllowedFolder("images")).toBe(true);
    expect(isAllowedFolder("images/new-album")).toBe(true);
    expect(isAllowedFolder("media/clips")).toBe(true);
    expect(isAllowedFolder("anything-else")).toBe(false);
    expect(isAllowedFolder("images/../escape")).toBe(false);
  });

  it("clamps stray folders onto the default root", () => {
    expect(clampFolder("images/album")).toBe("images/album");
    expect(clampFolder("somewhere")).toBe(`${MEDIA_ROOTS[0]}/somewhere`);
  });
});
