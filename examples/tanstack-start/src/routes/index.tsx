// Demo home page. Renders editable content through the framework-neutral CMS
// primitives (<T> for text, <EditableImage> for the hero) - the exact same
// components the Next and React Router examples use, driven here by the
// TanStack Start host seam.
//
// The route `head` is built from the CMS-editable page metadata: resolvePageMeta
// (neutral) merges the "home" pageMeta entry over a hardcoded fallback, and we
// map that plain object onto TanStack Router head descriptors.

import { createFileRoute } from "@tanstack/react-router";
import { T } from "@/components/cmsbar/T";
import { EditableImage } from "@/components/cmsbar/EditableImage";
import { resolvePageMeta } from "@/lib/cmsbar/page-meta-core";
import { getPageMeta } from "@/lib/cmsbar/page-meta";

export const Route = createFileRoute("/")({
  head: () => {
    const resolved = resolvePageMeta(getPageMeta("home"), {
      title: "CMSBar runs in this TanStack Start host",
      description: "A site edited in place with CMSBar.",
    });

    const meta: Array<Record<string, string>> = [
      { title: resolved.title },
      { name: "description", content: resolved.description },
      { property: "og:title", content: resolved.ogTitle },
      { property: "og:description", content: resolved.ogDescription },
    ];
    if (resolved.ogImage) {
      meta.push({ property: "og:image", content: resolved.ogImage });
    }
    if (resolved.robots) {
      meta.push({ name: "robots", content: "noindex, nofollow" });
    }

    const links: Array<Record<string, string>> = [];
    if (resolved.canonical) {
      links.push({ rel: "canonical", href: resolved.canonical });
    }

    return { meta, links };
  },
  component: Home,
});

function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <T as="h1" path="demo.title" />
      <T as="p" path="demo.intro" />
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1200 / 630",
          marginTop: 24,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <EditableImage
          path="demo.image"
          alt="CMSBar demo"
          fill
          sizes="(max-width: 760px) 100vw, 760px"
        />
      </div>
    </main>
  );
}
