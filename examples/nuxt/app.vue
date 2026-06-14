<script setup lang="ts">
// Root app shell: build the CMSBar editing store, publish it on Vue's
// provide/inject for descendant components (<T>, <CmsBar>) to consume, and drive
// its browser-only lifecycle. This is the Nuxt analogue of
// examples/sveltekit/src/routes/+layout.svelte.
//
// - getContent() is the build-time bundled content (the get() fallback).
// - useInitialCms() derives the SSR seed from the session cookie server-side
//   and transfers it to the client via the Nuxt payload, so the store hydrates
//   with the same CmsState the server rendered.
// - createCmsStore(content, initialCms) is pure: safe during SSR.
// - provideCmsStore(store) makes it reachable via useCmsStore() anywhere below.
// - store.start() installs the window/localStorage/IndexedDB effects and the
//   session-check poll; it runs only in onMounted, so SSR never touches the DOM.
//   onBeforeUnmount disposes the watchers start() created.
//
// <CmsBar/> is mounted after the page content (like the Svelte +layout), reads
// the store from context just like the editable primitives, and renders its own
// state machine (login / live / draft / preview). It is inert for anonymous
// visitors beyond the login affordance.

import { onMounted, onBeforeUnmount } from "vue";
import { getContent } from "@/lib/content";
import { createCmsStore, provideCmsStore } from "@/cmsbar/content";
import { useInitialCms } from "@/cmsbar/useInitialCms";
import CmsBar from "@/cmsbar/CmsBar.vue";

const store = createCmsStore(getContent(), useInitialCms());
provideCmsStore(store);

let dispose: (() => void) | undefined;
onMounted(() => {
  dispose = store.start();
});
onBeforeUnmount(() => dispose?.());
</script>

<template>
  <div>
    <NuxtPage />
    <CmsBar />
  </div>
</template>
