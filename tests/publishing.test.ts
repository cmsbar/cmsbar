import { describe, it, expect } from "vitest";
import { publishingMode } from "@/lib/cmsbar/config";

describe("publishingMode", () => {
  it("defaults to review when publishing config is absent", () => {
    expect(publishingMode({})).toBe("review");
  });

  it("defaults to review when publishing is present but mode is not", () => {
    expect(publishingMode({ publishing: {} })).toBe("review");
  });

  it("honours an explicit review mode", () => {
    expect(publishingMode({ publishing: { mode: "review" } })).toBe("review");
  });

  it("enables direct mode only on the exact literal", () => {
    expect(publishingMode({ publishing: { mode: "direct" } })).toBe("direct");
  });
});
