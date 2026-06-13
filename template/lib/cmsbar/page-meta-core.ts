// Framework-neutral page-meta resolver.
//
// This module knows nothing about Next.js (or any other framework): it takes a
// CMS pageMeta entry plus the page's hardcoded fallback title/description and
// computes a plain, framework-agnostic description of the resolved metadata.
// Framework adapters (e.g. lib/cmsbar/page-meta.ts for Next.js) map this neutral
// object onto whatever shape their framework expects.
//
// Keep this file free of any framework imports so it stays portable.

export type PageMetaEntry = {
  title: string;
  description: string;
  ogImage: string;
  ogTitle: string;
  ogDescription: string;
  canonical: string;
  noindex: boolean;
};

export const EMPTY_PAGE_META: PageMetaEntry = {
  title: "",
  description: "",
  ogImage: "",
  ogTitle: "",
  ogDescription: "",
  canonical: "",
  noindex: false,
};

/**
 * The framework-neutral result of resolving a page's metadata. Every field is a
 * plain value; `ogImage` / `canonical` are only present when set, and `robots`
 * is only present when the page opts out of indexing - mirroring exactly the
 * conditional shape the Next.js builder produces.
 */
export type ResolvedPageMeta = {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage?: string;
  canonical?: string;
  robots?: { index: false; follow: false };
};

/**
 * Resolve a page's metadata from a CMS entry and the page's hardcoded fallback.
 *
 * - title/description fall back to the provided defaults when the CMS entry is
 *   empty, so a missing entry never produces blank metadata.
 * - ogTitle/ogDescription fall back to the resolved title/description.
 * - ogImage and canonical are only included when non-empty.
 * - robots is only included (as index:false, follow:false) when noindex is set.
 */
export function resolvePageMeta(
  entry: PageMetaEntry,
  fallback: { title: string; description: string },
): ResolvedPageMeta {
  const title = entry.title || fallback.title;
  const description = entry.description || fallback.description;
  const ogTitle = entry.ogTitle || title;
  const ogDescription = entry.ogDescription || description;

  const resolved: ResolvedPageMeta = {
    title,
    description,
    ogTitle,
    ogDescription,
  };
  if (entry.ogImage) resolved.ogImage = entry.ogImage;
  if (entry.canonical) resolved.canonical = entry.canonical;
  if (entry.noindex) resolved.robots = { index: false, follow: false };
  return resolved;
}
