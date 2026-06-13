"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { useCms } from "./ContentProvider";
import { FocalPointOverlay, parsePos } from "./FocalPoint";
import { Portal } from "./Portal";
import { isSharedPath } from "./shared-paths";
import { cn } from "@/lib/cmsbar/utils";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

type Props = Omit<ImageProps, "src"> & {
  path: string;
  fallback?: string;
  /** Content path holding an object-position string ("50% 30%"). When set and
   *  the image is object-cover, editors can drag the focal point in edit mode. */
  positionPath?: string;
};

// If we're previewing another draft or editing our own, /images/... paths might
// not be on the local dev server's filesystem yet (file was committed to a
// cms/* branch but the build hasn't picked it up). Route those through the
// raw-image proxy so they render straight from GitHub.
function resolveSrcForBranch(src: string, branch: string | undefined): string {
  if (!src) return src;
  if (!branch) return src;
  if (
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("http")
  )
    return src;
  if (!src.startsWith("/images/")) return src;
  const repoPath = `public${src}`;
  return `/api/cms/images/raw?branch=${encodeURIComponent(
    branch,
  )}&path=${encodeURIComponent(repoPath)}`;
}

export function EditableImage({
  path,
  fallback,
  className,
  alt,
  positionPath,
  ...rest
}: Props) {
  const { get, editMode, cms, addEdit } = useCms();
  const rawSrc = (get(path) as string | undefined) ?? fallback ?? "";

  // Branch to resolve from: preview > active draft > none (use bundled path).
  const branch = cms.preview?.branch ?? cms.draft?.branch;
  const src =
    rawSrc.startsWith("blob:") || rawSrc.startsWith("data:")
      ? rawSrc
      : resolveSrcForBranch(rawSrc, branch);

  const [open, setOpen] = useState(false);
  const [repositioning, setRepositioning] = useState(false);

  // Focal-point repositioning only does anything for images that crop - i.e.
  // those rendered object-cover (via `fill` or an explicit object-cover class).
  // For those we enable it on EVERY image: when the caller doesn't pass an
  // explicit positionPath we derive a sibling content key ("<path>__pos").
  const sizing = rest as { fill?: boolean; width?: number; height?: number };
  const cropsToFit =
    !!sizing.fill || /object-(cover|fill)/.test(className ?? "");
  const effectivePositionPath = cropsToFit
    ? (positionPath ?? `${path}__pos`)
    : positionPath;
  const canReposition = !!effectivePositionPath;
  const shared = isSharedPath(path);

  const objectPosition = effectivePositionPath
    ? (get(effectivePositionPath) as string | undefined) || undefined
    : undefined;

  if (!src) {
    // In edit mode show a fill-the-slot placeholder so the editor can pick or
    // upload an image. In view mode render nothing.
    if (!editMode) return null;
    return (
      <div className={cn("relative inline-block w-full h-full", className)}>
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400 text-xs border-2 border-dashed border-slate-300 rounded-lg">
          No image - click to add
        </div>
        <button
          type="button"
          data-cms-ui
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className="absolute bottom-2 right-2 z-[90] pointer-events-auto rounded-full bg-[var(--cmsbar-accent)] text-white text-xs font-medium px-3 py-1.5 shadow-md hover:bg-[var(--cmsbar-accent-strong)]"
        >
          Pick image
        </button>
        {open && (
          <MediaBrowser
            contentPath={path}
            currentSrc=""
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    );
  }

  if (!editMode) {
    // Preview & vanilla view modes both render via a plain <img> when going through
    // the proxy - next/image can't fetch from our API route without remote pattern config.
    const goesThroughProxy = src !== rawSrc;
    const sizingRestRO = rest as {
      fill?: boolean;
      width?: number;
      height?: number;
    };
    const fillRO = !!sizingRestRO.fill;
    const imgEl = goesThroughProxy ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? ""}
        className={cn(
          className,
          fillRO && "absolute inset-0 w-full h-full object-cover",
        )}
        style={
          fillRO
            ? objectPosition
              ? { objectPosition }
              : undefined
            : {
                width: sizingRestRO.width,
                height: sizingRestRO.height,
                objectPosition,
              }
        }
        onError={(e) => {
          const el = e.currentTarget as HTMLImageElement;
          if (el.dataset.fallback !== "1") {
            el.dataset.fallback = "1";
            el.src = rawSrc;
          }
        }}
      />
    ) : (
      <Image
        src={src}
        alt={alt ?? ""}
        className={className}
        style={objectPosition ? { objectPosition } : undefined}
        {...rest}
      />
    );

    if (!cms.authenticated) return imgEl;

    // Wrap in a layout-transparent div so pin mode can find data-cms-path on authenticated views.
    return (
      <div
        data-cms-path={path}
        data-cms-shared={shared ? "true" : undefined}
        style={{ display: "contents" }}
      >
        {imgEl}
      </div>
    );
  }

  const sizingRest = rest as {
    fill?: boolean;
    width?: number;
    height?: number;
  };
  const fill = !!sizingRest.fill;
  // If the proxy fetch fails (e.g. file lives only on the local working branch
  // and not yet on the cms/* draft branch on GitHub), retry once with the raw
  // /images/... path - the Next dev server can serve it straight from /public.
  const proxied = src !== rawSrc;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      className={cn(className, fill && "absolute inset-0 w-full h-full")}
      style={
        fill
          ? objectPosition
            ? { objectPosition }
            : undefined
          : {
              width: sizingRest.width,
              height: sizingRest.height,
              objectPosition,
            }
      }
      onError={
        proxied
          ? (e) => {
              const el = e.currentTarget as HTMLImageElement;
              if (el.dataset.fallback !== "1") {
                el.dataset.fallback = "1";
                el.src = rawSrc;
              }
            }
          : undefined
      }
    />
  );

  const pos = parsePos(objectPosition);

  return (
    <div
      data-cms-path={path}
      data-cms-shared={shared ? "true" : undefined}
      className={cn(
        "relative inline-block w-full h-full",
        shared && "rounded-lg ring-2 ring-[var(--cmsbar-shared)]",
        className,
      )}
    >
      {shared && (
        <span
          data-cms-ui
          className="pointer-events-none absolute left-1.5 top-1.5 z-[97] rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950 shadow"
        >
          🔗 shared
        </span>
      )}
      {img}

      {/* Click overlay to set the focal point (object-position). */}
      {repositioning && effectivePositionPath && (
        <FocalPointOverlay
          position={pos}
          onSet={(x, y) => addEdit(effectivePositionPath, `${x}% ${y}%`)}
        />
      )}

      {canReposition && (
        <button
          type="button"
          data-cms-ui
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRepositioning((v) => !v);
          }}
          className={cn(
            "absolute bottom-2 left-2 z-[96] pointer-events-auto rounded-full text-xs font-medium px-3 py-1.5 shadow-md",
            repositioning
              ? "bg-white text-[var(--cmsbar-accent)] hover:bg-slate-100"
              : "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent-strong)]",
          )}
        >
          {repositioning ? "Done" : "⊹ Reposition"}
        </button>
      )}

      <button
        type="button"
        data-cms-ui
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="absolute bottom-2 right-2 z-[90] pointer-events-auto rounded-full bg-[var(--cmsbar-accent)] text-white text-xs font-medium px-3 py-1.5 shadow-md hover:bg-[var(--cmsbar-accent-strong)]"
      >
        Change image
      </button>
      {open && (
        <MediaBrowser
          contentPath={path}
          currentSrc={rawSrc}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

type ImgEntry = { path: string; repoPath: string; size?: number };

function MediaBrowser({
  contentPath,
  currentSrc,
  onClose,
}: {
  contentPath: string;
  currentSrc: string;
  onClose: () => void;
}) {
  const {
    addEdit,
    addUpload,
    addFolder,
    addDelete,
    pendingUploads,
    pendingFolders,
    pendingDeletes,
    cms,
  } = useCms();
  const branch = cms.preview?.branch ?? cms.draft?.branch;
  const [images, setImages] = useState<ImgEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Open the browser on the folder where the current image lives, so editors
  // see siblings first. Fall back to the root when there's no current image.
  const initialFolder = useMemo(() => {
    if (!currentSrc.startsWith("/images/")) return "images";
    const rel = currentSrc.replace(/^\/+/, "");
    const lastSlash = rel.lastIndexOf("/");
    return lastSlash > 0 ? rel.slice(0, lastSlash) : "images";
  }, [currentSrc]);
  const [selectedFolder, setSelectedFolder] = useState<string>(initialFolder);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const load = async () => {
    setError(null);
    try {
      const res = await cmsFetch("/images/list", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `List failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { images: ImgEntry[] };
      setImages(data.images);
    } catch (e) {
      setError(humanError(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  // Merge pending state into the displayed library:
  //   - Pending uploads appear as if they were already in their target folder
  //   - Pending deletes hide their target file
  //   - Pending folder creates appear in the folder tree
  const allEntries = useMemo<ImgEntry[]>(() => {
    const out = [...(images ?? [])];
    for (const up of pendingUploads) {
      out.push({
        path: "/" + up.repoPath.replace(/^public\//, ""),
        repoPath: up.repoPath,
      });
    }
    return out.filter((i) => !pendingDeletes.includes(i.repoPath));
  }, [images, pendingUploads, pendingDeletes]);

  const folders = useMemo(() => {
    const set = new Set<string>(["images"]);
    for (const img of allEntries) {
      const rel = img.repoPath.replace(/^public\//, "");
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join("/"));
      }
    }
    for (const f of pendingFolders) set.add(f.replace(/^\/+|\/+$/g, ""));
    return Array.from(set).sort();
  }, [allEntries, pendingFolders]);

  const visible = useMemo(
    () => allEntries.filter((i) => !i.path.endsWith("/.gitkeep")),
    [allEntries],
  );

  const filtered = useMemo(() => {
    const folderPrefix = "/" + selectedFolder.replace(/^\/+/, "") + "/";
    return visible.filter((i) => {
      if (!i.path.startsWith(folderPrefix)) return false;
      const rest = i.path.slice(folderPrefix.length);
      if (rest.includes("/")) return false;
      if (filter && !i.path.toLowerCase().includes(filter.toLowerCase()))
        return false;
      return true;
    });
  }, [visible, selectedFolder, filter]);

  const isPendingUpload = (repoPath: string) =>
    pendingUploads.some((u) => u.repoPath === repoPath);

  const onUpload = (file: File) => {
    setError(null);
    try {
      addUpload(contentPath, file, selectedFolder);
      onClose();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const onPickExisting = (img: ImgEntry) => {
    setError(null);
    addEdit(contentPath, img.path);
    onClose();
  };

  const onCreateFolder = () => {
    const name = window.prompt(
      "New folder name (letters, numbers, '-' or '_'). It will be created inside: " +
        selectedFolder,
    );
    if (!name) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError("Folder name must contain only letters, numbers, '-' or '_'");
      return;
    }
    const folder = `${selectedFolder.replace(/^\/+|\/+$/g, "")}/${name}`;
    addFolder(folder);
    setSelectedFolder(folder);
  };

  const onDelete = (img: ImgEntry) => {
    if (
      !confirm(
        `Mark ${img.path} for deletion?\nIt will be removed when you click Save.`,
      )
    )
      return;
    addDelete(img.repoPath);
    // optimistic: drop from local list too
    setImages(
      (prev) => prev?.filter((p) => p.repoPath !== img.repoPath) ?? null,
    );
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">
              Image library
            </h2>
            <input
              type="text"
              placeholder="Filter by name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-sm font-medium px-3 py-1.5"
            >
              Upload to this folder
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-sm text-red-700 flex items-start justify-between gap-3">
              <div className="flex-1">
                <strong className="block">Something went wrong</strong>
                <span className="break-all">{error}</span>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-500 hover:text-red-800"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 flex">
            <aside className="w-56 border-r bg-slate-50 overflow-y-auto p-2 text-sm">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  Folders
                </span>
                <button
                  type="button"
                  onClick={onCreateFolder}
                  className="text-xs text-[var(--cmsbar-accent)] hover:text-[var(--cmsbar-accent-strong)]"
                >
                  + New
                </button>
              </div>
              <ul>
                {folders.map((f) => {
                  const depth = f.split("/").length - 1;
                  const label = f === "images" ? "/" : f.split("/").pop();
                  const active = f === selectedFolder;
                  const isNew = pendingFolders.some(
                    (p) => p.replace(/^\/+|\/+$/g, "") === f,
                  );
                  return (
                    <li key={f}>
                      <button
                        type="button"
                        onClick={() => setSelectedFolder(f)}
                        style={{ paddingLeft: 8 + depth * 12 }}
                        className={cn(
                          "w-full text-left py-1 pr-2 rounded text-slate-700 hover:bg-white",
                          active &&
                            "bg-white font-medium text-[var(--cmsbar-accent)] ring-1 ring-[var(--cmsbar-accent-soft)]",
                        )}
                        title={f}
                      >
                        {label}
                        {isNew && (
                          <span className="ml-1 text-[9px] uppercase text-[var(--cmsbar-shared-strong)]">
                            new
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="flex-1 overflow-y-auto p-4">
              {!images && <p className="text-sm text-slate-500">Loading…</p>}
              {images && filtered.length === 0 && (
                <p className="text-sm text-slate-500">
                  No images in this folder. Use{" "}
                  <strong>Upload to this folder</strong> above.
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filtered.map((img) => {
                  const current = img.path === currentSrc;
                  const pending = isPendingUpload(img.repoPath);
                  return (
                    <div
                      key={img.repoPath}
                      className={cn(
                        "group relative rounded-lg border bg-slate-50 overflow-hidden",
                        current
                          ? "border-[var(--cmsbar-accent)] ring-2 ring-[var(--cmsbar-accent)]"
                          : "border-slate-200",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveSrcForBranch(img.path, branch)}
                        alt={img.path}
                        className="block w-full h-32 object-cover bg-white"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.opacity =
                            "0.4";
                        }}
                      />
                      {pending && (
                        <span className="absolute top-1 left-1 rounded bg-amber-500 text-white text-[10px] px-1.5 py-0.5">
                          Pending
                        </span>
                      )}
                      <div className="px-2 py-1.5">
                        <p
                          className="text-[10px] text-slate-500 truncate"
                          title={img.path}
                        >
                          {img.path.split("/").pop()}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onPickExisting(img)}
                            disabled={current}
                            className="flex-1 rounded bg-slate-900 hover:bg-slate-700 text-white text-xs px-2 py-1 disabled:opacity-50 disabled:cursor-default"
                          >
                            {current ? "Current" : "Use this"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(img)}
                            className="rounded bg-white border border-slate-300 hover:bg-red-50 hover:border-red-300 text-slate-600 hover:text-red-700 text-xs px-2 py-1"
                            title="Mark for deletion (committed on Save)"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="border-t px-5 py-3 text-xs text-slate-500">
            Nothing here commits to the repo by itself - uploads, picks, folder
            creates and deletes all queue as pending changes. Click{" "}
            <strong>Save changes</strong> in the CMS bar to commit them as one
            PR.
          </div>
        </div>
      </div>
    </Portal>
  );
}

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
