<script setup lang="ts">
// Editable image primitive, ported from
// template/components/cmsbar/EditableImage.tsx (mirroring the already-correct
// examples/sveltekit/src/cmsbar/EditableImage.svelte) to a Vue 3 SFC.
//
//   - View mode (anonymous or no draft): a plain <img>, resolved through the
//     raw-image proxy when a draft/preview branch is active so freshly-committed
//     files render straight from GitHub. For an authenticated editor it is
//     wrapped in a `display:contents` element carrying data-cms-path so
//     pin/inspect tooling can find it - exactly as the React/Svelte versions do.
//   - Empty + edit mode: a dashed placeholder with a "Pick image" button.
//   - Edit mode: the image plus a "Change image" button (opens MediaBrowser),
//     and - for images that crop to fit (fill / object-cover) - a "Reposition"
//     toggle that drags the focal point (object-position) via FocalPoint.
//
// The host-neutral <img> replaces the React useHost().Image seam: the Nuxt
// example ships no framework <Image>, so a plain <img> (which the React DomImage
// default also reduces to) is the faithful default.

import { computed, ref } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { isSharedPath } from "@/lib/cmsbar/shared-paths";
import { resolveImageSrc } from "@/cmsbar/mediaSrc";
import FocalPoint, { parsePos } from "@/cmsbar/FocalPoint.vue";
import MediaBrowser from "@/cmsbar/MediaBrowser.vue";

const props = withDefaults(
  defineProps<{
    path: string;
    fallback?: string;
    class?: string;
    alt?: string;
    /** Crop-to-fill (object-cover absolutely filling the positioned parent). */
    fill?: boolean;
    width?: number;
    height?: number;
    /** Content path holding an object-position string ("50% 30%"). When set and
     *  the image crops, editors can drag the focal point in edit mode. */
    positionPath?: string;
  }>(),
  { alt: "", fill: false },
);

const store = useCmsStore();

const rawSrc = computed(
  () => (store.get(props.path) as string | undefined) ?? props.fallback ?? "",
);
const editMode = computed(() => store.editMode);
const authenticated = computed(() => store.cms.authenticated);
const branch = computed(
  () => store.cms.preview?.branch ?? store.cms.draft?.branch,
);

// blob:/data: previews resolve as-is; everything else goes through the proxy
// when a branch is set. Mirrors EditableImage.tsx's src computation.
const src = computed(() =>
  rawSrc.value.startsWith("blob:") || rawSrc.value.startsWith("data:")
    ? rawSrc.value
    : resolveImageSrc(rawSrc.value, branch.value),
);

// Focal-point repositioning only matters for images that crop - those rendered
// object-cover (via `fill` or an explicit object-cover class). For those, derive
// a sibling content key ("<path>__pos") when none is passed.
const cropsToFit = computed(
  () => !!props.fill || /object-(cover|fill)/.test(props.class ?? ""),
);
const effectivePositionPath = computed(() =>
  cropsToFit.value ? (props.positionPath ?? `${props.path}__pos`) : props.positionPath,
);
const canReposition = computed(() => !!effectivePositionPath.value);
const shared = computed(() => isSharedPath(props.path));

const objectPosition = computed(() =>
  effectivePositionPath.value
    ? ((store.get(effectivePositionPath.value) as string | undefined) || undefined)
    : undefined,
);

// proxied src failing once falls back to the raw /images/... path - the dev
// server can serve it from public/ even if it isn't on the cms/* branch yet.
const proxied = computed(() => src.value !== rawSrc.value);
function onImgError(e: Event) {
  if (!proxied.value) return;
  const el = e.currentTarget as HTMLImageElement;
  if (el.dataset.fallback !== "1") {
    el.dataset.fallback = "1";
    el.src = rawSrc.value;
  }
}

const open = ref(false);
const repositioning = ref(false);

const imgStyle = computed<string | undefined>(() => {
  const parts: string[] = [];
  if (!props.fill) {
    if (props.width != null) parts.push(`width: ${props.width}px`);
    if (props.height != null) parts.push(`height: ${props.height}px`);
  }
  if (objectPosition.value) parts.push(`object-position: ${objectPosition.value}`);
  return parts.length ? parts.join("; ") : undefined;
});

function onPick(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  open.value = true;
}

function onToggleReposition(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  repositioning.value = !repositioning.value;
}

