<script setup lang="ts">
// The draft-versions dialog, ported from
// template/components/cmsbar/VersionsDialog.tsx (mirroring the Svelte
// VersionsDialog.svelte) to a Vue 3 SFC. Lists every open cms/* PR
// (GET /versions) and offers preview / edit-this-version / fork. The store's
// setPreview drives preview; /session/switch drives edit. The approved label
// locks a version to preview/fork only; the active draft is marked + can't be
// re-edited. Rendered via <Teleport to="body"> with a body-scroll lock.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";

type Version = {
  number: number;
  title: string;
  branch: string;
  author: string | null;
  updatedAt: string;
  commitCount: number;
  prUrl: string;
  approved: boolean;
  labels: string[];
};

const emit = defineEmits<{
  (e: "close"): void;
  (e: "fork", branch: string, title?: string): void;
}>();

const store = useCmsStore();
const cms = computed(() => store.cms);

const versions = ref<Version[] | null>(null);
const approvedLabel = ref("approved");
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load() {
  error.value = null;
  try {
    const res = await cmsFetch("/versions", { cache: "no-store" });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      versions: Version[];
      approvedLabel: string;
    };
    versions.value = data.versions;
    approvedLabel.value = data.approvedLabel;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function preview(v: Version) {
  busy.value = v.branch;
  await store.setPreview({
    branch: v.branch,
    title: v.title,
    approved: v.approved,
  });
  busy.value = null;
  emit("close");
}

async function editVersion(v: Version) {
  busy.value = v.branch;
  try {
    const res = await cmsFetch("/session/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: v.branch, title: v.title }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      pagePath?: string;
    };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    try {
      localStorage.removeItem(PREVIEW_LS_KEY);
    } catch {
      /* SSR / quota */
    }
    const target = data.pagePath;
    if (target && target !== window.location.pathname) {
      window.location.href = target;
    } else {
      window.location.reload();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = null;
  }
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString();
}

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
      class="cmsbar-vd-overlay"
      data-cms-ui
      role="presentation"
      @click="emit('close')"
    >
      <div
        class="cmsbar-vd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Draft versions"
        tabindex="-1"
        @click.stop
        @keydown="(e) => e.key === 'Escape' && emit('close')"
      >
        <div class="cmsbar-vd-head">
          <div>
            <h2>Draft versions</h2>
            <p>
              Every open PR in this repo whose branch starts with
              <code>cms/</code>. Preview renders the page with that draft&rsquo;s
              content. PRs labelled <code>{{ approvedLabel }}</code> are locked -
              you can preview or fork, but not edit.
            </p>
          </div>
          <button
            type="button"
            class="cmsbar-vd-x"
            aria-label="Close"
            @click="emit('close')"
          >
            &#10005;
          </button>
        </div>

        <div v-if="error" class="cmsbar-vd-error">{{ error }}</div>

        <div class="cmsbar-vd-list">
          <p v-if="!versions" class="cmsbar-vd-muted">Loading…</p>
          <p v-else-if="versions.length === 0" class="cmsbar-vd-muted">
            No open CMS drafts yet. Start one from the CMS bar.
          </p>
          <ul v-else>
            <li
              v-for="v in versions"
              :key="v.number"
              class="cmsbar-vd-item"
              :class="{
                active: cms.draft?.branch === v.branch,
                previewing: cms.preview?.branch === v.branch,
              }"
            >
              <div class="cmsbar-vd-info">
                <div class="cmsbar-vd-titlerow">
                  <span class="cmsbar-vd-title">{{ v.title }}</span>
                  <a
                    :href="v.prUrl"
                    target="_blank"
                    rel="noreferrer"
                    class="cmsbar-vd-num"
                    title="Open PR on GitHub"
                    >#{{ v.number }}</a
                  >
                  <span v-if="v.approved" class="cmsbar-vd-tag approved"
                    >{{ approvedLabel }} · locked</span
                  >
                  <span v-if="cms.draft?.branch === v.branch" class="cmsbar-vd-tag mine"
                    >your draft</span
                  >
                </div>
                <p class="cmsbar-vd-meta">
                  {{ v.commitCount }} change{{ v.commitCount === 1 ? "" : "s" }} ·
                  {{ v.author ?? "-" }} · updated {{ fmtDate(v.updatedAt) }}
                </p>
              </div>
              <div class="cmsbar-vd-actions">
                <button
                  type="button"
                  class="cmsbar-vd-btn"
                  :disabled="busy === v.branch"
                  @click="preview(v)"
                >
                  Preview
                </button>
                <button
                  v-if="!v.approved && cms.draft?.branch !== v.branch"
                  type="button"
                  class="cmsbar-vd-btn dark"
                  :disabled="busy === v.branch"
                  title="Switch your active draft to this PR - your edits go onto it."
                  @click="editVersion(v)"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="cmsbar-vd-btn outline"
                  :disabled="busy === v.branch"
                  title="Create a new PR branched from this one."
                  @click="emit('fork', v.branch, v.title)"
                >
                  Fork
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmsbar-vd-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 1rem;
  font-family:
    ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #0f172a;
}
.cmsbar-vd-dialog {
  width: 100%;
  max-width: 48rem;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.cmsbar-vd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  gap: 1rem;
}
.cmsbar-vd-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.cmsbar-vd-head p {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-vd-head code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cmsbar-vd-x {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: #64748b;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
}
.cmsbar-vd-x:hover {
  color: #0f172a;
}
.cmsbar-vd-error {
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  color: #b91c1c;
}
.cmsbar-vd-list {
  flex: 1;
  overflow-y: auto;
}
.cmsbar-vd-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cmsbar-vd-muted {
  padding: 1.25rem;
  font-size: 0.875rem;
  color: #64748b;
  margin: 0;
}
.cmsbar-vd-item {
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.cmsbar-vd-item:last-child {
  border-bottom: 0;
}
.cmsbar-vd-item.active {
  background: var(--cmsbar-accent-soft);
}
.cmsbar-vd-item.previewing {
  background: #fffbeb;
}
.cmsbar-vd-info {
  flex: 1;
  min-width: 0;
}
.cmsbar-vd-titlerow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cmsbar-vd-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-vd-num {
  font-size: 0.75rem;
  color: #64748b;
  flex-shrink: 0;
  text-decoration: none;
}
.cmsbar-vd-num:hover {
  color: var(--cmsbar-accent);
}
.cmsbar-vd-tag {
  font-size: 10px;
  border-radius: 9999px;
  padding: 0.125rem 0.5rem;
  font-weight: 500;
}
.cmsbar-vd-tag.approved {
  background: #d1fae5;
  color: #065f46;
}
.cmsbar-vd-tag.mine {
  background: var(--cmsbar-accent-soft);
  color: var(--cmsbar-accent-strong);
}
.cmsbar-vd-meta {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-vd-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.cmsbar-vd-btn {
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  padding: 0.25rem 0.625rem;
  background: #f1f5f9;
  color: #1e293b;
  font: inherit;
}
.cmsbar-vd-btn:hover:not(:disabled) {
  background: #e2e8f0;
}
.cmsbar-vd-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.cmsbar-vd-btn.dark {
  background: #0f172a;
  color: #fff;
}
.cmsbar-vd-btn.dark:hover:not(:disabled) {
  background: #334155;
}
.cmsbar-vd-btn.outline {
  background: transparent;
  border: 1px solid #cbd5e1;
  color: #334155;
}
.cmsbar-vd-btn.outline:hover:not(:disabled) {
  border-color: var(--cmsbar-accent);
  color: var(--cmsbar-accent);
}
</style>
