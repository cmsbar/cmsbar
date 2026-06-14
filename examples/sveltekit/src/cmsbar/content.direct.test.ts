// Unit test for the DIRECT-mode persistence rule (the data-loss fix).
//
// In direct publishing the draft branch IS the base branch, so its
// localStorage key is shared by every future session on this device. After a
// commit the store must persist ONLY overrides that are still pending -
// committed values already live on the base branch, and keeping them here would
// shadow newer live content and silently re-publish stale values later.
//
// The store reads `publishingMode(cmsConfig) === "direct"` once at module load
// into a module-level constant, so we mock the config module to report direct
// mode BEFORE importing the store.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Force direct publishing for this file. The store reads
// `publishingMode(cmsConfig) === "direct"` once at module load. We replace the
// config module synchronously (no importOriginal, which can deadlock when the
// mocked graph is re-imported), supplying both the things this test's import
// chain needs: publishingMode (forced "direct") and defineCmsConfig (used by
// @/cms.config at its own import time).
vi.mock("@/lib/cmsbar/config", () => ({
  publishingMode: () => "direct" as const,
  defineCmsConfig: <T>(config: T): T => config,
}));

import { createCmsStore } from "./content.svelte";

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
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ls,
  });
});

const bundled = {
  demo: { title: "Bundled title", intro: "Bundled intro" },
} as unknown as Parameters<typeof createCmsStore>[0];

describe("DIRECT-mode persistence rule", () => {
  it("does NOT keep committed overrides in localStorage after applyCommitted", () => {
    const store = createCmsStore(bundled, {
      authenticated: true,
      // In direct mode the branch is the base branch.
      draft: { sessionId: "base", branch: "main", title: "Direct" },
    });

    store.addEdit("demo.title", "Committed value");
    const key = `demo_cms_pending_main`;
    // While pending, it IS persisted.
    const beforeRaw = ls.map.get(key);
    expect(beforeRaw).toBeTruthy();
    expect(JSON.parse(beforeRaw!).overrides["demo.title"]).toBe(
      "Committed value",
    );

    // Commit: pending cleared, override retained in memory...
    store.applyCommitted();
    expect(store.get("demo.title")).toBe("Committed value");

    // ...but the persisted entry must NOT carry the committed override (it is
    // no longer pending). With no other pending state the key is removed.
    const afterRaw = ls.map.get(key);
    if (afterRaw) {
      const parsed = JSON.parse(afterRaw) as {
        overrides: Record<string, unknown>;
      };
      expect(parsed.overrides["demo.title"]).toBeUndefined();
    } else {
      expect(afterRaw).toBeUndefined();
    }
  });

  it("still persists overrides that remain pending alongside committed ones", () => {
    const store = createCmsStore(bundled, {
      authenticated: true,
      draft: { sessionId: "base", branch: "main", title: "Direct" },
    });

    store.addEdit("demo.title", "Committed value");
    store.applyCommitted(); // demo.title now committed (not pending)
    store.addEdit("demo.intro", "Still pending"); // new pending edit

    const key = `demo_cms_pending_main`;
    const raw = ls.map.get(key);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      overrides: Record<string, unknown>;
      pendingEditPaths: string[];
    };
    // Only the still-pending override is persisted; the committed one is gone.
    expect(parsed.overrides["demo.intro"]).toBe("Still pending");
    expect(parsed.overrides["demo.title"]).toBeUndefined();
    expect(parsed.pendingEditPaths).toEqual(["demo.intro"]);
  });
});
