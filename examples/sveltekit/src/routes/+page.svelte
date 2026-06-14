<script lang="ts">
  // Read-only render of the CMS content model in Svelte. `data` comes from
  // +page.server.ts (getContent() on the server), so everything below is in the
  // server-rendered HTML - proving the framework-neutral content model renders
  // through a SvelteKit host. No editing UI yet (that is a later phase).
  import type { PageData } from "./$types";

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
  <h1 data-cms-path="demo.title">{data.demo?.title}</h1>
  <p data-cms-path="demo.intro">{data.demo?.intro}</p>
</main>
