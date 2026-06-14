<script setup lang="ts">
// Renders a lucide IconNode as an inline SVG, matching lucide's own wrapper
// (24x24 viewBox, currentColor stroke, 2px round-joined strokes). This is the
// Vue analogue of `createElement(getIcon(name), { size })` in the React
// EditableInfoList / the Svelte Icon.svelte - same glyph, no lucide dependency.
//
// Each [tag, attrs] node becomes a child element via <component :is="tag">. The
// children are created in the SVG namespace because their parent in the rendered
// tree is the <svg> element (Vue inherits the namespace from the parent during
// patch), so `path`/`circle`/`rect`/... render correctly.
import type { IconNode } from "@/cmsbar/icons";

withDefaults(defineProps<{ node: IconNode; size?: number }>(), { size: 24 });
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <component
      :is="tag"
      v-for="[tag, attrs] in node"
      :key="tag + JSON.stringify(attrs)"
      v-bind="attrs"
    />
  </svg>
</template>
