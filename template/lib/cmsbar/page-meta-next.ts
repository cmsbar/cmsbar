import type { Metadata } from "next";
import { resolvePageMeta } from "./page-meta-core";
import { getPageMeta } from "./page-meta";

/**
 * Build a Next.js Metadata object for a static page from CMS content. Falls
 * back to the provided defaults (the page's original hardcoded title/desc) so a
 * missing/empty entry never produces a blank <head>.
 *
 * Next-only: it maps the framework-neutral `resolvePageMeta` result onto Next's
 * Metadata shape. Other frameworks build their own head from resolvePageMeta
 * (React Router `meta`, TanStack `head()`), so this lives in a Next-only module
 * and is excluded when the core is copied into a non-Next host.
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
