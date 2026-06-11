import { describe, it, expect } from "vitest";
import { resolvePath, setPath } from "@/lib/cmsbar/paths";

describe("resolvePath", () => {
  const obj = {
    site: { name: "Test" },
    items: [{ label: "a" }, { label: "b" }],
  };

  it("resolves nested object paths", () => {
    expect(resolvePath(obj, "site.name")).toBe("Test");
  });

  it("resolves array indices", () => {
    expect(resolvePath(obj, "items.1.label")).toBe("b");
  });

  it("returns undefined for missing paths", () => {
    expect(resolvePath(obj, "site.missing.deep")).toBeUndefined();
    expect(resolvePath(obj, "items.x")).toBeUndefined();
  });

  it("refuses prototype-polluting segments", () => {
    expect(resolvePath(obj, "__proto__.polluted")).toBeUndefined();
    expect(resolvePath(obj, "constructor.prototype")).toBeUndefined();
  });
});

describe("setPath", () => {
  it("sets nested values", () => {
    const o = { a: { b: 1 }, list: [1, 2] };
    setPath(o, "a.b", 2);
    setPath(o, "list.1", 9);
    expect(o.a.b).toBe(2);
    expect(o.list[1]).toBe(9);
  });

  it("creates leaf keys on existing objects", () => {
    const o: Record<string, unknown> = { a: {} };
    setPath(o, "a.fresh", "x");
    expect((o.a as Record<string, unknown>).fresh).toBe("x");
  });

  it("throws on prototype-polluting segments", () => {
    const o = {};
    expect(() => setPath(o, "__proto__.polluted", 1)).toThrow(/Illegal/);
    expect(() => setPath(o, "constructor.prototype.polluted", 1)).toThrow(
      /Illegal/,
    );
    expect(
      ({} as Record<string, unknown>).polluted,
      "Object.prototype must stay clean",
    ).toBeUndefined();
  });

  it("throws when traversing through a scalar", () => {
    expect(() => setPath({ a: 1 }, "a.b.c", 2)).toThrow(/Cannot traverse/);
  });
});
