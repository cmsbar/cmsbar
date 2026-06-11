// Derived, namespace-scoped identifiers. Single source of truth for every
// cookie / storage key CMSBar touches - never hardcode these elsewhere.

import { cmsConfig } from "@/cms.config";

/** Session cookie name, e.g. `mysite_cms`. */
export const SESSION_COOKIE = `${cmsConfig.namespace}_cms`;

/** localStorage key prefix for a draft's pending (unsaved) edits. */
export const PENDING_LS_PREFIX = `${cmsConfig.namespace}_cms_pending_`;

/** localStorage key remembering the active preview across reloads. */
export const PREVIEW_LS_KEY = `${cmsConfig.namespace}_cms_preview`;

/** IndexedDB database holding staged upload files. */
export const UPLOAD_DB_NAME = `${cmsConfig.namespace}_cms`;

/** Git branch prefix for draft branches. */
export const BRANCH_PREFIX = cmsConfig.branchPrefix;

/** Request header the middleware sets when serving the pre-launch teaser. */
export const TEASER_HEADER = `x-${cmsConfig.namespace}-teaser`;

export function pendingLsKey(branch: string): string {
  return `${PENDING_LS_PREFIX}${branch}`;
}

export function isDraftBranch(branch: string): boolean {
  return branch.startsWith(BRANCH_PREFIX);
}

export function draftBranch(sessionId: string): string {
  return `${BRANCH_PREFIX}${sessionId}`;
}
