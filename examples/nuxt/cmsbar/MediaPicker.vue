<script setup lang="ts">
// The "Change media" modal for EditableMedia, ported from the MediaPicker
// sub-component of template/components/cmsbar/EditableMedia.tsx (mirroring the
// already-correct examples/sveltekit/src/cmsbar/MediaPicker.svelte) to a Vue 3
// SFC. Four tabs:
//   - Library: self-hosted videos from GET /media/list (one preview plays at a
//     time), pick one to commit its public path.
//   - Upload: choose an image or video; staged via store.addUpload into the
//     right folder (images/uploads or media/videos).
//   - Embed code / URL: paste a platform "Embed" snippet or a bare URL. We pull
//     the iframe src out of YouTube/Facebook/Vimeo/Maps, convert Instagram to
//     its framable form, keep script-based embeds as markup, and resolve Google
//     Maps short links server-side via POST /resolve-map.
//   - Clear: commit "" to remove the media.
// Nothing commits until the bar's Save; picks/uploads queue as pending store
// changes. Rendered through the same Vue <Teleport to="body"> as MediaBrowser.

import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import {
  isGoogleMapsUrl,
  normalizeEmbedUrl,
  looksLikeEmbedHtml,
  extractIframeSrc,
  extractInstagramPermalink,
  type MediaKind,
} from "@/cmsbar/mediaSrc";

type Tab = "library" | "upload" | "embed" | "clear";

const props = defineProps<{
  path: string;
  currentValue: string;
  currentKind: MediaKind;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "commit", value: string): void;
}>();

const store = useCmsStore();

// The picker is mounted fresh each time it opens (keyed by a v-if in the
// parent), so these only ever need the props' open-time values.
const isEmbed = props.currentKind === "embed" || props.currentKind === "html";
const tab = ref<Tab>(isEmbed ? "embed" : "library");
const embedInput = ref(isEmbed ? props.currentValue : "");
const error = ref<string | null>(null);
const resolving = ref(false);
const libItems = ref<{ path: string }[] | null>(null);
const libError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// One library preview plays at a time.
const libVideoEls = ref<Record<string, HTMLVideoElement | null>>({});
function setLibVideoEl(path: string, el: Element | null) {
  libVideoEls.value[path] = el as HTMLVideoElement | null;
}
function pauseOtherLibVideos(keep: string) {
  for (const [p, el] of Object.entries(libVideoEls.value)) {
    if (el && p !== keep) el.pause();
  }
}

// Load the video library when its tab is first opened. Watch immediately so the
// initial "library" tab triggers the fetch, mirroring the React/Svelte effect.
let loadCancelled = false;
watch(
  tab,
  (t) => {
    if (t !== "library" || libItems.value !== null) return;
    loadCancelled = false;
    void (async () => {
      try {
        const res = await cmsFetch("/media/list", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          files?: { path: string }[];
          error?: string;
        };
        if (!res.ok)
          throw new Error(data.error || `List failed (HTTP ${res.status})`);
        if (!loadCancelled) libItems.value = data.files ?? [];
      } catch (e) {
        if (!loadCancelled)
          libError.value =
            e instanceof Error ? e.message : "Could not load library";
      }
    })();
  },
  { immediate: true },
);

function onFile(file: File) {
  error.value = null;
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) {
    error.value = `Unsupported file type: ${file.type}`;
    return;
  }
  // Stage in a sensible folder for the type. The path addUpload computes becomes
  // the eventual /images/... or /media/... URL.
  const folder = isVideo ? "media/videos" : "images/uploads";
  store.addUpload(props.path, file, folder);
  emit("close");
}

function onFileChange(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  const f = input.files?.[0];
  if (f) onFile(f);
  input.value = "";
}

