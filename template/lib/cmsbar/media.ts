// Media-folder allowlisting, derived from cmsConfig.mediaFolders. Shared by
// the commit route (uploads/deletes/folders), the media proxy, and the
// client-side upload pathing - so the rules can never drift apart.

import { cmsConfig } from "@/cms.config";
import { mediaRootDir } from "@/lib/cmsbar/config";

/**
 * The repo directory static assets are served from (in front of the public URL
 * path). Defaults to "public"; SvelteKit sets `mediaRoot: "static"`. This is
 * the single literal that used to be hardcoded as "public" across the media
 * code - now everything reads it from here so a non-Next host stays consistent.
 */
export const MEDIA_ROOT = mediaRootDir(cmsConfig);

/** e.g. ["public/images", "public/media"] - normalized, no trailing slash. */
export const MEDIA_FOLDERS = cmsConfig.mediaFolders.map((f) =>
  f.replace(/^\/+|\/+$/g, ""),
);

/** Folder roots relative to the media root, e.g. ["images", "media"]. */
export const MEDIA_ROOTS = MEDIA_FOLDERS.map((f) =>
  f.replace(new RegExp(`^${MEDIA_ROOT}/`), ""),
);

/** The default upload target (first configured folder), e.g. "images". */
export const DEFAULT_MEDIA_ROOT = MEDIA_ROOTS[0] ?? "images";

/** Is this repo path inside one of the allowed media folders? */
export function isAllowedRepoPath(repoPath: string): boolean {
  if (repoPath.includes("..")) return false;
  return MEDIA_FOLDERS.some((f) => repoPath.startsWith(f + "/"));
}

/** Is this a valid folder path (relative to public/) an editor may create? */
export function isAllowedFolder(folder: string): boolean {
  if (folder.includes("..")) return false;
  return MEDIA_ROOTS.some(
    (root) =>
      folder === root ||
      new RegExp(`^${root}(\\/[a-zA-Z0-9_\\-./]+)?$`).test(folder),
  );
}

/** Clamp a user-chosen folder onto an allowed root (defaults to the first). */
export function clampFolder(folder: string): string {
  const clean = folder.replace(/^\/+|\/+$/g, "");
  return MEDIA_ROOTS.some((r) => clean === r || clean.startsWith(r + "/"))
    ? clean
    : `${DEFAULT_MEDIA_ROOT}/${clean}`;
}

export function describeAllowedFolders(): string {
  return MEDIA_FOLDERS.map((f) => f + "/").join(" or ");
}
