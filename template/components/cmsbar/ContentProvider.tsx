"use client";
import { pendingLsKey, PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SiteContent } from "@/lib/content";
import { resolvePath } from "@/lib/content";
import { cmsConfig } from "@/cms.config";
import { publishingMode } from "@/lib/cmsbar/config";
import {
  clearBranch,
  deleteUpload,
  listUploads,
  putUpload,
} from "@/lib/cmsbar/uploadStorage";
import { clampFolder } from "@/lib/cmsbar/media";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

// Persisted (localStorage) shape - only serializable bits.
type Persisted = {
  overrides: Record<string, unknown>;
  pendingEditPaths: string[];
  pendingFolders: string[];
  pendingDeletes: string[];
};

function lsKey(branch?: string): string | null {
  if (!branch) return null;
  return pendingLsKey(branch);
}

// Direct publishing: saves commit straight to the base branch - no PR exists,
// so there is no approval state to poll for and nothing that can lock editing.
const DIRECT = publishingMode(cmsConfig) === "direct";

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

export type Draft = {
  sessionId: string;
  branch: string;
  title: string;
  prNumber?: number;
  prUrl?: string;
  pagePath?: string;
};

type CmsState = {
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

type Ctx = {
  bundled: SiteContent; // the content shipped with the build
  cms: CmsState;
  editingEnabled: boolean; // false in preview mode

  get: (path: string) => unknown;

  pendingEditPaths: string[];
  pendingUploads: PendingUpload[];
  pendingFolders: string[];
  pendingDeletes: string[];
  pendingCount: number;
  pendingEdits: { path: string; value: unknown }[];

  addEdit: (path: string, value: unknown) => void;
  addUpload: (contentPath: string, file: File, folder: string) => void;
  addFolder: (folder: string) => void;
  addDelete: (repoPath: string) => void;
  discardAll: () => void;
  applyCommitted: (newDraftPatch?: Partial<Draft>) => void;

  editMode: boolean;
  setPreview: (
    state: { branch: string; title?: string; approved?: boolean } | null,
  ) => Promise<void>;
  setDraft: (draft: Draft | null) => void;
};

const ContentCtx = createContext<Ctx | null>(null);

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

export function ContentProvider({
  content,
  initialCms,
  children,
}: {
  content: SiteContent;
  initialCms: CmsState;
  children: React.ReactNode;
}) {
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [pendingEditPathsSet, setPendingEditPathsSet] = useState<Set<string>>(
    new Set(),
  );
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [blobOverrides, setBlobOverrides] = useState<Record<string, string>>(
    {},
  );
  const blobRefs = useRef<Set<string>>(new Set());

  const [cms, setCmsState] = useState<CmsState>(initialCms);

  const draftBranch = cms.draft?.branch;

  // Poll the server for the freshest state of the active draft (specifically
  // whether the PR has been marked approved by a reviewer). Runs on mount,
  // every 30s while the tab is visible, and immediately on tab refocus.
  // Skipped entirely in direct mode - there is no PR to poll.
  useEffect(() => {
    if (!cms.draft || DIRECT) return;
    let cancelled = false;
    const POLL_MS = 30_000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const res = await cmsFetch("/session/check", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          draft?: { approved?: boolean; approvedLabel?: string } | null;
        };
        if (cancelled) return;
        setCmsState((s) => ({
          ...s,
          draftApproved: !!data.draft?.approved,
          approvedLabelName: data.draft?.approvedLabel,
        }));
      } catch {
        /* swallow - non-fatal */
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return; // don't burn rate limit in the background
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
  }, [cms.draft]);

  // Restore on draft change.
  useEffect(() => {
    // Reset transient state.
    for (const url of blobRefs.current) URL.revokeObjectURL(url);
    blobRefs.current.clear();
    setBlobOverrides({});
    setPendingUploads([]);

    if (!draftBranch) {
      setOverrides({});
      setPendingEditPathsSet(new Set());
      setPendingFolders([]);
      setPendingDeletes([]);
      return;
    }
    const persisted = loadPersisted(draftBranch);
    if (persisted) {
      setOverrides(persisted.overrides);
      setPendingEditPathsSet(new Set(persisted.pendingEditPaths));
      setPendingFolders(persisted.pendingFolders);
      setPendingDeletes(persisted.pendingDeletes);
    } else {
      setOverrides({});
      setPendingEditPathsSet(new Set());
      setPendingFolders([]);
      setPendingDeletes([]);
    }
    // Restore IndexedDB uploads (with fresh blob URLs).
    void (async () => {
      const stored = await listUploads(draftBranch);
      if (stored.length === 0) return;
      const restored: PendingUpload[] = [];
      const blobMap: Record<string, string> = {};
      // We need to map each restored upload back to a contentPath. We persisted
      // only repoPath+file, not the contentPath. Recover by scanning overrides:
      // the override value matching `/${repoPath.replace(/^public\//, "")}` is
      // the corresponding contentPath.
      const matchOverride = (publicPath: string): string | null => {
        for (const [k, v] of Object.entries(persisted?.overrides ?? {})) {
          if (typeof v === "string" && v === publicPath) return k;
        }
        return null;
      };
      for (const u of stored) {
        const publicPath = "/" + u.repoPath.replace(/^public\//, "");
        const blobUrl = URL.createObjectURL(u.file);
        blobRefs.current.add(blobUrl);
        const cp = matchOverride(publicPath);
        if (cp) blobMap[cp] = blobUrl;
        restored.push({ repoPath: u.repoPath, file: u.file });
      }
      setPendingUploads(restored);
      setBlobOverrides(blobMap);
    })();
  }, [draftBranch]);

  // Persist serializable slices.
  useEffect(() => {
    // In direct mode the draft branch is always the base branch, so this
    // localStorage key is shared by every future session on this device.
    // Persist only overrides that are still pending: committed values already
    // live on the base branch, and keeping them here would shadow newer live
    // content - and silently re-publish stale values - in a later session.
    // In review mode each draft has its own cms/* key that dies with the draft,
    // so committed overrides are kept there to restore the saved view on reload.
    const persistOverrides = DIRECT
      ? Object.fromEntries(
          Object.entries(overrides).filter(([k]) => pendingEditPathsSet.has(k)),
        )
      : overrides;
    savePersisted(draftBranch, {
      overrides: persistOverrides,
      pendingEditPaths: Array.from(pendingEditPathsSet),
      pendingFolders,
      pendingDeletes,
    });
  }, [
    draftBranch,
    overrides,
    pendingEditPathsSet,
    pendingFolders,
    pendingDeletes,
  ]);

  // Resolution: preview wins > blob preview > saved override > bundled
  const get = useCallback(
    (path: string): unknown => {
      if (cms.previewContent) return resolvePath(cms.previewContent, path);
      if (blobOverrides[path] !== undefined) return blobOverrides[path];
      if (path in overrides) return overrides[path];
      return resolvePath(content, path);
    },
    [content, blobOverrides, overrides, cms.previewContent],
  );

  const dropBlobFor = useCallback((path: string) => {
    setBlobOverrides((b) => {
      if (!(path in b)) return b;
      const old = b[path];
      if (old?.startsWith("blob:")) {
        URL.revokeObjectURL(old);
        blobRefs.current.delete(old);
      }
      const copy = { ...b };
      delete copy[path];
      return copy;
    });
  }, []);

  const addEdit = useCallback(
    (path: string, value: unknown) => {
      setOverrides((p) => ({ ...p, [path]: value }));
      setPendingEditPathsSet((s) => {
        const n = new Set(s);
        n.add(path);
        return n;
      });
      dropBlobFor(path);
      // If the user picks something different for a path that previously had a
      // pending upload, that upload is orphaned - remove it.
      setPendingUploads((u) => {
        const orphans: string[] = [];
        const remaining = u.filter((up) => {
          if (up.repoPath === "public" + (value as string)) return true;
          // Different value than this upload's path → orphan.
          if (overrides[path] === "/" + up.repoPath.replace(/^public\//, "")) {
            orphans.push(up.repoPath);
            return false;
          }
          return true;
        });
        if (draftBranch) {
          for (const r of orphans) void deleteUpload(draftBranch, r);
        }
        return remaining;
      });
    },
    [dropBlobFor, overrides, draftBranch],
  );

  const addUpload = useCallback(
    (contentPath: string, file: File, folder: string) => {
      if (!draftBranch) return;
      const safeFolder = clampFolder(folder);
      const name = `${slugFile(file.name)}-${Date.now()}.${extFor(file)}`;
      const repoPath = `public/${safeFolder}/${name}`;
      const publicPath = `/${safeFolder}/${name}`;
      const blobUrl = URL.createObjectURL(file);
      blobRefs.current.add(blobUrl);
      setPendingUploads((u) => [...u, { repoPath, file }]);
      setOverrides((p) => ({ ...p, [contentPath]: publicPath }));
      setPendingEditPathsSet((s) => {
        const n = new Set(s);
        n.add(contentPath);
        return n;
      });
      setBlobOverrides((b) => {
        const copy = { ...b };
        if (copy[contentPath]?.startsWith("blob:")) {
          URL.revokeObjectURL(copy[contentPath]);
          blobRefs.current.delete(copy[contentPath]);
        }
        copy[contentPath] = blobUrl;
        return copy;
      });
      void putUpload(draftBranch, repoPath, file);
    },
    [draftBranch],
  );

  const addFolder = useCallback((folder: string) => {
    setPendingFolders((p) => (p.includes(folder) ? p : [...p, folder]));
  }, []);

  const addDelete = useCallback((repoPath: string) => {
    setPendingDeletes((p) => (p.includes(repoPath) ? p : [...p, repoPath]));
  }, []);

  const discardAll = useCallback(() => {
    for (const url of blobRefs.current) URL.revokeObjectURL(url);
    blobRefs.current.clear();
    setOverrides((p) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (!pendingEditPathsSet.has(k)) out[k] = v;
      }
      return out;
    });
    setPendingEditPathsSet(new Set());
    setPendingUploads([]);
    setPendingFolders([]);
    setPendingDeletes([]);
    setBlobOverrides({});
    if (draftBranch) {
      const k = lsKey(draftBranch);
      if (k && typeof window !== "undefined") window.localStorage.removeItem(k);
      void clearBranch(draftBranch);
    }
  }, [pendingEditPathsSet, draftBranch]);

  const applyCommitted = useCallback(
    (newDraftPatch?: Partial<Draft>) => {
      // overrides stay so the editor still sees their just-saved values.
      setPendingEditPathsSet(new Set());
      setPendingUploads([]);
      setPendingFolders([]);
      setPendingDeletes([]);
      // Drop blob previews: the files are committed now, so the override
      // paths resolve through the branch proxy. Keeping extension-less blob
      // URLs here would leave media slots unable to classify their content.
      for (const url of blobRefs.current) URL.revokeObjectURL(url);
      blobRefs.current.clear();
      setBlobOverrides({});
      if (draftBranch) void clearBranch(draftBranch);
      if (newDraftPatch) {
        setCmsState((s) =>
          s.draft ? { ...s, draft: { ...s.draft, ...newDraftPatch } } : s,
        );
      }
    },
    [draftBranch],
  );

  const setPreview: Ctx["setPreview"] = useCallback(async (state) => {
    if (!state) {
      try {
        localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota / SSR */
      }
      setCmsState((s) => ({
        ...s,
        preview: undefined,
        previewContent: undefined,
      }));
      return;
    }
    try {
      localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
    setCmsState((s) => ({ ...s, preview: state, previewContent: undefined }));
    try {
      const res = await cmsFetch(
        `/preview?branch=${encodeURIComponent(state.branch)}`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Preview failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { content: SiteContent | null };
      setCmsState((s) => ({
        ...s,
        previewContent: data.content ?? undefined,
      }));
    } catch (err) {
      console.error("CMS preview failed:", err);
      try {
        localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* quota */
      }
      setCmsState((s) => ({
        ...s,
        preview: undefined,
        previewContent: undefined,
      }));
    }
  }, []);

  // Restore preview state after a page refresh. The preview content is
  // always fetched client-side anyway, so re-fetching on mount is correct.
  useEffect(() => {
    if (!initialCms.authenticated) return;
    try {
      const raw = localStorage.getItem(PREVIEW_LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        branch?: string;
        title?: string;
        approved?: boolean;
      };
      if (!saved?.branch) return;
      void setPreview(
        saved as { branch: string; title?: string; approved?: boolean },
      );
    } catch {
      /* malformed entry - ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDraft: Ctx["setDraft"] = useCallback((draft) => {
    setCmsState((s) => ({ ...s, draft: draft ?? undefined }));
  }, []);

  const pendingEditPaths = useMemo(
    () => Array.from(pendingEditPathsSet),
    [pendingEditPathsSet],
  );

  const pendingEdits = useMemo(
    () => pendingEditPaths.map((p) => ({ path: p, value: overrides[p] })),
    [pendingEditPaths, overrides],
  );

  const pendingCount =
    pendingEditPaths.length + pendingFolders.length + pendingDeletes.length;

  const editingEnabled =
    !!cms.draft && !cms.preview && (DIRECT || !cms.draftApproved);

  // While editing, block all in-page navigation. Editors must save (or discard)
  // the draft before moving to another page - otherwise pending edits would be
  // lost. External `target="_blank"` links (e.g. the PR link) still work.
  useEffect(() => {
    if (!editingEnabled) return;
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Let in-place CMS controls (e.g. EditableImage's "Change image" /
      // "Reposition", which can live inside a navigating <a>) handle their own
      // clicks - they stopPropagation, so no navigation happens anyway.
      if (target.closest("[data-cms-ui]")) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.getAttribute("target") === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [editingEnabled]);

  const value = useMemo<Ctx>(
    () => ({
      bundled: content,
      cms,
      editingEnabled,
      get,
      pendingEditPaths,
      pendingUploads,
      pendingFolders,
      pendingDeletes,
      pendingCount,
      pendingEdits,
      addEdit,
      addUpload,
      addFolder,
      addDelete,
      discardAll,
      applyCommitted,
      editMode: editingEnabled,
      setPreview,
      setDraft,
    }),
    [
      content,
      cms,
      editingEnabled,
      get,
      pendingEditPaths,
      pendingUploads,
      pendingFolders,
      pendingDeletes,
      pendingCount,
      pendingEdits,
      addEdit,
      addUpload,
      addFolder,
      addDelete,
      discardAll,
      applyCommitted,
      setPreview,
      setDraft,
    ],
  );

  return <ContentCtx.Provider value={value}>{children}</ContentCtx.Provider>;
}

export function useCms(): Ctx {
  const v = useContext(ContentCtx);
  if (!v) throw new Error("useCms must be used inside <ContentProvider>");
  return v;
}