async function onEmbedSubmit() {
  error.value = null;
  const input = embedInput.value.trim();
  if (!input) return;

  // 1) Full embed code pasted from a platform's "Embed" share dialog.
  if (looksLikeEmbedHtml(input)) {
    const iframeSrc = extractIframeSrc(input);
    if (iframeSrc) {
      emit("commit", normalizeEmbedUrl(iframeSrc));
      return;
    }
    const igPermalink = extractInstagramPermalink(input);
    if (igPermalink) {
      emit("commit", normalizeEmbedUrl(igPermalink));
      return;
    }
    // Script-based embeds with no extractable URL (X/Twitter, TikTok, the
    // Facebook SDK widget) - keep the markup; it renders sandboxed.
    emit("commit", input);
    return;
  }

  // 2) Bare URL.
  if (!/^https?:\/\//i.test(input)) {
    error.value =
      "Paste a URL (https://…) or the full embed code from the platform.";
    return;
  }
  if (isGoogleMapsUrl(input)) {
    try {
      resolving.value = true;
      const r = await cmsFetch("/resolve-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        embed?: string;
        error?: string;
      };
      if (!r.ok) {
        error.value =
          data.error ?? `Could not resolve Google Maps URL (HTTP ${r.status})`;
        return;
      }
      emit("commit", String(data.embed));
      return;
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : "Could not resolve Google Maps URL";
      return;
    } finally {
      resolving.value = false;
    }
  }
  emit("commit", normalizeEmbedUrl(input));
}

const TABS: Tab[] = ["library", "upload", "embed", "clear"];
const TAB_LABEL: Record<Tab, string> = {
  library: "Library",
  upload: "Upload",
  embed: "Embed code / URL",
  clear: "Clear",
};

