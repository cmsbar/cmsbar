<script lang="ts">
  // Renders the CMS content model in Svelte. The eyebrow + SEO head come from
  // +page.server.ts (getContent() on the server). The editable fields render
  // through <T>, which resolves each path from the CMSBar store: for anonymous
  // visitors that is the same bundled content, in the SSR HTML and inert; for a
  // logged-in editor with an active draft the same elements become editable in
  // place (contenteditable), and typing stages edits the bar can Save.
  import type { PageData } from "./$types";
  import T from "@/cmsbar/T.svelte";
  import EditableImage from "@/cmsbar/EditableImage.svelte";
  import EditableMedia from "@/cmsbar/EditableMedia.svelte";
  import RichText from "@/cmsbar/RichText.svelte";
  import EditableInfoList from "@/cmsbar/EditableInfoList.svelte";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.meta.title}</title>
  <meta name="description" content={data.meta.description} />
  <meta property="og:title" content={data.meta.ogTitle} />
  <meta property="og:description" content={data.meta.ogDescription} />
  {#if data.meta.ogImage}
    <meta property="og:image" content={data.meta.ogImage} />
  {/if}
  {#if data.meta.canonical}
    <link rel="canonical" href={data.meta.canonical} />
  {/if}
  {#if data.meta.robots}
    <meta name="robots" content="noindex, nofollow" />
  {/if}
</svelte:head>

<main>
  <p class="eyebrow">{data.siteName}</p>
  <T as="h1" path="demo.title" />
  <T as="p" path="demo.intro" />

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

  <!-- RichText: a block-level (div) editor. In view mode it renders saved HTML
       through .cmsbar-prose; in edit mode it becomes contenteditable with a
       floating selection toolbar (headings, lists, link, bold/italic/underline). -->
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
</main>

<style>
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
    margin: 0 0 1.25rem;
  }
</style>
