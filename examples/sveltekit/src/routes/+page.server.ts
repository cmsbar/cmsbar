// Server-side data load for the demo home page (READ-ONLY content).
//
// getContent() returns the typed content object bundled at build time
// (src/content/site-content.json via src/lib/content.ts). resolvePageMeta
// (the framework-neutral head-meta resolver from lib/cmsbar/page-meta-core)
// turns the page's CMS pageMeta entry plus hardcoded fallbacks into a plain
// metadata object we render into <svelte:head> in +page.svelte.
//
// This runs on the server only, so the content is baked into the SSR HTML -
// no client JS assembles it. (Editing UI is a later phase; S0 is read-only.)

import { getContent } from "@/lib/content";
import { resolvePageMeta, EMPTY_PAGE_META } from "@/lib/cmsbar/page-meta-core";
import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = () => {
  const content = getContent();

  const entry = content.pageMeta?.home ?? EMPTY_PAGE_META;
  const meta = resolvePageMeta(entry, {
    title: "CMSBar runs in this SvelteKit host",
    description: "A site server-rendered by SvelteKit with CMSBar mounted.",
  });

  return {
    meta,
    demo: content.demo,
    siteName: content.site?.name ?? "",
  };
};
