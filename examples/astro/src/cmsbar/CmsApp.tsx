// The editor-gated React island root.
//
// This is the whole point of the Astro example. The page's content region is
// authored ONCE, as a React component (DemoPage), using the framework-neutral
// CMS primitives (<T>, <EditableImage>). CmsApp wraps it in the host seam +
// ContentProvider + CmsBar, exactly like every other CMSBar host.
//
// The Astro page (src/pages/index.astro) decides, per request, whether to mount
// this with a client directive:
//
//   - PUBLIC visitor (no editor cookie): rendered with NO client directive.
//     Astro server-renders CmsApp to static HTML and ships ZERO JS for it.
//     CmsBar returns null when not authenticated, so the bar never appears, and
//     <T>/<EditableImage> render plain text + a plain <img>. Public = zero CMS JS.
//
//   - EDITOR (valid session cookie): rendered with client:load. Astro hydrates
//     this island, so the CMS primitives become interactive and CmsBar shows.
//     Editing works in place.
//
// Because the same component serves both cases, there is no double-authoring and
// no per-node islands. Props (content JSON + initialCms object) are plain
// serializable values, which is required to cross the Astro -> island boundary.
//
// The host uses DOM defaults (HostProvider with no value): window.location +
// popstate for the pathname, a plain <img>, and apiBase "/api/cms". That is all
// a single-page content region needs - the same zero-adapter case as the Vite
// SPA example.

import { HostProvider } from "@/components/cmsbar/host";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { CmsBar } from "@/components/cmsbar/CmsBar";
import { T } from "@/components/cmsbar/T";
import { EditableImage } from "@/components/cmsbar/EditableImage";
import type { SiteContent } from "@/lib/content";
import type { CmsState } from "./getServerSession";

function DemoPage() {
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

export function CmsApp({
  content,
  initialCms,
}: {
  content: SiteContent;
  initialCms: CmsState;
}) {
  return (
    <HostProvider>
      <ContentProvider content={content} initialCms={initialCms}>
        <DemoPage />
        <CmsBar />
      </ContentProvider>
    </HostProvider>
  );
}
