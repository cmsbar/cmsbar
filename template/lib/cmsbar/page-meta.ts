import type { Metadata } from "next";
import { cmsConfig } from "@/cms.config";
import { getContent } from "@/lib/content";

export type PageMetaEntry = {
  title: string;
  description: string;
  ogImage: string;
  ogTitle: string;
  ogDescription: string;
  canonical: string;
  noindex: boolean;
};

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

const EMPTY: PageMetaEntry = {
  title: "",
  description: "",
  ogImage: "",
  ogTitle: "",
  ogDescription: "",
  canonical: "",
  noindex: false,
};

/** Read a page's meta from content, merged over empty defaults. */
export function getPageMeta(key: string): PageMetaEntry {
  const pageMeta = (getContent() as { pageMeta?: Record<string, unknown> })
    .pageMeta;
  const fromContent = pageMeta?.[key] as Partial<PageMetaEntry> | undefined;
  return { ...EMPTY, ...(fromContent ?? {}) };
}

/**
 * Build a Next.js Metadata object for a static page from CMS content. Falls
 * back to the provided defaults (the page's original hardcoded title/desc) so
 * a missing/empty entry never produces a blank <head>.
 */
export function buildPageMetadata(
  key: string,
  fallback: { title: string; description: string },
): Metadata {
  const m = getPageMeta(key);
  const title = m.title || fallback.title;
  const description = m.description || fallback.description;
  const ogTitle = m.ogTitle || title;
  const ogDescription = m.ogDescription || description;

  const meta: Metadata = {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      ...(m.ogImage ? { images: [{ url: m.ogImage }] } : {}),
    },
  };
  if (m.canonical) meta.alternates = { canonical: m.canonical };
  if (m.noindex) meta.robots = { index: false, follow: false };
  return meta;
}
