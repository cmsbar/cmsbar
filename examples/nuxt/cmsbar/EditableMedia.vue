<script setup lang="ts">
// Editable media slot, ported from
// template/components/cmsbar/EditableMedia.tsx (mirroring the already-correct
// examples/sveltekit/src/cmsbar/EditableMedia.svelte) to a Vue 3 SFC. One slot
// renders an image, a self-hosted video, an iframe embed (YouTube/Instagram/
// Vimeo/Maps), or pasted embed markup in a sandboxed iframe - the kind is
// detected from the stored value. Editors get:
//   - a "Change media" button -> the MediaPicker modal (Library / Upload /
//     Embed code-or-URL / Clear tabs), and
//   - for image media, a "Reposition" focal-point toggle.
//
// The MediaPicker is the sibling MediaPicker.vue component, rendered through the
// same Vue <Teleport> as MediaBrowser. Branch-aware src resolution, embed
// normalization and kind detection come from the shared mediaSrc helpers.

import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { isSharedPath } from "@/lib/cmsbar/shared-paths";
import {
  detectKind,
  resolveMediaSrc,
  buildEmbedDocument,
  type MediaKind,
} from "@/cmsbar/mediaSrc";
import FocalPoint, { parsePos } from "@/cmsbar/FocalPoint.vue";
import MediaPicker from "@/cmsbar/MediaPicker.vue";

const props = withDefaults(
  defineProps<{
    path: string;
    class?: string;
    fallbackPlaceholder?: string;
    /** How a video fills its box. "cover" (default) crops; "contain" shows all. */
    videoMode?: "cover" | "contain";
    /** Autoplay a video muted+looping for background/hero use. */
    videoAutoplay?: boolean;
  }>(),
  {
    fallbackPlaceholder: "No media set",
    videoMode: "cover",
    videoAutoplay: false,
  },
);

const store = useCmsStore();

const raw = computed(() => (store.get(props.path) as string | undefined) ?? "");
const editMode = computed(() => store.editMode);
const branch = computed(
  () => store.cms.preview?.branch ?? store.cms.draft?.branch,
);
const authenticated = computed(() => store.cms.authenticated);

const src = computed(() =>
  raw.value.startsWith("blob:") || raw.value.startsWith("data:")
    ? raw.value
    : resolveMediaSrc(raw.value, branch.value),
);

// blob: preview URLs carry no extension, so a fresh upload would detect as
// "empty" and vanish until saved. Classify via the staged public path (the
// pending edit for this slot) instead; the blob stays the <img>/<video> src.
const stagedValue = computed(() =>
  raw.value.startsWith("blob:")
    ? (store.pendingEdits.find((e) => e.path === props.path)?.value as
        | string
        | undefined)
    : undefined,
);
const kind = computed<MediaKind>(() => detectKind(stagedValue.value ?? raw.value));

// Focal point for image media, stored at a sibling key ("<path>__pos").
const positionPath = computed(() => `${props.path}__pos`);
const objectPosition = computed(
  () => (store.get(positionPath.value) as string | undefined) || undefined,
);

const shared = computed(() => isSharedPath(props.path));
const embedDoc = computed(() =>
  kind.value === "html" ? buildEmbedDocument(raw.value) : "",
);

const pickerOpen = ref(false);
const repositioning = ref(false);

// ── Autoplay-video mute toggle (browser autoplay requires muted) ─────────────
const videoEl = ref<HTMLVideoElement | null>(null);
const muted = ref(true);
let attachedVideo: HTMLVideoElement | null = null;
const onVolumeChange = () => {
  if (attachedVideo) muted.value = attachedVideo.muted;
};
// Wire the volumechange listener (and force muted=true so autoplay is allowed)
// whenever the autoplay <video> element appears/changes. Mirrors the Svelte
// `use:onVideoMount` action / React mount effect.
watch(videoEl, (node, _old, onCleanup) => {
  if (attachedVideo) {
    attachedVideo.removeEventListener("volumechange", onVolumeChange);
    attachedVideo = null;
  }
  if (!node) return;
  node.muted = true;
  muted.value = true;
  node.addEventListener("volumechange", onVolumeChange);
  attachedVideo = node;
  onCleanup(() => {
    node.removeEventListener("volumechange", onVolumeChange);
    if (attachedVideo === node) attachedVideo = null;
  });
});
onBeforeUnmount(() => {
  if (attachedVideo)
    attachedVideo.removeEventListener("volumechange", onVolumeChange);
});

