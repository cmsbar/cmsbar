// Maps a pathname to a human-readable page name used as the default draft
// title. Static pages come from cms.config.ts; anything else falls back to a
// humanized slug, so dynamic routes still get a sensible name.

import { cmsConfig } from "@/cms.config";

function humanize(slug: string): string {
  const first = slug.split("/")[0] ?? slug;
  return first.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function pageNameForPath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const hit = cmsConfig.pages.find((p) => p.path === clean);
  if (hit) return hit.label;
  if (clean === "/") return "Home";
  return humanize(clean.replace(/^\//, ""));
}
