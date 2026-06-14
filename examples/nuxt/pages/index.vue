<script setup lang="ts">
// Demo home page. The eyebrow + SEO head come from getContent() (build-time
// bundled content). The editable fields render through <T>, which resolves each
// path from the CMSBar store: for anonymous visitors that is the same bundled
// content, in the SSR HTML and inert; for a logged-in editor with an active
// draft the same elements become editable in place (contenteditable), and
// typing stages edits the bar can Save.
//
// V2 wired text editing (demo.title + demo.intro through <T>). V3 added the media
// primitives (<EditableImage>, <EditableMedia>). V4 adds the last two editable
// primitives: <RichText> (block-level contenteditable with a floating selection
// toolbar) for demo.body, and <EditableInfoList> (repeatable icon + label + value
// block with add/remove, drag-reorder, inline edit and an icon picker) for
// demo.info. Every field on this page is now editable in place.
import { getContent } from "@/lib/content";
import { resolvePageMeta, EMPTY_PAGE_META } from "@/lib/cmsbar/page-meta-core";
import T from "@/cmsbar/T.vue";
import EditableImage from "@/cmsbar/EditableImage.vue";
import EditableMedia from "@/cmsbar/EditableMedia.vue";
import RichText from "@/cmsbar/RichText.vue";
import EditableInfoList from "@/cmsbar/EditableInfoList.vue";

const content = getContent();

const entry = content.pageMeta?.home ?? EMPTY_PAGE_META;
const meta = resolvePageMeta(entry, {
  title: "CMSBar runs in this Nuxt host",
  description: "A site server-rendered by Nuxt 3 with CMSBar mounted.",
});

const siteName = content.site?.name ?? "";

useHead({
  title: meta.title,
  meta: [
    { name: "description", content: meta.description },
    { property: "og:title", content: meta.ogTitle },
    { property: "og:description", content: meta.ogDescription },
    ...(meta.ogImage ? [{ property: "og:image", content: meta.ogImage }] : []),
    ...(meta.robots ? [{ name: "robots", content: "noindex, nofollow" }] : []),
  ],
  ...(meta.canonical
    ? { link: [{ rel: "canonical", href: meta.canonical }] }
    : {}),
});
</script>

<template>
  <main class="page">
    <p class="site">{{ siteName }}</p>
    <T as="h1" path="demo.title" />
    <T as="p" class="intro" path="demo.intro" />

    <!-- EditableImage: object-cover fill, so editors can drag the focal point.
         The positioned wrapper gives the absolutely-filled <img> a box. -->
    <figure class="demo-image">
      <EditableImage path="demo.image" alt="CMSBar demo image" fill />
    </figure>

    <!-- EditableMedia: image / video / embed in one slot. The positioned wrapper
         gives the absolutely-filled media a 16:9 box. -->
    <div class="demo-media">
      <EditableMedia path="demo.media" />
    </div>

    <!-- RichText: a block-level (div) editor. View mode renders saved HTML via
         .cmsbar-prose; edit mode becomes contenteditable with the floating
         selection toolbar (headings, lists, link, bold/italic/underline). -->
    <section class="demo-body">
      <RichText as="div" path="demo.body" />
    </section>

    <!-- EditableInfoList: a repeatable icon + label + value block. Editors can
         add/remove items, drag to reorder, edit each field inline, and pick an
         icon from the curated set. -->
    <section class="demo-info">
      <h2 class="demo-info-title">Informacije</h2>
      <EditableInfoList path="demo.info" />
    </section>

    <p class="note">
      The CMSBar API is mounted at
      <code>/api/cms/*</code> -
      <a href="/api/cms/session">/api/cms/session</a> returns
      <code>{ "authenticated": false }</code>.
    </p>
  </main>
</template>

<style>
.page {
  max-width: 48rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  color: #18181b;
}
.site {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: #71717a;
  margin: 0 0 0.5rem;
}
h1 {
  font-size: 2rem;
  margin: 0 0 1rem;
}
.intro {
  color: #3f3f46;
}
.demo-image {
  position: relative;
  margin: 2rem 0 0;
  width: 100%;
  aspect-ratio: 1200 / 630;
  border-radius: 0.75rem;
  overflow: hidden;
}
.demo-media {
  position: relative;
  margin: 1.5rem 0 0;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 0.75rem;
  overflow: hidden;
  background: #0f172a;
}
.demo-body {
  margin: 2.5rem 0 0;
}
.demo-info {
  margin: 2.5rem 0 0;
}
.demo-info-title {
  font-size: 1.25rem;
  margin: 0 0 1.25rem;
}
.note {
  margin-top: 2.5rem;
  font-size: 0.875rem;
  color: #52525b;
  border-top: 1px solid #e4e4e7;
  padding-top: 1.5rem;
}
code {
  background: #f4f4f5;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.85em;
}
</style>
