<script lang="ts">
  // Renders a lucide IconNode as an inline SVG, matching lucide's own wrapper
  // (24x24 viewBox, currentColor stroke, 2px round-joined strokes). This is the
  // Svelte analogue of `createElement(getIcon(name), { size })` in the React
  // EditableInfoList - same glyph, no lucide-react dependency.
  import type { IconNode } from "@/cmsbar/icons.svelte";

  type Props = { node: IconNode; size?: number };
  let { node, size = 24 }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each node as [tag, attrs] (tag + JSON.stringify(attrs))}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>