function onClose() {
  emit("close");
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

// Lock body scroll while the modal is open; restore on unmount (matches the
// React body-overflow effect / Svelte portal action).
let prevOverflow = "";
onMounted(() => {
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
});
onBeforeUnmount(() => {
  loadCancelled = true;
  document.body.style.overflow = prevOverflow;
});
</script>

<template>
  <Teleport to="body">
    <div class="cmsbar-mp-overlay" role="presentation" @click="onClose">
      <div
        class="cmsbar-mp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Change media"
        tabindex="-1"
        @click.stop
        @keydown="onKeydown"
      >
        <div class="cmsbar-mp-head">
          <h2>Change media</h2>
          <button
            type="button"
            class="cmsbar-mp-close"
            aria-label="Close"
            @click="onClose"
          >
            &#10005;
          </button>
        </div>

        <div class="cmsbar-mp-tabs">
          <button
            v-for="t in TABS"
            :key="t"
            type="button"
            class="cmsbar-mp-tab"
            :class="{ active: tab === t }"
            @click="tab = t"
          >
            {{ TAB_LABEL[t] }}
          </button>
        </div>

        <div v-if="error" class="cmsbar-mp-error">{{ error }}</div>

        <div v-if="tab === 'library'" class="cmsbar-mp-pane">
          <p v-if="libError" class="cmsbar-mp-err-text">{{ libError }}</p>
          <p v-else-if="libItems === null" class="cmsbar-mp-muted">
            Loading videos…
          </p>
          <p v-else-if="libItems.length === 0" class="cmsbar-mp-muted">
            No videos in <code>public/media</code> yet - add one in the Upload
            tab.
          </p>
          <div v-else class="cmsbar-mp-grid">
            <div
              v-for="it in libItems"
              :key="it.path"
              class="cmsbar-mp-card"
              :class="{ current: it.path === currentValue }"
            >
              <video
                :ref="(el) => setLibVideoEl(it.path, el as Element | null)"
                :src="`${it.path}#t=0.1`"
                controls
                playsinline
                preload="metadata"
                class="cmsbar-mp-video"
                @play="pauseOtherLibVideos(it.path)"
              >
                <track kind="captions" />
              </video>
              <p class="cmsbar-mp-vname" :title="it.path">
                {{ it.path.split("/").pop() }}
              </p>
              <button
                type="button"
                class="cmsbar-mp-use"
                :class="{ current: it.path === currentValue }"
                @click="emit('commit', it.path)"
              >
                {{ it.path === currentValue ? "✓ In use" : "Use this video" }}
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="tab === 'upload'" class="cmsbar-mp-pane cmsbar-mp-stack">
          <p class="cmsbar-mp-text">
            Pick a JPG/PNG/WebP/GIF/SVG image or an MP4/WebM video (≤ 50 MB).
          </p>
          <button
            type="button"
            class="cmsbar-mp-primary"
            @click="fileInput?.click()"
          >
            Choose file…
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*,video/*"
            class="cmsbar-mp-file"
            @change="onFileChange"
          />
          <p class="cmsbar-mp-muted">
            Image uploads land under <code>public/images/uploads/</code>; videos
            under <code>public/media/videos/</code>. The file is staged locally -
            click <strong>Save</strong> in the CMS bar to commit it to your
            draft.
          </p>
        </div>

        <div v-else-if="tab === 'embed'" class="cmsbar-mp-pane cmsbar-mp-stack">
          <label class="cmsbar-mp-label" for="cmsbar-mp-embed-input">
            Embed code or URL - YouTube, Instagram, Facebook, Google Maps, …
          </label>
          <textarea
            id="cmsbar-mp-embed-input"
            v-model="embedInput"
            rows="4"
            class="cmsbar-mp-textarea"
            placeholder='Paste the platform "Embed" code (e.g. <iframe …>) - or just a URL like https://www.youtube.com/watch?v=…'
          ></textarea>
          <p class="cmsbar-mp-muted">
            Paste the full <strong>embed code</strong> from the platform's share
            dialog, or just the page URL. We pull the iframe out of YouTube /
            Facebook / Vimeo / Maps embeds, convert Instagram posts to their
            framable form, and render script-based embeds (X, TikTok) in a
            sandboxed frame. Google Maps short links
            (<code>maps.app.goo.gl/…</code>) are resolved server-side.
          </p>
          <button
            type="button"
            class="cmsbar-mp-primary"
            :disabled="!embedInput.trim() || resolving"
            @click="onEmbedSubmit"
          >
            {{ resolving ? "Resolving…" : "Use this embed" }}
          </button>
        </div>

        <div v-else-if="tab === 'clear'" class="cmsbar-mp-pane cmsbar-mp-stack">
          <p class="cmsbar-mp-text">
            Remove the current media - the placeholder will show on the live site
            until you set something new.
          </p>
          <button type="button" class="cmsbar-mp-dark" @click="emit('commit', '')">
            Clear media
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmsbar-mp-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 1rem;
}
.cmsbar-mp-dialog {
  width: 100%;
  max-width: 42rem;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  color: #0f172a;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.cmsbar-mp-head {
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cmsbar-mp-head h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}
.cmsbar-mp-close {
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  color: #64748b;
}
.cmsbar-mp-close:hover {
  color: #0f172a;
}
.cmsbar-mp-tabs {
  border-bottom: 1px solid #e2e8f0;
  display: flex;
}
.cmsbar-mp-tab {
  flex: 1;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
  border-bottom: 2px solid transparent;
}
.cmsbar-mp-tab:hover {
  color: #0f172a;
}
.cmsbar-mp-tab.active {
  color: var(--cmsbar-accent);
  border-bottom-color: var(--cmsbar-accent);
}
.cmsbar-mp-error {
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  color: #b91c1c;
}
.cmsbar-mp-pane {
  padding: 1.25rem;
}
.cmsbar-mp-stack > * + * {
  margin-top: 0.75rem;
}
.cmsbar-mp-text {
  font-size: 0.875rem;
  color: #475569;
  margin: 0;
}
.cmsbar-mp-muted {
  font-size: 0.75rem;
  color: #64748b;
  margin: 0;
}
.cmsbar-mp-err-text {
  font-size: 0.875rem;
  color: #dc2626;
  margin: 0;
}
.cmsbar-mp-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #334155;
}
.cmsbar-mp-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  outline: none;
  resize: vertical;
}
.cmsbar-mp-textarea:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-mp-file {
  display: none;
}
.cmsbar-mp-primary {
  width: 100%;
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  background: var(--cmsbar-accent);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 0.75rem;
}
.cmsbar-mp-primary:hover:not(:disabled) {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-mp-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.cmsbar-mp-dark {
  width: 100%;
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  background: #0f172a;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 0.75rem;
}
.cmsbar-mp-dark:hover {
  background: #334155;
}
.cmsbar-mp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  max-height: 60vh;
  overflow-y: auto;
}
@media (min-width: 640px) {
  .cmsbar-mp-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.cmsbar-mp-card {
  border-radius: 0.5rem;
  border: 1px solid #e2e8f0;
  padding: 0.375rem;
}
.cmsbar-mp-card.current {
  border-color: var(--cmsbar-accent);
  background: var(--cmsbar-accent-soft);
}
.cmsbar-mp-video {
  aspect-ratio: 9 / 16;
  width: 100%;
  border-radius: 0.25rem;
  background: #000;
  object-fit: contain;
}
.cmsbar-mp-vname {
  margin: 0.25rem 0 0;
  font-size: 11px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-mp-use {
  margin-top: 0.25rem;
  width: 100%;
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--cmsbar-accent);
  color: #fff;
}
.cmsbar-mp-use:hover {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-mp-use.current {
  background: var(--cmsbar-accent-soft);
  color: var(--cmsbar-accent);
}
</style>
