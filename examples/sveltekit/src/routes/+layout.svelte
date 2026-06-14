<script lang="ts">
  // Root layout: build the CMSBar editing store, publish it on Svelte context
  // for descendant components to consume, and drive its browser-only lifecycle.
  //
  // - createCmsStore(content, initialCms) is pure: safe during SSR.
  // - setCmsContext(store) makes it reachable via getCmsContext() anywhere below.
  // - store.start() installs the window/localStorage/IndexedDB effects and the
  //   session-check poll; it is called only in onMount, so SSR never touches the
  //   DOM. onDestroy disposes the $effect.root scope start() created.
  //
  // No editing UI is rendered here - this is the foundation only (S1). The bar
  // and editable components arrive in later phases and just read the context.

  import { onMount, onDestroy, untrack } from "svelte";
  import { content } from "@/lib/content";
  import {
    createCmsStore,
    setCmsContext,
    type CmsState,
  } from "@/cmsbar/content.svelte";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: import("svelte").Snippet } =
    $props();

  // Seed the store once from the server-rendered session. The store owns CMS
  // state from here on, so we deliberately read only the initial `data` value
  // (untrack keeps the compiler from flagging it as a stale reactive read).
  const store = createCmsStore(
    content,
    untrack(() => data.initialCms) as CmsState,
  );
  setCmsContext(store);

  let dispose: (() => void) | undefined;
  onMount(() => {
    dispose = store.start();
  });
  onDestroy(() => dispose?.());
</script>

{@render children()}
