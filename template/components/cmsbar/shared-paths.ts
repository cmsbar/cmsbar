// Content-path prefixes whose values render on multiple pages - header
// chrome, footer chrome, nav, global site metadata, contact details, etc.
// Editing one of these affects every page that uses it, so the primitives
// (T, RichText, EditableImage, …) draw the "shared" highlight color for these
// paths to warn the editor. Configure the list in cms.config.ts.

import { cmsConfig } from "@/cms.config";

const SHARED_PREFIXES = cmsConfig.sharedPrefixes;

export function isSharedPath(path: string): boolean {
  for (const p of SHARED_PREFIXES) {
    if (path === p.slice(0, -1) || path.startsWith(p)) return true;
  }
  return false;
}
