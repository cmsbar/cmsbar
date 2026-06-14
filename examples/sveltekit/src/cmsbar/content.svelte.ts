// CMSBar editing-state container, ported from the React ContentProvider to a
// Svelte 5 runes store. This is the editing FOUNDATION - it holds every bit of
// transient editing state (overrides, pending edits/uploads/folders/deletes,
// blob previews, the CmsState) and the resolution + persistence rules. No
// editing UI lives here; components consume this store via Svelte context.
//
// Behaviour is a faithful reproduction of the React provider:
//   - get(path): previewContent > blobOverrides > overrides > bundled content
//   - addEdit / addUpload / addFolder / addDelete / discardAll / applyCommitted
//   - setPreview / setDraft
//   - derived: pendingEditPaths, pendingEdits, pendingCount, editingEnabled
//   - localStorage persistence keyed by pendingLsKey(branch), with the
//     DIRECT-mode rule (persist ONLY still-pending overrides) preserved
//   - IndexedDB upload staging (reused as-is, neutral)
//   - 30s session-check poll, skipped in DIRECT mode / when no draft
//
// SSR-safety: nothing in the constructor or getters touches window. All
// window/localStorage/IndexedDB-bound effects start only when the root layout
// calls store.start() inside onMount; start() is a no-op when there is no
// window, and it runs the effects inside an $effect.root scope so they work in
// this non-component module.

import { getContext, setContext } from "svelte";
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
import { clampFolder } from "@/lib/cmsbar/media";
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

// ── The store ───────────────────────────────────────────────────────────────

export class CmsStore {
  // The content shipped with the build (the "bundled" fallback for get()).
  readonly bundled: SiteContent;

  // Reactive editing state. Records/arrays are reassigned (not mutated in
  // place) on every change so getters that read them recompute deterministically
  // - this mirrors the immutable setState calls in the React original and keeps
  // the persistence effect's dependency tracking honest.
  #overrides = $state<Record<string, unknown>>({});
  #pendingEditPaths = $state<Set<string>>(new Set());
  #pendingUploads = $state<PendingUpload[]>([]);
  #pendingFolders = $state<string[]>([]);
  #pendingDeletes = $state<string[]>([]);
  #blobOverrides = $state<Record<string, string>>({});
  #cms = $state<CmsState>({ authenticated: false });

  // Live blob: URLs we created and must revoke (not reactive - bookkeeping).
  #blobRefs = new Set<string>();

