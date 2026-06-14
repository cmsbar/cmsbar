// Effect-lifecycle tests for the CMSBar editing store.
//
// content.test.ts / content.direct.test.ts exercise only the pure action API
// and never call store.start(), so the $effect-based restore-on-draft-change
// and 30s session poll are never installed. This file mounts those effects
// under $effect.root + flushSync and asserts the two reactivity rules the
// React provider gets for free from its dependency arrays:
//
//   (a) An unrelated poll-style update (draftApproved / approvedLabelName) must
//       NOT re-run the restore effect: it must preserve blobOverrides and
//       pendingUploads and must not re-read localStorage. In the buggy port the
//       restore effect read this.#cms.draft?.branch, so any #cms reassignment -
//       including the poll's own response - revoked blob URLs and dropped the
//       in-memory pending uploads (the IndexedDB re-restore is async and, under
//       jsdom with no indexedDB, never brings them back).
//
//   (b) The poll issues exactly ONE /session/check on mount and does not re-arm
//       off its own response. In the buggy port check() reassigned #cms, and the
//       poll effect (reading this.#cms.draft) re-ran on its own write - firing
//       check() again in a feedback loop.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { createCmsStore, type CmsState } from "./content.svelte";

// ── localStorage mock (inspectable getItem call count) ──────────────────────
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
let fetchMock: ReturnType<typeof vi.fn>;
let blobCounter: number;
let createdBlobs: string[];
let revokedBlobs: string[];

beforeEach(() => {
  ls = makeLocalStorage();
  vi.stubGlobal("localStorage", ls);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ls,
  });

  // jsdom implements neither URL.createObjectURL nor revokeObjectURL; the store
  // calls both (addUpload + the restore effect's reset). Stub them so we can
  // observe blob lifecycle without a real browser.
  blobCounter = 0;
  createdBlobs = [];
  revokedBlobs = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => {
      const u = `blob:test/${blobCounter++}`;
      createdBlobs.push(u);
      return u;
    }),
    revokeObjectURL: vi.fn((u: string) => void revokedBlobs.push(u)),
  });

  // Default poll response: a draft that is NOT yet approved. Each call resolves
  // a fresh Response so we can count invocations precisely.
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ draft: { approved: false } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  // The poll only schedules / checks while the document is visible.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const bundled = {
  demo: { title: "Bundled title", intro: "Bundled intro" },
} as unknown as Parameters<typeof createCmsStore>[0];

const cmsWithDraft: CmsState = {
  authenticated: true,
  user: "alice",
  draft: { sessionId: "s1", branch: "cms/abc", title: "Draft" },
};

// Drive the microtask queue so the poll's async check() (and any awaited fetch)
// settles, then flush Svelte's effect graph.
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe("restore effect: unrelated #cms updates are inert", () => {
  it("a poll-style approval update preserves pendingUploads/blobOverrides and does not re-read localStorage", async () => {
    // Fake timers from the start so the poll's own setTimeout handles are fake
    // and advanceTimersByTimeAsync can both fire them and flush the async
    // check() chained inside them.
    vi.useFakeTimers();
    const store = createCmsStore(bundled, cmsWithDraft);

    // Mount effects in a root scope (start() installs poll + restore + persist).
    let dispose: () => void = () => {};
    const root = $effect.root(() => {
      dispose = store.start();
    });
    flushSync();
    // Let the mount check() (approved:false) settle.
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    // Seed an in-memory pending upload + blob preview (as a real edit would).
    const file = new File(["x"], "pic.png", { type: "image/png" });
    store.addUpload("demo.img", file, "images");
    flushSync();
    expect(store.pendingUploads).toHaveLength(1);
    const blobBefore = store.get("demo.img");
    expect(typeof blobBefore).toBe("string");
    expect((blobBefore as string).startsWith("blob:")).toBe(true);

    // Snapshot localStorage read count and revoked blobs AFTER the upload, so we
    // measure only what an unrelated #cms update would additionally trigger.
    let getItemCallsBefore = ls.getItem.mock.calls.length;
    let revokedBefore = revokedBlobs.length;

    // ── Case 1: a wholesale #cms reassignment that leaves the branch unchanged.
    // setPreview(null) reassigns #cms ({...#cms, preview: undefined, ...}) with
    // the SAME draft.branch and runs no fetch. In the buggy port the restore
    // effect read this.#cms.draft?.branch, so it subscribed to the whole #cms
    // object and re-ran here - revoking the blob, clearing pendingUploads and
    // re-reading localStorage. With the $derived-branch fix the branch value is
    // unchanged, so the restore effect must NOT re-run.
    await store.setPreview(null);
    flushSync();
    expect(store.cms.preview).toBeUndefined(); // the reassignment happened
    expect(store.pendingUploads).toHaveLength(1);
    expect(store.get("demo.img")).toBe(blobBefore);
    expect(revokedBlobs.length).toBe(revokedBefore);
    expect(ls.getItem.mock.calls.length).toBe(getItemCallsBefore);

    // ── Case 2: the 30s poll's own response (writes draftApproved). This guards
    // the poll-fix + restore-fix interaction: the poll must not destroy the
    // upload/blob/localStorage state either. Switch the mock to report approved
    // so the field actually changes.
    getItemCallsBefore = ls.getItem.mock.calls.length;
    revokedBefore = revokedBlobs.length;
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ draft: { approved: true, approvedLabel: "ok" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    // Drive the poll across the 30s boundary; the async helper flushes the
    // microtasks of the check() chained inside the fired timer.
    await vi.advanceTimersByTimeAsync(30_000);
    flushSync();
    vi.useRealTimers();

    // The approval field flipped (proves the unrelated #cms-adjacent write
    // happened)...
    expect(store.cms.draftApproved).toBe(true);
    expect(store.cms.approvedLabelName).toBe("ok");

    // ...yet the restore effect did NOT re-run: pending upload + live blob
    // preview survive, the blob URL was not revoked, and localStorage was not
    // re-read.
    expect(store.pendingUploads).toHaveLength(1);
    expect(store.get("demo.img")).toBe(blobBefore);
    expect(revokedBlobs.length).toBe(revokedBefore);
    expect(ls.getItem.mock.calls.length).toBe(getItemCallsBefore);

    dispose();
    root();
  });
});

describe("poll effect: fires once on mount, no self-rearm", () => {
  it("issues exactly one /session/check on mount and does not loop on its own response", async () => {
    const store = createCmsStore(bundled, cmsWithDraft);

    let dispose: () => void = () => {};
    const root = $effect.root(() => {
      dispose = store.start();
    });
    flushSync();
    // Let the mount check() and any (buggy) self-re-arm fire.
    await settle();
    await settle();

    const checkCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/session/check"),
    );
    expect(checkCalls.length).toBe(1);

    dispose();
    root();
  });

  it("the next check only fires at the 30s boundary", async () => {
    vi.useFakeTimers();
    const store = createCmsStore(bundled, cmsWithDraft);

    let dispose: () => void = () => {};
    const root = $effect.root(() => {
      dispose = store.start();
    });
    flushSync();
    await Promise.resolve();
    await Promise.resolve();

    const countChecks = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/session/check"),
      ).length;

    expect(countChecks()).toBe(1); // mount

    // Just before the boundary: still only the mount check.
    vi.advanceTimersByTime(29_000);
    await Promise.resolve();
    expect(countChecks()).toBe(1);

    // Cross the 30s boundary: exactly one more.
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(countChecks()).toBe(2);

    dispose();
    root();
    vi.useRealTimers();
  });
});
