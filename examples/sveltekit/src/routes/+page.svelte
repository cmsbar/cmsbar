<script lang="ts">
  // Renders the CMS content model in Svelte. The eyebrow + SEO head come from
  // +page.server.ts (getContent() on the server). The editable fields render
  // through <T>, which resolves each path from the CMSBar store: for anonymous
  // visitors that is the same bundled content, in the SSR HTML and inert; for a
  // logged-in editor with an active draft the same elements become editable in
  // place (contenteditable), and typing stages edits the bar can Save.
  import type { PageData } from "./$types";
  import T from "@/cmsbar/T.svelte";

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
</main>