function onFocalSet(x: number, y: number) {
  if (effectivePositionPath.value) {
    store.addEdit(effectivePositionPath.value, `${x}% ${y}%`);
  }
}
</script>

<template>
  <!-- Empty: dashed placeholder + Pick button in edit mode; nothing in view. -->
  <template v-if="!src">
    <div v-if="editMode" class="cmsbar-img-wrap" :class="props.class">
      <div class="cmsbar-img-empty">No image - click to add</div>
      <button
        type="button"
        data-cms-ui
        class="cmsbar-img-btn cmsbar-img-btn-pick"
        @click="onPick"
      >
        Pick image
      </button>
      <MediaBrowser
        v-if="open"
        :content-path="path"
        current-src=""
        @close="open = false"
      />
    </div>
  </template>

  <!-- View / preview: a plain <img>; authenticated editors get a contents
       wrapper carrying data-cms-path so pin/inspect can find it. -->
  <template v-else-if="!editMode">
    <div
      v-if="authenticated"
      :data-cms-path="path"
      :data-cms-shared="shared ? 'true' : undefined"
      style="display: contents"
    >
      <img
        :src="src"
        :alt="alt"
        :class="[props.class, fill && 'cmsbar-img-fill']"
        :style="imgStyle"
        @error="onImgError"
      />
    </div>
    <img
      v-else
      :src="src"
      :alt="alt"
      :class="[props.class, fill && 'cmsbar-img-fill']"
      :style="imgStyle"
      @error="onImgError"
    />
  </template>

  <!-- Edit mode -->
  <div
    v-else
    :data-cms-path="path"
    :data-cms-shared="shared ? 'true' : undefined"
    class="cmsbar-img-wrap"
    :class="[shared && 'cmsbar-img-shared', props.class]"
  >
    <span v-if="shared" data-cms-ui class="cmsbar-img-shared-tag"
      >&#128279; shared</span
    >

    <img
      :src="src"
      :alt="alt"
      class="cmsbar-img"
      :class="fill && 'cmsbar-img-fill'"
      :style="imgStyle"
      @error="onImgError"
    />

    <FocalPoint
      v-if="repositioning && effectivePositionPath"
      :position="parsePos(objectPosition)"
      @set="onFocalSet"
    />

    <button
      v-if="canReposition"
      type="button"
      data-cms-ui
      class="cmsbar-img-btn cmsbar-img-btn-reposition"
      :class="{ active: repositioning }"
      @click="onToggleReposition"
    >
      {{ repositioning ? "Done" : "‹ Reposition" }}
    </button>

    <button
      type="button"
      data-cms-ui
      class="cmsbar-img-btn cmsbar-img-btn-change"
      @click="onPick"
    >
      Change image
    </button>

    <MediaBrowser
      v-if="open"
      :content-path="path"
      :current-src="rawSrc"
      @close="open = false"
    />
  </div>
</template>

<style>
.cmsbar-img-wrap {
  position: relative;
  display: inline-block;
  width: 100%;
  height: 100%;
}
.cmsbar-img-shared {
  border-radius: 0.5rem;
  box-shadow: 0 0 0 2px var(--cmsbar-shared);
}
.cmsbar-img-shared-tag {
  pointer-events: none;
  position: absolute;
  left: 0.375rem;
  top: 0.375rem;
  z-index: 97;
  border-radius: 0.25rem;
  background: var(--cmsbar-shared);
  padding: 0.125rem 0.375rem;
  font-size: 10px;
  font-weight: 700;
  color: #451a03;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.cmsbar-img-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  color: #94a3b8;
  font-size: 0.75rem;
  border: 2px dashed #cbd5e1;
  border-radius: 0.5rem;
}
.cmsbar-img {
  display: block;
}
.cmsbar-img-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cmsbar-img-btn {
  position: absolute;
  bottom: 0.5rem;
  z-index: 90;
  pointer-events: auto;
  border: 0;
  cursor: pointer;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  color: #fff;
  background: var(--cmsbar-accent);
}
.cmsbar-img-btn:hover {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-img-btn-change,
.cmsbar-img-btn-pick {
  right: 0.5rem;
}
.cmsbar-img-btn-reposition {
  left: 0.5rem;
  z-index: 96;
}
.cmsbar-img-btn-reposition.active {
  background: #fff;
  color: var(--cmsbar-accent);
}
.cmsbar-img-btn-reposition.active:hover {
  background: #f1f5f9;
}
</style>
