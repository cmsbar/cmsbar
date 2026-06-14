// CMSBar editing-state container, ported from the React ContentProvider to a
// Vue 3 reactive store (Composition API). This is the editing FOUNDATION - it
// holds every bit of transient editing state (overrides, pending
// edits/uploads/folders/deletes, blob previews, the CmsState) and the
// resolution + persistence rules. No editing UI lives here; components consume
// this store via Vue's provide/inject.
//
// Behaviour is a faithful reproduction of the React provider (and the already-
// correct Svelte port):
//   - get(path): previewContent > blobOverrides > overrides > bundled content
//   - addEdit / addUpload / addFolder / addDelete / discardAll / applyCommitted
//   - setPreview / setDraft
//   - derived: pendingEditPaths, pendingEdits, pendingCount, editingEnabled
//   - localStorage persistence keyed by pendingLsKey(branch), with the
//     DIRECT-mode rule (persist ONLY still-pending overrides) preserved
//   - IndexedDB upload staging (reused as-is, neutral)
//   - 30s session-check poll, skipped in DIRECT mode / when no draft
//
// SSR-safety: nothing in createCmsStore() or the getters touches
// window/localStorage/IndexedDB. All browser-bound effects (the poll,
// restore-on-branch-change, persist) start only when the root layout/page calls
// store.start() inside onMounted; start() is a no-op when there is no window and
// returns a disposer the host calls in onBeforeUnmount/onUnmounted.
//
// The reactivity rules that the React dependency arrays gave for free, mirrored
// here with explicit watch() sources:
//   (a) the restore effect watches ONLY the draftBranch computed (a primitive),
//       NOT the whole cms object - so an unrelated cms update (poll, preview,
//       applyCommitted patch) does not wipe blob previews / pending uploads.
//   (b) draftApproved / approvedLabelName are SEPARATE refs written by the poll,
//       never via a wholesale cms reassignment - so the poll does not
//       self-retrigger off its own response.
//   (c) DIRECT mode persists only still-pending overrides.

import {
  computed,
  inject,
  provide,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import type { SiteContent } from "@/lib/content";
import { resolvePath } from "@/lib/content";
import { cmsConfig } from "@/cms.config";
import { publishingMode } from "@/lib/cmsbar/config";
import { pendingLsKey, PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";
import {
  clearBranch,
  deleteUpload,
  listUploads,
  putUpload,
} from "@/lib/cmsbar/uploadStorage";
import { clampFolder, MEDIA_ROOT } from "@/lib/cmsbar/media";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

// ── Public types (mirrors of the React provider's exports) ──────────────────

export type Draft = {
  sessionId: string;
  branch: string;
  title: string;
  prNumber?: number;
  prUrl?: string;
  pagePath?: string;
};

export type CmsState = {
  authenticated: boolean;
  user?: string;
  draft?: Draft;
  draftApproved?: boolean;
  approvedLabelName?: string;
  // Preview mode (read-only): when set, get(path) returns previewContent
  // and editing is disabled.
  preview?: { branch: string; title?: string; approved?: boolean };
  previewContent?: SiteContent;
};

export type PendingUpload = { repoPath: string; file: File };

// The reactive store surface consumers see (via useCmsStore()).
export type CmsStore = {
  /** The content shipped with the build (the "bundled" fallback for get()). */
  readonly bundled: SiteContent;

  // ── Reads (reactive getters) ──────────────────────────────────────────
  readonly cms: CmsState;
  readonly pendingUploads: PendingUpload[];
  readonly pendingFolders: string[];
  readonly pendingDeletes: string[];
  readonly pendingEditPaths: string[];
  readonly pendingEdits: { path: string; value: unknown }[];
  readonly pendingCount: number;
  readonly editingEnabled: boolean;
  /** Alias kept for parity with the React `editMode` field. */
  readonly editMode: boolean;

  /** Resolution: preview wins > blob preview > saved override > bundled. */
  get(path: string): unknown;

  // ── Actions ───────────────────────────────────────────────────────────
  addEdit(path: string, value: unknown): void;
  addUpload(contentPath: string, file: File, folder: string): void;
  addFolder(folder: string): void;
  addDelete(repoPath: string): void;
  discardAll(): void;
  applyCommitted(newDraftPatch?: Partial<Draft>): void;
  setPreview(
    state: { branch: string; title?: string; approved?: boolean } | null,
  ): Promise<void>;
  setDraft(draft: Draft | null): void;

  /**
   * Install the browser-only effects (poll, restore-on-branch-change, persist)
   * and restore preview state. No-op on the server. Returns a disposer the host
   * calls on unmount. Call from onMounted.
   */
  start(): () => void;
};

// ── Persistence shape (only serializable bits) ──────────────────────────────

type Persisted = {
  overrides: Record<string, unknown>;
  pendingEditPaths: string[];
  pendingFolders: string[];
  pendingDeletes: string[];
};

// Direct publishing: saves commit straight to the base branch - no PR exists,
// so there is no approval state to poll for and nothing that can lock editing.
const DIRECT = publishingMode(cmsConfig) === "direct";

function lsKey(branch?: string): string | null {
  if (!branch) return null;
  return pendingLsKey(branch);
}

function loadPersisted(branch?: string): Persisted | null {
  if (typeof window === "undefined") return null;
  const key = lsKey(branch);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      overrides: parsed.overrides ?? {},
      pendingEditPaths: Array.isArray(parsed.pendingEditPaths)
        ? parsed.pendingEditPaths
        : [],
      pendingFolders: Array.isArray(parsed.pendingFolders)
        ? parsed.pendingFolders
        : [],
      pendingDeletes: Array.isArray(parsed.pendingDeletes)
        ? parsed.pendingDeletes
        : [],
    };
  } catch {
    return null;
  }
}