  constructor(content: SiteContent, initialCms: CmsState) {
    this.bundled = content;
    this.#cms = initialCms;
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  get cms(): CmsState {
    return this.#cms;
  }

  get pendingUploads(): PendingUpload[] {
    return this.#pendingUploads;
  }

  get pendingFolders(): string[] {
    return this.#pendingFolders;
  }

  get pendingDeletes(): string[] {
    return this.#pendingDeletes;
  }

  get pendingEditPaths(): string[] {
    return Array.from(this.#pendingEditPaths);
  }

  get pendingEdits(): { path: string; value: unknown }[] {
    return this.pendingEditPaths.map((p) => ({
      path: p,
      value: this.#overrides[p],
    }));
  }

  get pendingCount(): number {
    return (
      this.#pendingEditPaths.size +
      this.#pendingFolders.length +
      this.#pendingDeletes.length
    );
  }

  get editingEnabled(): boolean {
    return (
      !!this.#cms.draft &&
      !this.#cms.preview &&
      (DIRECT || !this.#cms.draftApproved)
    );
  }

  /** Alias kept for parity with the React `editMode` field. */
  get editMode(): boolean {
    return this.editingEnabled;
  }

  // Resolution: preview wins > blob preview > saved override > bundled.
  get(path: string): unknown {
    if (this.#cms.previewContent) {
      return resolvePath(this.#cms.previewContent, path);
    }
    if (this.#blobOverrides[path] !== undefined) {
      return this.#blobOverrides[path];
    }
    if (path in this.#overrides) return this.#overrides[path];
    return resolvePath(this.bundled, path);
  }

  // ── Internal blob helper ────────────────────────────────────────────────

  // Persist the serializable slices to localStorage. The DIRECT-mode rule
  // (persist ONLY still-pending overrides) lives here so it applies on every
  // path that touches persisted state - the mutating actions call this
  // synchronously, and the restore/poll effect re-runs it on reactive change.
  #persist(): void {
    const draftBranch = this.#cms.draft?.branch;
    // In direct mode the draft branch is always the base branch, so this
    // localStorage key is shared by every future session on this device.
    // Persist only overrides that are still pending: committed values already
    // live on the base branch, and keeping them here would shadow newer live
    // content - and silently re-publish stale values - in a later session.
    // In review mode each draft has its own cms/* key that dies with the draft,
    // so committed overrides are kept there to restore the saved view on reload.
    const persistOverrides = DIRECT
      ? Object.fromEntries(
          Object.entries(this.#overrides).filter(([k]) =>
            this.#pendingEditPaths.has(k),
          ),
        )
      : this.#overrides;
    savePersisted(draftBranch, {
      overrides: persistOverrides,
      pendingEditPaths: Array.from(this.#pendingEditPaths),
      pendingFolders: this.#pendingFolders,
      pendingDeletes: this.#pendingDeletes,
    });
  }

  #dropBlobFor(path: string): void {
    const b = this.#blobOverrides;
    if (!(path in b)) return;
    const old = b[path];
    if (old?.startsWith("blob:")) {
      URL.revokeObjectURL(old);
      this.#blobRefs.delete(old);
    }
    const copy = { ...b };
    delete copy[path];
    this.#blobOverrides = copy;
  }

  // ── Actions ───────────────────────────────────────────────────────────

  addEdit(path: string, value: unknown): void {
    const prevValue = this.#overrides[path];
    this.#overrides = { ...this.#overrides, [path]: value };
    const n = new Set(this.#pendingEditPaths);
    n.add(path);
    this.#pendingEditPaths = n;
    this.#dropBlobFor(path);

    // If the user picks something different for a path that previously had a
    // pending upload, that upload is orphaned - remove it.
    const draftBranch = this.#cms.draft?.branch;
    const orphans: string[] = [];
    const remaining = this.#pendingUploads.filter((up) => {
      if (up.repoPath === "public" + (value as string)) return true;
      // Different value than this upload's path → orphan.
      if (prevValue === "/" + up.repoPath.replace(/^public\//, "")) {
        orphans.push(up.repoPath);
        return false;
      }
      return true;
    });
    if (draftBranch) {
      for (const r of orphans) void deleteUpload(draftBranch, r);
    }
    this.#pendingUploads = remaining;
    this.#persist();
  }

  addUpload(contentPath: string, file: File, folder: string): void {
    const draftBranch = this.#cms.draft?.branch;
    if (!draftBranch) return;
    const safeFolder = clampFolder(folder);
    const name = `${slugFile(file.name)}-${Date.now()}.${extFor(file)}`;
    const repoPath = `public/${safeFolder}/${name}`;
    const publicPath = `/${safeFolder}/${name}`;
    const blobUrl = URL.createObjectURL(file);
    this.#blobRefs.add(blobUrl);

    this.#pendingUploads = [...this.#pendingUploads, { repoPath, file }];
    this.#overrides = { ...this.#overrides, [contentPath]: publicPath };
    const n = new Set(this.#pendingEditPaths);
    n.add(contentPath);
    this.#pendingEditPaths = n;

    const copy = { ...this.#blobOverrides };
    if (copy[contentPath]?.startsWith("blob:")) {
      URL.revokeObjectURL(copy[contentPath]);
      this.#blobRefs.delete(copy[contentPath]);
    }
    copy[contentPath] = blobUrl;
    this.#blobOverrides = copy;

    void putUpload(draftBranch, repoPath, file);
    this.#persist();
  }

  addFolder(folder: string): void {
    if (this.#pendingFolders.includes(folder)) return;
    this.#pendingFolders = [...this.#pendingFolders, folder];
    this.#persist();
  }

  addDelete(repoPath: string): void {
    if (this.#pendingDeletes.includes(repoPath)) return;
    this.#pendingDeletes = [...this.#pendingDeletes, repoPath];
    this.#persist();
  }

  discardAll(): void {
    for (const url of this.#blobRefs) URL.revokeObjectURL(url);
    this.#blobRefs.clear();

    // Drop only the overrides that are still pending; keep any committed ones.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.#overrides)) {
      if (!this.#pendingEditPaths.has(k)) out[k] = v;
    }
    this.#overrides = out;

    this.#pendingEditPaths = new Set();
    this.#pendingUploads = [];
    this.#pendingFolders = [];
    this.#pendingDeletes = [];
    this.#blobOverrides = {};

    const draftBranch = this.#cms.draft?.branch;
    if (draftBranch) {
      const k = lsKey(draftBranch);
      if (k && typeof window !== "undefined") window.localStorage.removeItem(k);
      void clearBranch(draftBranch);
    }
  }

  applyCommitted(newDraftPatch?: Partial<Draft>): void {
    // overrides stay so the editor still sees their just-saved values.
    this.#pendingEditPaths = new Set();
    this.#pendingUploads = [];
    this.#pendingFolders = [];
    this.#pendingDeletes = [];
    // Drop blob previews: the files are committed now, so the override
    // paths resolve through the branch proxy. Keeping extension-less blob
    // URLs here would leave media slots unable to classify their content.
    for (const url of this.#blobRefs) URL.revokeObjectURL(url);
    this.#blobRefs.clear();
    this.#blobOverrides = {};

    const draftBranch = this.#cms.draft?.branch;
    if (draftBranch) void clearBranch(draftBranch);
    if (newDraftPatch && this.#cms.draft) {
      this.#cms = {
        ...this.#cms,
        draft: { ...this.#cms.draft, ...newDraftPatch },
      };
    }
    // Re-persist with cleared pending sets. In DIRECT mode this drops the now
    // non-pending (committed) overrides from localStorage - the data-loss fix:
    // committed values live on the base branch and must not linger here.
    this.#persist();
  }

  async setPreview(
    state: { branch: string; title?: string; approved?: boolean } | null,
  ): Promise<void> {
    if (!state) {
      try {
        if (typeof window !== "undefined")
          localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota / SSR */
      }
      this.#cms = { ...this.#cms, preview: undefined, previewContent: undefined };
      return;
    }
    try {
      if (typeof window !== "undefined")
        localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
    this.#cms = { ...this.#cms, preview: state, previewContent: undefined };
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
      this.#cms = { ...this.#cms, previewContent: data.content ?? undefined };
    } catch (err) {
      console.error("CMS preview failed:", err);
      try {
        if (typeof window !== "undefined")
          localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota */
      }
      this.#cms = {
        ...this.#cms,
        preview: undefined,
        previewContent: undefined,
      };
    }
  }

  setDraft(draft: Draft | null): void {
    this.#cms = { ...this.#cms, draft: draft ?? undefined };
  }

  // ── Lifecycle: effects that touch the DOM/storage ───────────────────────
  //
  // Called by the root layout inside onMount. Returns a disposer the layout
  // can call onDestroy. No-op on the server, so SSR never touches window.

  start(): () => void {
    if (typeof window === "undefined") return () => {};

    // Restore preview state once on mount. The preview content is always
    // fetched client-side anyway, so re-fetching here is correct.
    if (this.#cms.authenticated) {
      try {
        const raw = localStorage.getItem(PREVIEW_LS_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            branch?: string;
            title?: string;
            approved?: boolean;
          };
          if (saved?.branch) {
            void this.setPreview(
              saved as { branch: string; title?: string; approved?: boolean },
            );
          }
        }
      } catch {
        /* malformed entry - ignore */
      }
    }

    const dispose = $effect.root(() => {
      this.#installPollEffect();
      this.#installRestoreEffect();
      this.#installPersistEffect();
    });
    return dispose;
  }

  // Poll the server for the freshest state of the active draft (whether the PR
  // was marked approved). Runs on mount, every 30s while visible, and on
  // refocus. Skipped entirely in direct mode - there is no PR to poll.
  #installPollEffect(): void {
    $effect(() => {
      const draft = this.#cms.draft;
      if (!draft || DIRECT) return;
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
          this.#cms = {
            ...this.#cms,
            draftApproved: !!data.draft?.approved,
            approvedLabelName: data.draft?.approvedLabel,
          };
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

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    });
  }

  // Restore on draft change.
  #installRestoreEffect(): void {
    $effect(() => {
      const draftBranch = this.#cms.draft?.branch;

      // Reset transient state.
      for (const url of this.#blobRefs) URL.revokeObjectURL(url);
      this.#blobRefs.clear();
      this.#blobOverrides = {};
      this.#pendingUploads = [];

      if (!draftBranch) {
        this.#overrides = {};
        this.#pendingEditPaths = new Set();
        this.#pendingFolders = [];
        this.#pendingDeletes = [];
        return;
      }

      const persisted = loadPersisted(draftBranch);
      if (persisted) {
        this.#overrides = persisted.overrides;
        this.#pendingEditPaths = new Set(persisted.pendingEditPaths);
        this.#pendingFolders = persisted.pendingFolders;
        this.#pendingDeletes = persisted.pendingDeletes;
      } else {
        this.#overrides = {};
        this.#pendingEditPaths = new Set();
        this.#pendingFolders = [];
        this.#pendingDeletes = [];
      }

      // Restore IndexedDB uploads (with fresh blob URLs).
      void (async () => {
        const stored = await listUploads(draftBranch);
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
          this.#blobRefs.add(blobUrl);
          const cp = matchOverride(publicPath);
          if (cp) blobMap[cp] = blobUrl;
          restored.push({ repoPath: u.repoPath, file: u.file });
        }
        this.#pendingUploads = restored;
        this.#blobOverrides = blobMap;
      })();
    });
  }

  // Persist serializable slices whenever they change reactively (e.g. after
  // the restore effect repopulates them on a draft switch). The mutating
  // actions also call #persist() synchronously, so this effect mainly covers
  // non-action-driven changes; savePersisted is idempotent so a double-write is
  // harmless.
  #installPersistEffect(): void {
    $effect(() => {
      // Touch every reactive dependency so the effect re-runs on any change.
      void this.#cms.draft?.branch;
      void this.#overrides;
      void this.#pendingEditPaths;
      void this.#pendingFolders;
      void this.#pendingDeletes;
      this.#persist();
    });
  }
}

// ── Context wiring ──────────────────────────────────────────────────────────

const CMS_CONTEXT_KEY = Symbol("cmsbar:content");

/** Build the store. Pure - no DOM access until you call store.start(). */
export function createCmsStore(
  content: SiteContent,
  initialCms: CmsState,
): CmsStore {
  return new CmsStore(content, initialCms);
}

/** Put the store in Svelte context. Call during component init (e.g. layout). */
export function setCmsContext(store: CmsStore): CmsStore {
  return setContext(CMS_CONTEXT_KEY, store);
}

/** Read the store from context. Throws if no provider mounted above. */
export function getCmsContext(): CmsStore {
  const store = getContext<CmsStore | undefined>(CMS_CONTEXT_KEY);
  if (!store) {
    throw new Error(
      "getCmsContext() must be called under a component that called setCmsContext()",
    );
  }
  return store;
}