function toggleMute() {
  const v = videoEl.value;
  if (!v) return;
  v.muted = !v.muted; // volumechange listener syncs `muted`
  if (v.paused) void v.play().catch(() => {});
}

function onToggleReposition(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  repositioning.value = !repositioning.value;
}

function onOpenPicker(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  pickerOpen.value = true;
}

function onFocalSet(x: number, y: number) {
  store.addEdit(positionPath.value, `${x}% ${y}%`);
}

function onPickerCommit(value: string) {
  store.addEdit(props.path, value);
  pickerOpen.value = false;
}
</script>

<template>
  <div
    class="cmsbar-media"
    :class="props.class"
    :data-cms-path="authenticated ? path : undefined"
    :data-cms-shared="authenticated && shared ? 'true' : undefined"
  >
    <img
      v-if="kind === 'image'"
      :src="src"
      alt=""
      class="cmsbar-media-fill cmsbar-media-cover"
      :style="objectPosition ? `object-position: ${objectPosition}` : undefined"
    />
    <template v-else-if="kind === 'video'">
      <template v-if="videoAutoplay">
        <video
          ref="videoEl"
          :src="src"
          autoplay
          muted
          loop
          playsinline
          controls
          class="cmsbar-media-fill cmsbar-media-video"
          :class="videoMode === 'contain' ? 'cmsbar-media-contain' : 'cmsbar-media-cover'"
        >
          <track kind="captions" />
        </video>
        <button
          type="button"
          class="cmsbar-media-mute"
          :aria-label="muted ? 'Unmute' : 'Mute'"
          @click="toggleMute"
        >
          {{ muted ? "🔇" : "🔊" }}
        </button>
      </template>
      <video
        v-else
        :src="src"
        controls
        playsinline
        class="cmsbar-media-fill cmsbar-media-video"
        :class="videoMode === 'contain' ? 'cmsbar-media-contain' : 'cmsbar-media-cover'"
      >
        <track kind="captions" />
      </video>
    </template>
    <iframe
      v-else-if="kind === 'embed'"
      :src="src"
      class="cmsbar-media-fill"
      allowfullscreen
      title="Embedded media"
    ></iframe>
    <iframe
      v-else-if="kind === 'html'"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      :srcdoc="embedDoc"
      class="cmsbar-media-fill cmsbar-media-htmlframe"
      allowfullscreen
      title="Embedded media"
    ></iframe>
    <div v-else class="cmsbar-media-empty">{{ fallbackPlaceholder }}</div>

    <FocalPoint
      v-if="editMode && kind === 'image' && repositioning"
      :position="parsePos(objectPosition)"
      @set="onFocalSet"
    />

    <button
      v-if="editMode && kind === 'image'"
      type="button"
      data-cms-ui
      class="cmsbar-media-btn cmsbar-media-btn-reposition"
      :class="{ active: repositioning }"
      @click="onToggleReposition"
    >
      {{ repositioning ? "Done" : "‹ Reposition" }}
    </button>

    <button
      v-if="editMode"
      type="button"
      data-cms-ui
      class="cmsbar-media-btn cmsbar-media-btn-change"
      @click="onOpenPicker"
    >
      Change media
    </button>

    <MediaPicker
      v-if="pickerOpen"
      :path="path"
      :current-value="raw"
      :current-kind="kind"
      @close="pickerOpen = false"
      @commit="onPickerCommit"
    />
  </div>
</template>

<style>
.cmsbar-media {
  position: relative;
  width: 100%;
  height: 100%;
}
.cmsbar-media-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.cmsbar-media-cover {
  object-fit: cover;
}
.cmsbar-media-contain {
  object-fit: contain;
}
.cmsbar-media-video {
  background: #000;
}
.cmsbar-media-htmlframe {
  background: #fff;
}
.cmsbar-media-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  color: #94a3b8;
  font-weight: 500;
}
.cmsbar-media-mute {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 20;
  display: flex;
  height: 2.5rem;
  width: 2.5rem;
  align-items: center;
  justify-content: center;
  border: 0;
  cursor: pointer;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.cmsbar-media-mute:hover {
  background: rgba(0, 0, 0, 0.8);
}
.cmsbar-media-btn {
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
.cmsbar-media-btn:hover {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-media-btn-change {
  right: 0.5rem;
}
.cmsbar-media-btn-reposition {
  left: 0.5rem;
  z-index: 96;
}
.cmsbar-media-btn-reposition.active {
  background: #fff;
  color: var(--cmsbar-accent);
}
</style>
