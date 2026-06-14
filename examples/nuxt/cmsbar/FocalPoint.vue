<script lang="ts">
// Focal-point helpers + overlay, ported from
// template/components/cmsbar/FocalPoint.tsx (mirroring the already-correct
// examples/sveltekit/src/cmsbar/FocalPoint.svelte) to a Vue 3 SFC. The overlay
// is a click-to-set crosshair with a live-coords pill and per-axis locks; it is
// shared by EditableImage and EditableMedia (image kind). Renders absolutely
// inside a relatively-positioned wrapper, exactly like the React original.
//
// parsePos / clampPct are module-level helpers (the Svelte version exported them
// from a `<script module>` block; here they live in this plain module
// `<script>`, which Vue evaluates once per module, separate from the per-instance
// `<script setup>` below). EditableImage / EditableMedia import parsePos here.

/** Parse an object-position string ("50% 30%") into percentages; center default. */
export function parsePos(s: string | undefined): { x: number; y: number } {
  const m = (s ?? "").match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}

export const clampPct = (n: number): number =>
  Math.max(0, Math.min(100, Math.round(n)));
</script>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  position: { x: number; y: number };
}>();

const emit = defineEmits<{
  /** Emitted with the new x/y percentages when the editor clicks the image. */
  (e: "set", x: number, y: number): void;
}>();

// Locked axes keep their current value so the editor can slide along one
// direction only (e.g. lock Y to pan strictly left<->right). Local UI state.
const lockX = ref(false);
const lockY = ref(false);

function onOverlayClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = lockX.value
    ? props.position.x
    : clampPct(((e.clientX - r.left) / r.width) * 100);
  const y = lockY.value
    ? props.position.y
    : clampPct(((e.clientY - r.top) / r.height) * 100);
  emit("set", x, y);
}

function onStripClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}
</script>

<template>
  <!-- The overlay captures the click that sets the focal point. The control strip
       stops propagation so toggling a lock never also moves the point. -->
  <div
    data-cms-ui
    class="cmsbar-focal"
    role="presentation"
    @click="onOverlayClick"
  >
    <div class="cmsbar-focal-scrim"></div>
    <div
      class="cmsbar-focal-marker"
      :style="`left: ${position.x}%; top: ${position.y}%;`"
    ></div>

    <div
      data-cms-ui
      class="cmsbar-focal-strip"
      role="presentation"
      @click="onStripClick"
    >
      <span class="cmsbar-focal-coords">{{ position.x }}% {{ position.y }}%</span>
      <span class="cmsbar-focal-sep"></span>
      <button
        type="button"
        class="cmsbar-focal-lock"
        :class="{ active: lockX }"
        title="Lock the horizontal (X) position"
        @click.stop="lockX = !lockX"
      >
        &#8596; X
      </button>
      <button
        type="button"
        class="cmsbar-focal-lock"
        :class="{ active: lockY }"
        title="Lock the vertical (Y) position"
        @click.stop="lockY = !lockY"
      >
        &#8597; Y
      </button>
    </div>
  </div>
</template>

<style>
.cmsbar-focal {
  position: absolute;
  inset: 0;
  z-index: 95;
  cursor: crosshair;
  pointer-events: auto;
}
.cmsbar-focal-scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}
.cmsbar-focal-marker {
  position: absolute;
  height: 1.5rem;
  width: 1.5rem;
  transform: translate(-50%, -50%);
  border-radius: 9999px;
  border: 2px solid #fff;
  background: color-mix(in srgb, var(--cmsbar-accent) 70%, transparent);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
}
.cmsbar-focal-strip {
  position: absolute;
  left: 50%;
  top: 0.5rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.75);
  padding: 0.25rem 0.5rem;
  font-size: 11px;
  font-weight: 500;
  color: #fff;
}
.cmsbar-focal-coords {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.cmsbar-focal-sep {
  height: 0.75rem;
  width: 1px;
  background: rgba(255, 255, 255, 0.25);
}
.cmsbar-focal-lock {
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.125rem 0.375rem;
  color: inherit;
  background: transparent;
  font: inherit;
}
.cmsbar-focal-lock:hover {
  background: rgba(255, 255, 255, 0.15);
}
.cmsbar-focal-lock.active {
  background: var(--cmsbar-accent);
}
</style>
