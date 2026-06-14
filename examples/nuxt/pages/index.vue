<script setup lang="ts">
// Demo home page. The eyebrow + SEO head come from getContent() (build-time
// bundled content). The editable fields render through <T>, which resolves each
// path from the CMSBar store: for anonymous visitors that is the same bundled
// content, in the SSR HTML and inert; for a logged-in editor with an active
// draft the same elements become editable in place (contenteditable), and
// typing stages edits the bar can Save.
//
// V2 wires text editing only: demo.title + demo.intro go through <T>. The
// rich-text body and the info list are still read-only here (their editable
// primitives - RichText, EditableInfoList - arrive in later Vue phases).
import { getContent } from "@/lib/content";
import { resolvePageMeta, EMPTY_PAGE_META } from "@/lib/cmsbar/page-meta-core";
import T from "@/cmsbar/T.vue";

const content = getContent();

const entry = content.pageMeta?.home ?? EMPTY_PAGE_META;
const meta = resolvePageMeta(entry, {
  title: "CMSBar runs in this Nuxt host",
  description: "A site server-rendered by Nuxt 3 with CMSBar mounted.",
});

const demo = content.demo;
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
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="body" data-cms-path="demo.body" v-html="demo?.body"></div>
    <ul class="info">
      <li v-for="item in demo?.info ?? []" :key="item.label">
        <strong>{{ item.label }}:</strong> {{ item.value }}
      </li>
    </ul>
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
.body h2 {
  font-size: 1.25rem;
  margin-top: 2rem;
}
.info {
  margin-top: 2rem;
  padding-left: 1rem;
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
