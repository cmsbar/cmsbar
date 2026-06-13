import type { Metadata } from "next";
import { cmsConfig } from "@/cms.config";
import { getContent } from "@/lib/content";
import {
  EMPTY_PAGE_META,
  resolvePageMeta,
  type PageMetaEntry,
} from "./page-meta-core";

// Re-export the neutral type so existing importers (`@/lib/cmsbar/page-meta`)
// keep working unchanged.
export type { PageMetaEntry } from "./page-meta-core";

// The static pages whose metadata is CMS-editable, straight from the config.
// The key is a slug used both as the content key (pageMeta.<key>) and matched
// against the pathname.
export const META_PAGES = cmsConfig.pages;

/** Map a pathname to its pageMeta key, or null if it isn't an editable page. */
export function metaKey(pathname: string): string | null {
  const hit = META_PAGES.find((p) => p.path === pathname);
  return hit ? hit.key : null;
}

export function metaPageLabel(pathname: string): string | null {
  return META_PAGES.find((p) => p.path === pathname)?.label ?? null;
}

/** Read a page's meta from content, merged over empty defaults. */
export function getPageMeta(key: string): PageMetaEntry {
  const pageMeta = (getContent() as { pageMeta?: Record<string, unknown> })
    .pageMeta;
  const fromContent = pageMeta?.[key] as Partial<PageMetaEntry> | undefined;
  return { ...EMPTY_PAGE_META, ...(fromContent ?? {}) };
}

/**
 * Build a Next.js Metadata object for a static page from CMS content. Falls
 * back to the provided defaults (the page's original hardcoded title/desc) so
 * a missing/empty entry never produces a blank <head>.
 *
 * The actual computation is delegated to the framework-neutral
 * `resolvePageMeta`; this function only maps its plain result onto Next's
 * Metadata shape.
 */
export function buildPageMetadata(
  key: string,
  fallback: { title: string; description: string },
): Metadata {
  const r = resolvePageMeta(getPageMeta(key), fallback);

  const meta: Metadata = {
    title: r.title,
    description: r.description,
    openGraph: {
      title: r.ogTitle,
      description: r.ogDescription,
      ...(r.ogImage ? { images: [{ url: r.ogImage }] } : {}),
    },
  };
  if (r.canonical) meta.alternates = { canonical: r.canonical };
  if (r.robots) meta.robots = r.robots;
  return meta;
}
