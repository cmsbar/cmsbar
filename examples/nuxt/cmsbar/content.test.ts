// Unit tests for the CMSBar Vue editing store (review-mode behaviour).
//
// These exercise the pure store API without mounting a component or calling
// store.start(), so no watch() scheduling is involved - every mutating action
// updates state and persists synchronously, which keeps the tests deterministic.
// IndexedDB is absent under jsdom and uploadStorage guards on that, so its calls
// are harmless no-ops. We install a controllable localStorage mock to assert
// exactly what is (and isn't) written.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCmsStore, type CmsState } from "./content";

// A minimal, inspectable localStorage standing in for the real one.
function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn((k: string) => (map.has(k) ? map.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
    clear: vi.fn(() => map.clear()),
  };
}

let ls: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  ls = makeLocalStorage();
  vi.stubGlobal("localStorage", ls);
  // The store reads window.localStorage in its persistence helpers.
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ls,
  });
});

// Bundled content the store falls back to.
const bundled = {
  demo: { title: "Bundled title", intro: "Bundled intro" },
} as unknown as Parameters<typeof createCmsStore>[0];

const cmsWithDraft: CmsState = {
  authenticated: true,
  user: "alice",
  draft: { sessionId: "s1", branch: "cms/abc", title: "Draft" },
};

describe("get() resolution order", () => {
  it("falls back to bundled content when nothing overrides it", () => {
    const store = createCmsStore(bundled, { authenticated: false });
    expect(store.get("demo.title")).toBe("Bundled title");
  });

  it("override beats bundled", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Edited title");
    expect(store.get("demo.title")).toBe("Edited title");
    // Untouched path still resolves to bundled.
    expect(store.get("demo.intro")).toBe("Bundled intro");
  });

  it("previewContent beats override and bundled", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Edited title");
    // Simulate preview mode by seeding previewContent via a fresh store.
    const previewStore = createCmsStore(bundled, {
      authenticated: true,
      preview: { branch: "cms/xyz" },
      previewContent: {
        demo: { title: "Preview title", intro: "Preview intro" },
      } as unknown as CmsState["previewContent"],
    });
    expect(previewStore.get("demo.title")).toBe("Preview title");
    // And the edited store without preview still returns its override.
    expect(store.get("demo.title")).toBe("Edited title");
  });
});

describe("addEdit", () => {
  it("updates overrides, pending paths, and pendingCount", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    expect(store.pendingCount).toBe(0);
    expect(store.pendingEditPaths).toEqual([]);

    store.addEdit("demo.title", "Hello");

    expect(store.get("demo.title")).toBe("Hello");
    expect(store.pendingEditPaths).toEqual(["demo.title"]);
    expect(store.pendingEdits).toEqual([
      { path: "demo.title", value: "Hello" },
    ]);
    expect(store.pendingCount).toBe(1);
  });

  it("counts folders and deletes too", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Hello");
    store.addFolder("images/sub");
    store.addDelete("public/images/old.jpg");
    expect(store.pendingCount).toBe(3);
    expect(store.pendingFolders).toEqual(["images/sub"]);
    expect(store.pendingDeletes).toEqual(["public/images/old.jpg"]);
  });
});

describe("applyCommitted", () => {
  it("clears pending state but keeps overrides visible to get()", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Committed value");
    store.addFolder("images/sub");
    expect(store.pendingCount).toBe(2);

    store.applyCommitted();

    expect(store.pendingCount).toBe(0);
    expect(store.pendingEditPaths).toEqual([]);
    expect(store.pendingFolders).toEqual([]);
    // Override is retained so the editor still sees the just-saved value.
    expect(store.get("demo.title")).toBe("Committed value");
  });

  it("applies a draft patch when provided", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.applyCommitted({ prNumber: 42, prUrl: "https://example/pr/42" });
    expect(store.cms.draft?.prNumber).toBe(42);
    expect(store.cms.draft?.prUrl).toBe("https://example/pr/42");
    expect(store.cms.draft?.branch).toBe("cms/abc");
  });
});

describe("review-mode persistence", () => {
  it("keeps committed overrides in localStorage (committed view survives reload)", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Committed value");
    store.applyCommitted();

    const key = `demo_cms_pending_cms/abc`;
    const raw = ls.map.get(key);
    expect(
      raw,
      "review mode should still persist committed overrides",
    ).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      overrides: Record<string, unknown>;
      pendingEditPaths: string[];
    };
    expect(parsed.overrides["demo.title"]).toBe("Committed value");
    expect(parsed.pendingEditPaths).toEqual([]);
  });
});

describe("discardAll", () => {
  it("clears pending state and removes the persisted entry", () => {
    const store = createCmsStore(bundled, cmsWithDraft);
    store.addEdit("demo.title", "Throwaway");
    store.addFolder("images/sub");
    const key = `demo_cms_pending_cms/abc`;
    expect(ls.map.get(key)).toBeTruthy();

    store.discardAll();

    expect(store.pendingCount).toBe(0);
    expect(store.pendingEditPaths).toEqual([]);
    expect(store.pendingFolders).toEqual([]);
    // Pending override was dropped, so get() falls back to bundled.
    expect(store.get("demo.title")).toBe("Bundled title");
    // localStorage entry removed.
    expect(ls.map.get(key)).toBeUndefined();
    expect(ls.removeItem).toHaveBeenCalledWith(key);
  });
});
