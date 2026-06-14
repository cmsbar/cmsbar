<script setup lang="ts">
// The image-library modal, ported from the MediaBrowser sub-component of
// template/components/cmsbar/EditableImage.tsx (mirroring the already-correct
// examples/sveltekit/src/cmsbar/MediaBrowser.svelte) to a Vue 3 SFC. It lists
// the image library (GET /images/list from the active branch), merges pending
// uploads/deletes/folder-creates from the store, supports per-folder browsing,
// upload to the selected folder, picking an existing image, creating a folder,
// and marking an image for deletion - all queued as pending store changes that
// commit together on the bar's Save.
//
// Rendered through a Vue <Teleport to="body"> inside a fixed full-screen
// overlay (the React Portal / Svelte `portal` action equivalent) so the modal
// escapes any transformed/overflow-clipped ancestor. onMounted locks body
// scroll; onBeforeUnmount restores it.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import { MEDIA_ROOT } from "@/lib/cmsbar/media";
import { resolveImageSrc } from "@/cmsbar/mediaSrc";

type ImgEntry = { path: string; repoPath: string; size?: number };

const props = defineProps<{
  contentPath: string;
  currentSrc: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const store = useCmsStore();

const branch = computed(
  () => store.cms.preview?.branch ?? store.cms.draft?.branch,
);

const images = ref<ImgEntry[] | null>(null);
const error = ref<string | null>(null);
const filter = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

// Open on the folder the current image lives in, so editors see siblings
// first; fall back to the root when there is no current image.
function initialFolder(src: string): string {
  if (!src.startsWith("/images/")) return "images";
  const rel = src.replace(/^\/+/, "");
  const lastSlash = rel.lastIndexOf("/");
  return lastSlash > 0 ? rel.slice(0, lastSlash) : "images";
}
// Mounted fresh per open (keyed by v-if in the parent), so the starting folder
// only needs currentSrc's open-time value - captured once here.
const selectedFolder = ref(initialFolder(props.currentSrc));

function humanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load() {
  error.value = null;
  try {
    const res = await cmsFetch("/images/list", { cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `List failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { images: ImgEntry[] };
    images.value = data.images;
  } catch (e) {
    error.value = humanError(e);
  }
}

// Merge pending state into the displayed library, exactly like the React
// useMemo chain: pending uploads appear in their target folder, pending deletes
// hide their file, pending folder-creates appear in the tree.
const rootRe = new RegExp(`^${MEDIA_ROOT}/`);
const allEntries = computed<ImgEntry[]>(() => {
  const out = [...(images.value ?? [])];
  for (const up of store.pendingUploads) {
    out.push({
      path: "/" + up.repoPath.replace(rootRe, ""),
      repoPath: up.repoPath,
    });
  }
  return out.filter((i) => !store.pendingDeletes.includes(i.repoPath));
});

const folders = computed(() => {
  const set = new Set<string>(["images"]);
  for (const img of allEntries.value) {
    const rel = img.repoPath.replace(rootRe, "");
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      set.add(parts.slice(0, i).join("/"));
    }
  }
  for (const f of store.pendingFolders) set.add(f.replace(/^\/+|\/+$/g, ""));
  return Array.from(set).sort();
});

const visible = computed(() =>
  allEntries.value.filter((i) => !i.path.endsWith("/.gitkeep")),
);

const filtered = computed(() => {
  const folderPrefix = "/" + selectedFolder.value.replace(/^\/+/, "") + "/";
  return visible.value.filter((i) => {
    if (!i.path.startsWith(folderPrefix)) return false;
    const rest = i.path.slice(folderPrefix.length);
    if (rest.includes("/")) return false;
    if (filter.value && !i.path.toLowerCase().includes(filter.value.toLowerCase()))
      return false;
    return true;
  });
});

function isPendingUpload(repoPath: string): boolean {
  return store.pendingUploads.some((u) => u.repoPath === repoPath);
}

function isNewFolder(f: string): boolean {
  return store.pendingFolders.some((p) => p.replace(/^\/+|\/+$/g, "") === f);
}

function folderLabel(f: string): string {
  return f === "images" ? "/" : (f.split("/").pop() ?? f);
}

function folderDepth(f: string): number {
  return f.split("/").length - 1;
}

function onUpload(file: File) {
  error.value = null;
  try {
    store.addUpload(props.contentPath, file, selectedFolder.value);
    emit("close");
  } catch (e) {
    error.value = humanError(e);
  }
}

function onPickExisting(img: ImgEntry) {
  error.value = null;
  store.addEdit(props.contentPath, img.path);
  emit("close");
}

function onCreateFolder() {
  const name = window.prompt(
    "New folder name (letters, numbers, '-' or '_'). It will be created inside: " +
      selectedFolder.value,
  );
  if (!name) return;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    error.value = "Folder name must contain only letters, numbers, '-' or '_'";
    return;
  }
  const folder = `${selectedFolder.value.replace(/^\/+|\/+$/g, "")}/${name}`;
  store.addFolder(folder);
  selectedFolder.value = folder;
}

function onDelete(img: ImgEntry) {
  if (
    !confirm(
      `Mark ${img.path} for deletion?\nIt will be removed when you click Save.`,
    )
  )
    return;
  store.addDelete(img.repoPath);
  // optimistic: drop from the local list too
  images.value = images.value?.filter((p) => p.repoPath !== img.repoPath) ?? null;
}

function onFileChange(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  const f = input.files?.[0];
  if (f) onUpload(f);
  input.value = "";
}

function onImgError(e: Event) {
  (e.currentTarget as HTMLImageElement).style.opacity = "0.4";
}

function onClose() {
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

// Lock body scroll while the modal is open; restore on unmount. Equivalent to
// the React body-overflow effect / Svelte portal action's scroll lock.
let prevOverflow = "";
onMounted(() => {
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  void load();
});
onBeforeUnmount(() => {
  document.body.style.overflow = prevOverflow;
});
</script>

<template>
  <Teleport to="body">
    <div
      class="cmsbar-mb-overlay"
      role="presentation"
      @click="onClose"
    >
      <div
        class="cmsbar-mb-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Image library"
        tabindex="-1"
        @click.stop
        @keydown="onKeydown"
      >
        <div class="cmsbar-mb-head">
          <h2>Image library</h2>
          <input
            v-model="filter"
            type="text"
            placeholder="Filter by name…"
            class="cmsbar-mb-filter"
          />
          <button
            type="button"
            class="cmsbar-mb-upload-btn"
            @click="fileInput?.click()"
          >
            Upload to this folder
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="cmsbar-mb-file"
            @change="onFileChange"
          />
          <button
            type="button"
            class="cmsbar-mb-close"
            aria-label="Close"
            @click="onClose"
          >
            &#10005;
          </button>
        </div>

        <div v-if="error" class="cmsbar-mb-error">
          <div class="cmsbar-mb-error-body">
            <strong>Something went wrong</strong>
            <span>{{ error }}</span>
          </div>
          <button type="button" @click="error = null">&#10005;</button>
        </div>

        <div class="cmsbar-mb-body">
          <aside class="cmsbar-mb-folders">
            <div class="cmsbar-mb-folders-head">
              <span>Folders</span>
              <button type="button" @click="onCreateFolder">+ New</button>
            </div>
            <ul>
              <li v-for="f in folders" :key="f">
                <button
                  type="button"
                  class="cmsbar-mb-folder"
                  :class="{ active: f === selectedFolder }"
                  :style="`padding-left: ${8 + folderDepth(f) * 12}px`"
                  :title="f"
                  @click="selectedFolder = f"
                >
                  {{ folderLabel(f) }}
                  <span v-if="isNewFolder(f)" class="cmsbar-mb-folder-new"
                    >new</span
                  >
                </button>
              </li>
            </ul>
          </aside>

          <div class="cmsbar-mb-grid-wrap">
            <p v-if="!images" class="cmsbar-mb-muted">Loading…</p>
            <p v-else-if="filtered.length === 0" class="cmsbar-mb-muted">
              No images in this folder. Use
              <strong>Upload to this folder</strong> above.
            </p>
            <div class="cmsbar-mb-grid">
              <div
                v-for="img in filtered"
                :key="img.repoPath"
                class="cmsbar-mb-card"
                :class="{ current: img.path === currentSrc }"
              >
                <img
                  :src="resolveImageSrc(img.path, branch)"
                  :alt="img.path"
                  class="cmsbar-mb-thumb"
                  loading="lazy"
                  @error="onImgError"
                />
                <span v-if="isPendingUpload(img.repoPath)" class="cmsbar-mb-pending"
                  >Pending</span
                >
                <div class="cmsbar-mb-card-body">
                  <p class="cmsbar-mb-name" :title="img.path">
                    {{ img.path.split("/").pop() }}
                  </p>
                  <div class="cmsbar-mb-card-actions">
                    <button
                      type="button"
                      class="cmsbar-mb-use"
                      :disabled="img.path === currentSrc"
                      @click="onPickExisting(img)"
                    >
                      {{ img.path === currentSrc ? "Current" : "Use this" }}
                    </button>
                    <button
                      type="button"
                      class="cmsbar-mb-del"
                      title="Mark for deletion (committed on Save)"
                      @click="onDelete(img)"
                    >
                      &#128465;
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="cmsbar-mb-foot">
          Nothing here commits to the repo by itself - uploads, picks, folder
          creates and deletes all queue as pending changes. Click
          <strong>Save changes</strong> in the CMS bar to commit them as one PR.
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmsbar-mb-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 1rem;
}
.cmsbar-mb-dialog {
  width: 100%;
  max-width: 64rem;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  color: #0f172a;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.cmsbar-mb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
}
.cmsbar-mb-head h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}
.cmsbar-mb-filter {
  flex: 1;
  max-width: 20rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  outline: none;
}
.cmsbar-mb-filter:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-mb-upload-btn {
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  background: var(--cmsbar-accent);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
}
.cmsbar-mb-upload-btn:hover {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-mb-file {
  display: none;
}
.cmsbar-mb-close {
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  color: #64748b;
}
.cmsbar-mb-close:hover {
  color: #0f172a;
}
.cmsbar-mb-error {
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  color: #b91c1c;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.cmsbar-mb-error-body {
  flex: 1;
}
.cmsbar-mb-error-body strong {
  display: block;
}
.cmsbar-mb-error-body span {
  word-break: break-all;
}
.cmsbar-mb-error button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: #ef4444;
}
.cmsbar-mb-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.cmsbar-mb-folders {
  width: 14rem;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow-y: auto;
  padding: 0.5rem;
  font-size: 0.875rem;
}
.cmsbar-mb-folders-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.5rem;
}
.cmsbar-mb-folders-head span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
}
.cmsbar-mb-folders-head button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--cmsbar-accent);
}
.cmsbar-mb-folders ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cmsbar-mb-folder {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem 0.5rem 0.25rem 0;
  border-radius: 0.25rem;
  color: #334155;
}
.cmsbar-mb-folder:hover {
  background: #fff;
}
.cmsbar-mb-folder.active {
  background: #fff;
  font-weight: 500;
  color: var(--cmsbar-accent);
  box-shadow: 0 0 0 1px var(--cmsbar-accent-soft);
}
.cmsbar-mb-folder-new {
  margin-left: 0.25rem;
  font-size: 9px;
  text-transform: uppercase;
  color: var(--cmsbar-shared-strong);
}
.cmsbar-mb-grid-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}
.cmsbar-mb-muted {
  font-size: 0.875rem;
  color: #64748b;
}
.cmsbar-mb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
@media (min-width: 640px) {
  .cmsbar-mb-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 768px) {
  .cmsbar-mb-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.cmsbar-mb-card {
  position: relative;
  border-radius: 0.5rem;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow: hidden;
}
.cmsbar-mb-card.current {
  border-color: var(--cmsbar-accent);
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-mb-thumb {
  display: block;
  width: 100%;
  height: 8rem;
  object-fit: cover;
  background: #fff;
}
.cmsbar-mb-pending {
  position: absolute;
  top: 0.25rem;
  left: 0.25rem;
  border-radius: 0.25rem;
  background: #f59e0b;
  color: #fff;
  font-size: 10px;
  padding: 0.125rem 0.375rem;
}
.cmsbar-mb-card-body {
  padding: 0.375rem 0.5rem;
}
.cmsbar-mb-name {
  font-size: 10px;
  color: #64748b;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-mb-card-actions {
  margin-top: 0.375rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.cmsbar-mb-use {
  flex: 1;
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  background: #0f172a;
  color: #fff;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}
.cmsbar-mb-use:hover:not(:disabled) {
  background: #334155;
}
.cmsbar-mb-use:disabled {
  opacity: 0.5;
  cursor: default;
}
.cmsbar-mb-del {
  border: 1px solid #cbd5e1;
  cursor: pointer;
  border-radius: 0.25rem;
  background: #fff;
  color: #475569;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}
.cmsbar-mb-del:hover {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #b91c1c;
}
.cmsbar-mb-foot {
  border-top: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  font-size: 0.75rem;
  color: #64748b;
}
</style>