function savePersisted(branch: string | undefined, data: Persisted): void {
  if (typeof window === "undefined") return;
  const key = lsKey(branch);
  if (!key) return;
  try {
    const empty =
      Object.keys(data.overrides).length === 0 &&
      data.pendingEditPaths.length === 0 &&
      data.pendingFolders.length === 0 &&
      data.pendingDeletes.length === 0;
    if (empty) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* quota etc. - fall back to memory-only */
  }
}

function slugFile(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "img"
  );
}

function extFor(file: File): string {
  const m = file.name.match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  switch (file.type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

// ── The store factory ────────────────────────────────────────────────────────

/**
 * Build the store. Pure - no DOM/window/localStorage/IndexedDB access until you
 * call store.start() (from onMounted). Safe to call during SSR.
 */
export function createCmsStore(
  content: SiteContent,
  initialCms: CmsState,
): CmsStore {
  // Reactive editing state. Records/arrays/Sets are reassigned (not mutated in
  // place) on every change so computeds that read them recompute deterministically
  // - this mirrors the immutable setState calls in the React original and keeps
  // the persistence watcher's tracking honest.
  const overrides = ref<Record<string, unknown>>({});
  const pendingEditPaths = ref<Set<string>>(new Set());
  const pendingUploads = ref<PendingUpload[]>([]);
  const pendingFolders = ref<string[]>([]);
  const pendingDeletes = ref<string[]>([]);
  const blobOverrides = ref<Record<string, string>>({});

  // Approval state lives in its OWN refs, NOT inside cms. The 30s poll's check()
  // writes ONLY these (no cms reassignment), so the poll and restore watchers -
  // which trigger off the draftBranch computed - never re-run on the poll's own
  // response. This mirrors the React original, whose poll is keyed to [cms.draft]:
  // there setCmsState preserves the cms.draft reference, so the approval write
  // never re-fires the effect.
  const draftApproved = ref<boolean | undefined>(undefined);
  const approvedLabelName = ref<string | undefined>(undefined);

  // Everything else from CmsState (authenticated, user, draft, preview,
  // previewContent). Reassigned wholesale on change, mirroring setCmsState.
  type CmsCore = Omit<CmsState, "draftApproved" | "approvedLabelName">;
  const {
    draftApproved: initApproved,
    approvedLabelName: initLabel,
    ...initRest
  } = initialCms;
  const cmsCore = ref<CmsCore>(initRest);
  draftApproved.value = initApproved;
  approvedLabelName.value = initLabel;

  // The active draft's branch, as a derived primitive. A computed recomputes on
  // every cmsCore reassignment but only *changes value* - and so only
  // re-triggers a dependent watcher - when the branch string actually differs.
  // The poll and restore watchers watch THIS (not cmsCore.value.draft directly),
  // matching React's [cms.draft] / [draftBranch] deps so they fire only on a
  // real branch change.
  const draftBranch: ComputedRef<string | undefined> = computed(
    () => cmsCore.value.draft?.branch,
  );

  // Live blob: URLs we created and must revoke (not reactive - bookkeeping).
  const blobRefs = new Set<string>();

  // ── Reads (computed) ─────────────────────────────────────────────────────

  // Re-expose the full CmsState shape (incl. the approval fields held in their
  // own refs) so consumers see the same object the React provider published.
  const cms = computed<CmsState>(() => ({
    ...cmsCore.value,
    draftApproved: draftApproved.value,
    approvedLabelName: approvedLabelName.value,
  }));

  const pendingEditPathsArr = computed(() =>
    Array.from(pendingEditPaths.value),
  );

  const pendingEdits = computed(() =>
    pendingEditPathsArr.value.map((p) => ({
      path: p,
      value: overrides.value[p],
    })),
  );

  const pendingCount = computed(
    () =>
      pendingEditPaths.value.size +
      pendingFolders.value.length +
      pendingDeletes.value.length,
  );

  const editingEnabled = computed(
    () =>
      !!cmsCore.value.draft &&
      !cmsCore.value.preview &&
      (DIRECT || !draftApproved.value),
  );

  // Resolution: preview wins > blob preview > saved override > bundled.
  function get(path: string): unknown {
    if (cmsCore.value.previewContent) {
      return resolvePath(cmsCore.value.previewContent, path);
    }
    if (blobOverrides.value[path] !== undefined) {
      return blobOverrides.value[path];
    }
    if (path in overrides.value) return overrides.value[path];
    return resolvePath(content, path);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  // Persist the serializable slices to localStorage. The DIRECT-mode rule
  // (persist ONLY still-pending overrides) lives here so it applies on every
  // path that touches persisted state - the mutating actions call this
  // synchronously, and the persist watcher re-runs it on reactive change.
  function persist(): void {
    // Read the derived branch (not cmsCore.value.draft?.branch): when persist()
    // runs inside the persist watcher, this keeps the watcher's only
    // cms-derived dependency the branch primitive, so an unrelated cms
    // reassignment does not re-run persist.
    const branch = draftBranch.value;
    // In direct mode the draft branch is always the base branch, so this
    // localStorage key is shared by every future session on this device.
    // Persist only overrides that are still pending: committed values already
    // live on the base branch, and keeping them here would shadow newer live
    // content - and silently re-publish stale values - in a later session.
    // In review mode each draft has its own cms/* key that dies with the draft,
    // so committed overrides are kept there to restore the saved view on reload.
    const persistOverrides = DIRECT
      ? Object.fromEntries(
          Object.entries(overrides.value).filter(([k]) =>
            pendingEditPaths.value.has(k),
          ),
        )
      : overrides.value;
    savePersisted(branch, {
      overrides: persistOverrides,
      pendingEditPaths: Array.from(pendingEditPaths.value),
      pendingFolders: pendingFolders.value,
      pendingDeletes: pendingDeletes.value,
    });
  }

  function dropBlobFor(path: string): void {
    const b = blobOverrides.value;
    if (!(path in b)) return;
    const old = b[path];
    if (old?.startsWith("blob:")) {
      URL.revokeObjectURL(old);
      blobRefs.delete(old);
    }
    const copy = { ...b };
    delete copy[path];
    blobOverrides.value = copy;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function addEdit(path: string, value: unknown): void {
    const prevValue = overrides.value[path];
    overrides.value = { ...overrides.value, [path]: value };
    const n = new Set(pendingEditPaths.value);
    n.add(path);
    pendingEditPaths.value = n;
    dropBlobFor(path);

    // If the user picks something different for a path that previously had a
    // pending upload, that upload is orphaned - remove it.
    const branch = cmsCore.value.draft?.branch;
    const orphans: string[] = [];
    const remaining = pendingUploads.value.filter((up) => {
      if (up.repoPath === MEDIA_ROOT + (value as string)) return true;
      // Different value than this upload's path → orphan.
      if (
        prevValue ===
        "/" + up.repoPath.replace(new RegExp(`^${MEDIA_ROOT}/`), "")
      ) {
        orphans.push(up.repoPath);
        return false;
      }
      return true;
    });
    if (branch) {
      for (const r of orphans) void deleteUpload(branch, r);
    }
    pendingUploads.value = remaining;
    persist();
  }

  function addUpload(contentPath: string, file: File, folder: string): void {
    const branch = cmsCore.value.draft?.branch;
    if (!branch) return;
    const safeFolder = clampFolder(folder);
    const name = `${slugFile(file.name)}-${Date.now()}.${extFor(file)}`;
    const repoPath = `${MEDIA_ROOT}/${safeFolder}/${name}`;
    const publicPath = `/${safeFolder}/${name}`;
    const blobUrl = URL.createObjectURL(file);
    blobRefs.add(blobUrl);

    pendingUploads.value = [...pendingUploads.value, { repoPath, file }];
    overrides.value = { ...overrides.value, [contentPath]: publicPath };
    const n = new Set(pendingEditPaths.value);
    n.add(contentPath);
    pendingEditPaths.value = n;

    const copy = { ...blobOverrides.value };
    if (copy[contentPath]?.startsWith("blob:")) {
      URL.revokeObjectURL(copy[contentPath]);
      blobRefs.delete(copy[contentPath]);
    }
    copy[contentPath] = blobUrl;
    blobOverrides.value = copy;

    void putUpload(branch, repoPath, file);
    persist();
  }

  function addFolder(folder: string): void {
    if (pendingFolders.value.includes(folder)) return;
    pendingFolders.value = [...pendingFolders.value, folder];
    persist();
  }

  function addDelete(repoPath: string): void {
    if (pendingDeletes.value.includes(repoPath)) return;
    pendingDeletes.value = [...pendingDeletes.value, repoPath];
    persist();
  }

  function discardAll(): void {
    for (const url of blobRefs) URL.revokeObjectURL(url);
    blobRefs.clear();

    // Drop only the overrides that are still pending; keep any committed ones.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(overrides.value)) {
      if (!pendingEditPaths.value.has(k)) out[k] = v;
    }
    overrides.value = out;

    pendingEditPaths.value = new Set();
    pendingUploads.value = [];
    pendingFolders.value = [];
    pendingDeletes.value = [];
    blobOverrides.value = {};

    const branch = cmsCore.value.draft?.branch;
    if (branch) {
      const k = lsKey(branch);
      if (k && typeof window !== "undefined") window.localStorage.removeItem(k);
      void clearBranch(branch);
    }
  }

  function applyCommitted(newDraftPatch?: Partial<Draft>): void {
    // overrides stay so the editor still sees their just-saved values.
    pendingEditPaths.value = new Set();
    pendingUploads.value = [];
    pendingFolders.value = [];
    pendingDeletes.value = [];
    // Drop blob previews: the files are committed now, so the override paths
    // resolve through the branch proxy. Keeping extension-less blob URLs here
    // would leave media slots unable to classify their content.
    for (const url of blobRefs) URL.revokeObjectURL(url);
    blobRefs.clear();
    blobOverrides.value = {};

    const branch = cmsCore.value.draft?.branch;
    if (branch) void clearBranch(branch);
    if (newDraftPatch && cmsCore.value.draft) {
      cmsCore.value = {
        ...cmsCore.value,
        draft: { ...cmsCore.value.draft, ...newDraftPatch },
      };
    }
    // Re-persist with cleared pending sets. In DIRECT mode this drops the now
    // non-pending (committed) overrides from localStorage - the data-loss fix:
    // committed values live on the base branch and must not linger here.
    persist();
  }

  async function setPreview(
    state: { branch: string; title?: string; approved?: boolean } | null,
  ): Promise<void> {
    if (!state) {
      try {
        if (typeof window !== "undefined")
          localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota / SSR */
      }
      cmsCore.value = {
        ...cmsCore.value,
        preview: undefined,
        previewContent: undefined,
      };
      return;
    }
    try {
      if (typeof window !== "undefined")
        localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
    cmsCore.value = {
      ...cmsCore.value,
      preview: state,
      previewContent: undefined,
    };
    try {
      const res = await cmsFetch(
        `/preview?branch=${encodeURIComponent(state.branch)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Preview failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { content: SiteContent | null };
      cmsCore.value = {
        ...cmsCore.value,
        previewContent: data.content ?? undefined,
      };
    } catch (err) {
      console.error("CMS preview failed:", err);
      try {
        if (typeof window !== "undefined")
          localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota */
      }
      cmsCore.value = {
        ...cmsCore.value,
        preview: undefined,
        previewContent: undefined,
      };
    }
  }

  function setDraft(draft: Draft | null): void {
    cmsCore.value = { ...cmsCore.value, draft: draft ?? undefined };
  }

  // ── Lifecycle: effects that touch the DOM/storage ──────────────────────────
  //
  // Called by the root layout/page inside onMounted. Returns a disposer the host
  // calls in onBeforeUnmount/onUnmounted. No-op on the server, so SSR never
  // touches window.

  function start(): () => void {
    if (typeof window === "undefined") return () => {};

    // Restore preview state once on mount. The preview content is always
    // fetched client-side anyway, so re-fetching here is correct.
    if (cmsCore.value.authenticated) {
      try {
        const raw = localStorage.getItem(PREVIEW_LS_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            branch?: string;
            title?: string;
            approved?: boolean;
          };
          if (saved?.branch) {
            void setPreview(
              saved as { branch: string; title?: string; approved?: boolean },
            );
          }
        }
      } catch {
        /* malformed entry - ignore */
      }
    }

    const stops: (() => void)[] = [];
    stops.push(installPollEffect());
    stops.push(installRestoreEffect());
    stops.push(installPersistEffect());
    return () => {
      for (const stop of stops) stop();
    };
  }

  // Poll the server for the freshest state of the active draft (whether the PR
  // was marked approved). Runs on mount, every 30s while visible, and on
  // refocus. Skipped entirely in direct mode - there is no PR to poll.
  function installPollEffect(): () => void {
    // immediate: true so this fires on mount (like React's effect-on-mount).
    return watch(
      // Watch the derived branch primitive (recomputes on every cmsCore reassign
      // but only changes when the branch string differs), so check()'s writes to
      // draftApproved / approvedLabelName never re-arm this watcher. This matches
      // React's [cms.draft] dep, which check() leaves untouched.
      draftBranch,
      (branch, _old, onCleanup) => {
        if (!branch || DIRECT) return;
        let cancelled = false;
        const POLL_MS = 30_000;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const check = async () => {
          try {
            const res = await cmsFetch("/session/check", { cache: "no-store" });
            if (!res.ok) return;
            const data = (await res.json()) as {
              draft?: { approved?: boolean; approvedLabel?: string } | null;
            };
            if (cancelled) return;
            // Write the approval fields directly - NOT via a cms reassignment -
            // so this response does not re-trigger the poll or restore watchers.
            draftApproved.value = !!data.draft?.approved;
            approvedLabelName.value = data.draft?.approvedLabel;
          } catch {
            /* swallow - non-fatal */
          }
        };

        const schedule = () => {
          if (cancelled) return;
          if (document.visibilityState === "hidden") return;
          timer = setTimeout(async () => {
            await check();
            schedule();
          }, POLL_MS);
        };

        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            void check();
            if (timer) clearTimeout(timer);
            schedule();
          } else if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        };

        void check();
        schedule();
        document.addEventListener("visibilitychange", onVisibilityChange);

        onCleanup(() => {
          cancelled = true;
          if (timer) clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisibilityChange);
        });
      },
      { immediate: true },
    );
  }

  // Restore on draft change.
  function installRestoreEffect(): () => void {
    return watch(
      // Watch ONLY the derived branch primitive, matching React's [draftBranch]
      // dep. Watching cmsCore (or cms) here would re-run on every cmsCore
      // reassignment (poll, setPreview, applyCommitted, setDraft) and wipe blob
      // previews + pending uploads. The computed only changes - and so only
      // re-fires this watcher - on a real branch transition.
      draftBranch,
      (branch) => {
        // Reset transient state.
        for (const url of blobRefs) URL.revokeObjectURL(url);
        blobRefs.clear();
        blobOverrides.value = {};
        pendingUploads.value = [];

        if (!branch) {
          overrides.value = {};
          pendingEditPaths.value = new Set();
          pendingFolders.value = [];
          pendingDeletes.value = [];
          return;
        }

        const persisted = loadPersisted(branch);
        if (persisted) {
          overrides.value = persisted.overrides;
          pendingEditPaths.value = new Set(persisted.pendingEditPaths);
          pendingFolders.value = persisted.pendingFolders;
          pendingDeletes.value = persisted.pendingDeletes;
        } else {
          overrides.value = {};
          pendingEditPaths.value = new Set();
          pendingFolders.value = [];
          pendingDeletes.value = [];
        }

        // Restore IndexedDB uploads (with fresh blob URLs).
        void (async () => {
          const stored = await listUploads(branch);
          if (stored.length === 0) return;
          const restored: PendingUpload[] = [];
          const blobMap: Record<string, string> = {};
          // We persisted only repoPath+file, not the contentPath. Recover by
          // scanning overrides: the override value matching the upload's public
          // path is the corresponding contentPath.
          const matchOverride = (publicPath: string): string | null => {
            for (const [k, v] of Object.entries(persisted?.overrides ?? {})) {
              if (typeof v === "string" && v === publicPath) return k;
            }
            return null;
          };
          for (const u of stored) {
            const publicPath = "/" + u.repoPath.replace(/^public\//, "");
            const blobUrl = URL.createObjectURL(u.file);
            blobRefs.add(blobUrl);
            const cp = matchOverride(publicPath);
            if (cp) blobMap[cp] = blobUrl;
            restored.push({ repoPath: u.repoPath, file: u.file });
          }
          pendingUploads.value = restored;
          blobOverrides.value = blobMap;
        })();
      },
      { immediate: true },
    );
  }

  // Persist serializable slices whenever they change reactively (e.g. after the
  // restore watcher repopulates them on a draft switch). The mutating actions
  // also call persist() synchronously, so this watcher mainly covers
  // non-action-driven changes; savePersisted is idempotent so a double-write is
  // harmless.
  function installPersistEffect(): () => void {
    return watch(
      // Explicit sources. Use the derived branch primitive (not
      // cmsCore.value.draft?.branch) so an unrelated cms reassignment - e.g. a
      // poll/preview update - does not pointlessly re-persist; persist still
      // re-runs on a real branch change and on any pending-state change.
      [
        draftBranch,
        overrides,
        pendingEditPaths,
        pendingFolders,
        pendingDeletes,
      ],
      () => {
        persist();
      },
    );
  }

  // The store surface. We wrap a plain object whose getters delegate to the
  // computeds in reactive() so consumers can read store.cms / store.pendingCount
  // reactively in templates and other computeds, exactly like the React context
  // value.
  const store: CmsStore = reactive({
    bundled: content,
    get cms() {
      return cms.value;
    },
    get pendingUploads() {
      return pendingUploads.value;
    },
    get pendingFolders() {
      return pendingFolders.value;
    },
    get pendingDeletes() {
      return pendingDeletes.value;
    },
    get pendingEditPaths() {
      return pendingEditPathsArr.value;
    },
    get pendingEdits() {
      return pendingEdits.value;
    },
    get pendingCount() {
      return pendingCount.value;
    },
    get editingEnabled() {
      return editingEnabled.value;
    },
    get editMode() {
      return editingEnabled.value;
    },
    get,
    addEdit,
    addUpload,
    addFolder,
    addDelete,
    discardAll,
    applyCommitted,
    setPreview,
    setDraft,
    start,
  }) as CmsStore;

  return store;
}

// ── Context wiring (provide/inject) ──────────────────────────────────────────

const CMS_STORE_KEY: InjectionKey<CmsStore> = Symbol("cmsbar:content");

/**
 * Publish the store on Vue's provide/inject. Call during component setup (e.g.
 * the root layout/app), so descendants can read it via useCmsStore().
 */
export function provideCmsStore(store: CmsStore): CmsStore {
  provide(CMS_STORE_KEY, store);
  return store;
}

/** Read the store from context. Throws if no provider mounted above. */
export function useCmsStore(): CmsStore {
  const store = inject(CMS_STORE_KEY);
  if (!store) {
    throw new Error(
      "useCmsStore() must be called under a component that called provideCmsStore()",
    );
  }
  return store;
}
