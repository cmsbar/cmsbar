<script setup lang="ts">
// SEO / social meta editor for the current page, ported from
// template/components/cmsbar/PageMetaDrawer.tsx (mirroring PageMetaDrawer.svelte)
// to a Vue 3 SFC. Reads/writes pageMeta.<key>.<field> + the site-wide favicon
// through the store (metaKey / META_PAGES from @/lib/cmsbar/page-meta). Includes
// the inline image browser (GET /media/list?type=image), the Google + Facebook/X
// social previews, and the character counters. The React ImageField + Counter
// sub-components are inlined here. Rendered via <Teleport to="body"> + scroll lock.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { cmsConfig } from "@/cms.config";
import { useCmsStore } from "@/cmsbar/content";
import { metaKey, META_PAGES } from "@/lib/cmsbar/page-meta";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

defineProps<{ canEdit: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const TITLE_MAX = 60;
const DESC_MAX = 155;

const store = useCmsStore();
const route = useRoute();
const pathname = computed(() => route.path || "/");
const key = computed(() => metaKey(pathname.value));

const socialView = ref<"fb" | "x">("fb");

// Read helpers (string + boolean fields).
function field(name: string): string {
  return key.value
    ? ((store.get(`pageMeta.${key.value}.${name}`) as string | undefined) ?? "")
    : "";
}
const noindex = computed(() =>
  key.value ? Boolean(store.get(`pageMeta.${key.value}.noindex`)) : false,
);
const favicon = computed(() => (store.get("favicon") as string | undefined) ?? "");

function set(name: string, value: string | boolean) {
  if (!key.value) return;
  store.addEdit(`pageMeta.${key.value}.${name}`, value);
}

const title = computed(() => field("title"));
const description = computed(() => field("description"));
const ogImage = computed(() => field("ogImage"));
const ogTitle = computed(() => field("ogTitle"));
const ogDescription = computed(() => field("ogDescription"));
const canonical = computed(() => field("canonical"));

const metaPageLabels = META_PAGES.map((p) => p.label).join(", ");

// Keeps input-event casts out of the template (vue-tsc-clean).
function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}

// ── Inline image browser state (one per ImageField, keyed by which field) ──
const browsingField = ref<string | null>(null);
const browseItems = ref<{ path: string }[] | null>(null);

async function openBrowse(forField: string) {
  if (browsingField.value === forField) {
    browsingField.value = null;
    return;
  }
  browsingField.value = forField;
  if (browseItems.value !== null) return;
  try {
    const res = await cmsFetch("/media/list?type=image", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      files?: { path: string }[];
    };
    browseItems.value = data.files ?? [];
  } catch {
    browseItems.value = [];
  }
}

let prevOverflow = "";
onMounted(() => {
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
});
onBeforeUnmount(() => {
  document.body.style.overflow = prevOverflow;
});
</script>

<template>
  <Teleport to="body">
    <div class="cmsbar-pm-root" data-cms-ui>
      <div class="cmsbar-pm-scrim" role="presentation" @click="emit('close')"></div>
      <div class="cmsbar-pm-drawer" role="dialog" aria-modal="true" aria-label="Page metadata">
        <header class="cmsbar-pm-head">
          <div>
            <h2>Page metadata</h2>
            <p class="cmsbar-pm-sub">
              Editing: <span class="cmsbar-pm-path">{{ pathname }}</span>
            </p>
          </div>
          <button type="button" class="cmsbar-pm-x" aria-label="Close" @click="emit('close')">
            &#10005;
          </button>
        </header>

        <div class="cmsbar-pm-body">
          <div v-if="!key" class="cmsbar-pm-nokey">
            Metadata editing is available on the main pages: {{ metaPageLabels }}.
            Course and teacher pages take their title/description from their own
            content.
          </div>
          <fieldset v-else class="cmsbar-pm-fieldset" :disabled="!canEdit">
            <div v-if="!canEdit" class="cmsbar-pm-ro">
              Viewing the live values (read-only). <strong>Start a draft</strong>
              to edit metadata.
            </div>

            <!-- Title -->
            <div>
              <label class="cmsbar-pm-label cmsbar-pm-label-row" for="cmsbar-pm-title">
                <span>Page title</span>
                <span class="cmsbar-pm-counter" :class="{ over: title.length > TITLE_MAX }"
                  >{{ title.length }} / {{ TITLE_MAX }}</span
                >
              </label>
              <input
                id="cmsbar-pm-title"
                type="text"
                class="cmsbar-pm-input full"
                :value="title"
                @input="set('title', val($event))"
              />
              <p class="cmsbar-pm-help">Browser tab + the search-result headline.</p>
            </div>

            <!-- Description -->
            <div>
              <label class="cmsbar-pm-label cmsbar-pm-label-row" for="cmsbar-pm-desc">
                <span>Meta description</span>
                <span
                  class="cmsbar-pm-counter"
                  :class="{ over: description.length > DESC_MAX }"
                  >{{ description.length }} / {{ DESC_MAX }}</span
                >
              </label>
              <textarea
                id="cmsbar-pm-desc"
                rows="3"
                class="cmsbar-pm-input full"
                :value="description"
                @input="set('description', val($event))"
              ></textarea>
              <p class="cmsbar-pm-help">Summary under the title in search results.</p>
            </div>

            <!-- Social image (inlined ImageField) -->
            <div>
              <span class="cmsbar-pm-label">Social share image (og:image)</span>
              <div class="cmsbar-pm-imgrow">
                <div class="cmsbar-pm-thumb">
                  <img v-if="ogImage" :src="ogImage" alt="" />
                </div>
                <input
                  type="text"
                  class="cmsbar-pm-input"
                  placeholder="/images/…"
                  :value="ogImage"
                  @input="set('ogImage', val($event))"
                />
                <button type="button" class="cmsbar-pm-smallbtn" @click="openBrowse('ogImage')">
                  {{ browsingField === "ogImage" ? "Close" : "Browse" }}
                </button>
                <button
                  v-if="ogImage"
                  type="button"
                  class="cmsbar-pm-smallbtn danger"
                  @click="set('ogImage', '')"
                >
                  Clear
                </button>
              </div>
              <p class="cmsbar-pm-help">
                Shown when shared on Facebook/WhatsApp/Messenger. 1200×630.
              </p>
              <div v-if="browsingField === 'ogImage'" class="cmsbar-pm-browse">
                <p v-if="browseItems === null" class="cmsbar-pm-browse-msg">Loading…</p>
                <p v-else-if="browseItems.length === 0" class="cmsbar-pm-browse-msg">
                  No images found.
                </p>
                <button
                  v-for="it in browseItems ?? []"
                  v-else
                  :key="it.path"
                  type="button"
                  class="cmsbar-pm-tile"
                  :class="{ active: it.path === ogImage }"
                  :title="it.path"
                  aria-label="Use this image"
                  @click="
                    set('ogImage', it.path);
                    browsingField = null;
                  "
                >
                  <img :src="it.path" alt="" />
                </button>
              </div>
            </div>

            <!-- noindex toggle -->
            <div class="cmsbar-pm-toggle">
              <div>
                <div class="cmsbar-pm-toggle-title">Show in search engines</div>
                <div class="cmsbar-pm-toggle-sub">
                  Turn off to add noindex (hide this page from Google).
                </div>
              </div>
              <button
                type="button"
                class="cmsbar-pm-switch"
                :class="{ on: !noindex }"
                :aria-pressed="!noindex"
                aria-label="Show in search engines"
                @click="set('noindex', !noindex)"
              >
                <span class="cmsbar-pm-switch-knob"></span>
              </button>
            </div>

            <!-- Advanced -->
            <details class="cmsbar-pm-advanced">
              <summary>Advanced</summary>
              <div class="cmsbar-pm-advanced-body">
                <div>
                  <label class="cmsbar-pm-label" for="cmsbar-pm-ogtitle">Social title</label>
                  <input
                    id="cmsbar-pm-ogtitle"
                    type="text"
                    class="cmsbar-pm-input full"
                    :placeholder="title"
                    :value="ogTitle"
                    @input="set('ogTitle', val($event))"
                  />
                </div>
                <div>
                  <label class="cmsbar-pm-label" for="cmsbar-pm-ogdesc">Social description</label>
                  <textarea
                    id="cmsbar-pm-ogdesc"
                    rows="2"
                    class="cmsbar-pm-input full"
                    :placeholder="description"
                    :value="ogDescription"
                    @input="set('ogDescription', val($event))"
                  ></textarea>
                </div>
                <div>
                  <label class="cmsbar-pm-label" for="cmsbar-pm-canonical"
                    >Canonical URL (blank = auto)</label
                  >
                  <input
                    id="cmsbar-pm-canonical"
                    type="text"
                    class="cmsbar-pm-input full"
                    placeholder="https://…"
                    :value="canonical"
                    @input="set('canonical', val($event))"
                  />
                </div>
              </div>
            </details>

            <!-- Site-wide favicon (inlined ImageField) -->
            <div class="cmsbar-pm-sitewide">
              <p class="cmsbar-pm-section">Site-wide (applies to every page)</p>
              <div>
                <span class="cmsbar-pm-label">Favicon</span>
                <div class="cmsbar-pm-imgrow">
                  <div class="cmsbar-pm-thumb">
                    <img v-if="favicon" :src="favicon" alt="" />
                  </div>
                  <input
                    type="text"
                    class="cmsbar-pm-input"
                    placeholder="/images/…"
                    :value="favicon"
                    @input="store.addEdit('favicon', val($event))"
                  />
                  <button type="button" class="cmsbar-pm-smallbtn" @click="openBrowse('favicon')">
                    {{ browsingField === "favicon" ? "Close" : "Browse" }}
                  </button>
                  <button
                    v-if="favicon"
                    type="button"
                    class="cmsbar-pm-smallbtn danger"
                    @click="store.addEdit('favicon', '')"
                  >
                    Clear
                  </button>
                </div>
                <p class="cmsbar-pm-help">
                  Browser-tab icon. PNG/SVG/ICO; square (e.g. 32×32 or 512×512).
                </p>
                <div v-if="browsingField === 'favicon'" class="cmsbar-pm-browse">
                  <p v-if="browseItems === null" class="cmsbar-pm-browse-msg">Loading…</p>
                  <p v-else-if="browseItems.length === 0" class="cmsbar-pm-browse-msg">
                    No images found.
                  </p>
                  <button
                    v-for="it in browseItems ?? []"
                    v-else
                    :key="it.path"
                    type="button"
                    class="cmsbar-pm-tile"
                    :class="{ active: it.path === favicon }"
                    :title="it.path"
                    aria-label="Use this image"
                    @click="
                      store.addEdit('favicon', it.path);
                      browsingField = null;
                    "
                  >
                    <img :src="it.path" alt="" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Google result preview -->
            <div>
              <p class="cmsbar-pm-section">Google result</p>
              <div class="cmsbar-pm-serp">
                <div class="cmsbar-pm-serp-url">
                  {{ cmsConfig.domain }} › {{ key === "home" ? "" : key }}
                </div>
                <div class="cmsbar-pm-serp-title">{{ title || "Untitled page" }}</div>
                <div class="cmsbar-pm-serp-desc">
                  {{ description || "No description set." }}
                </div>
              </div>
            </div>

            <!-- Social preview -->
            <div>
              <div class="cmsbar-pm-social-head">
                <p class="cmsbar-pm-section">Social share</p>
                <div class="cmsbar-pm-segment">
                  <button
                    v-for="v in (['fb', 'x'] as const)"
                    :key="v"
                    type="button"
                    class="cmsbar-pm-seg-btn"
                    :class="{ active: socialView === v }"
                    @click="socialView = v"
                  >
                    {{ v === "fb" ? "Facebook" : "X / Twitter" }}
                  </button>
                </div>
              </div>

              <div v-if="socialView === 'fb'" class="cmsbar-pm-fbcard">
                <div
                  class="cmsbar-pm-ogimg"
                  :style="{ backgroundImage: ogImage ? `url(${ogImage})` : undefined }"
                >
                  {{ ogImage ? "" : "1200 × 630 image" }}
                </div>
                <div class="cmsbar-pm-fbmeta">
                  <div class="cmsbar-pm-fbdomain">{{ cmsConfig.domain }}</div>
                  <div class="cmsbar-pm-fbtitle">
                    {{ ogTitle || title || "Untitled page" }}
                  </div>
                  <div class="cmsbar-pm-fbdesc">
                    {{ ogDescription || description || "No description set." }}
                  </div>
                </div>
              </div>
              <div v-else class="cmsbar-pm-xcard">
                <div
                  class="cmsbar-pm-ogimg"
                  :style="{ backgroundImage: ogImage ? `url(${ogImage})` : undefined }"
                >
                  {{ ogImage ? "" : "Summary image" }}
                </div>
                <div class="cmsbar-pm-xmeta">
                  <div class="cmsbar-pm-xtitle">
                    {{ ogTitle || title || "Untitled page" }}
                  </div>
                  <div class="cmsbar-pm-fbdesc">
                    {{ ogDescription || description || "No description set." }}
                  </div>
                  <div class="cmsbar-pm-xdomain">{{ cmsConfig.domain }}</div>
                </div>
              </div>
            </div>
          </fieldset>
        </div>

        <footer class="cmsbar-pm-foot">
          <template v-if="canEdit">
            Changes are staged in your draft - click <strong>Save</strong> in the
            CMS bar to commit them.
          </template>
          <template v-else>
            Read-only preview - start a draft from the CMS bar to make changes.
          </template>
          <span class="cmsbar-pm-note">
            Note: the live page&rsquo;s &lt;head&gt; updates after the draft is
            merged &amp; deployed; this panel is the preview.
          </span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmsbar-pm-root {
  position: fixed;
  inset: 0;
  z-index: 150;
  font-family:
    ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #0f172a;
}
.cmsbar-pm-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8, 12, 24, 0.45);
  backdrop-filter: blur(2px);
}
.cmsbar-pm-drawer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  background: #fff;
  box-shadow: -20px 0 60px -20px rgba(0, 0, 0, 0.4);
}
.cmsbar-pm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 1rem 1.25rem;
}
.cmsbar-pm-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.cmsbar-pm-sub {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-path {
  font-weight: 500;
  color: var(--cmsbar-info);
}
.cmsbar-pm-x {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  color: #94a3b8;
}
.cmsbar-pm-x:hover {
  color: #334155;
}
.cmsbar-pm-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}
.cmsbar-pm-foot {
  border-top: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-note {
  margin-top: 0.25rem;
  display: block;
  color: #94a3b8;
}
.cmsbar-pm-nokey {
  border-radius: 0.5rem;
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  padding: 1rem;
  font-size: 0.875rem;
  color: #475569;
}
.cmsbar-pm-fieldset {
  margin: 0;
  border: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.cmsbar-pm-fieldset:disabled {
  opacity: 0.7;
}
.cmsbar-pm-ro {
  border-radius: 0.5rem;
  border: 1px solid #fde68a;
  background: #fffbeb;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: #92400e;
}
.cmsbar-pm-label {
  display: block;
  margin-bottom: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #334155;
}
.cmsbar-pm-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cmsbar-pm-counter {
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
}
.cmsbar-pm-counter.over {
  color: #dc2626;
}
.cmsbar-pm-input {
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  outline: none;
  font-family: inherit;
}
.cmsbar-pm-input.full {
  width: 100%;
}
.cmsbar-pm-input:focus {
  border-color: var(--cmsbar-accent);
  box-shadow: 0 0 0 2px var(--cmsbar-accent-soft);
}
.cmsbar-pm-help {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-imgrow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.cmsbar-pm-thumb {
  height: 3rem;
  width: 3rem;
  flex: none;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid #e2e8f0;
  background: #f1f5f9;
}
.cmsbar-pm-thumb img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}
.cmsbar-pm-imgrow .cmsbar-pm-input {
  min-width: 0;
  flex: 1;
}
.cmsbar-pm-smallbtn {
  flex: none;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  background: #fff;
  cursor: pointer;
  padding: 0.5rem 0.625rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: #334155;
}
.cmsbar-pm-smallbtn:hover {
  border-color: var(--cmsbar-accent);
  color: var(--cmsbar-accent);
}
.cmsbar-pm-smallbtn.danger:hover {
  border-color: #f87171;
  color: #ef4444;
}
.cmsbar-pm-browse {
  margin-top: 0.5rem;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
  max-height: 12rem;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.5rem;
}
.cmsbar-pm-browse-msg {
  grid-column: span 5;
  margin: 0;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-tile {
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid #e2e8f0;
  background: #f1f5f9;
  cursor: pointer;
  padding: 0;
}
.cmsbar-pm-tile:hover {
  border-color: var(--cmsbar-accent);
}
.cmsbar-pm-tile.active {
  border-color: var(--cmsbar-accent);
  box-shadow: 0 0 0 2px var(--cmsbar-accent-soft);
}
.cmsbar-pm-tile img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}
.cmsbar-pm-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.625rem 0.75rem;
}
.cmsbar-pm-toggle-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #334155;
}
.cmsbar-pm-toggle-sub {
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-switch {
  position: relative;
  flex: none;
  height: 1.5rem;
  width: 2.75rem;
  border-radius: 9999px;
  background: #cbd5e1;
  border: 0;
  cursor: pointer;
  transition: background 0.15s ease;
}
.cmsbar-pm-switch.on {
  background: var(--cmsbar-info);
}
.cmsbar-pm-switch-knob {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  height: 1.25rem;
  width: 1.25rem;
  border-radius: 9999px;
  background: #fff;
  transition: transform 0.15s ease;
}
.cmsbar-pm-switch.on .cmsbar-pm-switch-knob {
  transform: translateX(1.25rem);
}
.cmsbar-pm-advanced {
  border-top: 1px solid #e2e8f0;
  padding-top: 0.75rem;
}
.cmsbar-pm-advanced summary {
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--cmsbar-info);
}
.cmsbar-pm-advanced-body {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cmsbar-pm-sitewide {
  border-top: 1px solid #e2e8f0;
  padding-top: 0.75rem;
}
.cmsbar-pm-section {
  margin: 0 0 0.5rem;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}
.cmsbar-pm-serp {
  border-radius: 0.75rem;
  border: 1px solid #e2e8f0;
  padding: 0.75rem;
}
.cmsbar-pm-serp-url {
  font-size: 13px;
  color: #15803d;
}
.cmsbar-pm-serp-title {
  font-size: 1.125rem;
  line-height: 1.375;
  color: #1d4ed8;
}
.cmsbar-pm-serp-desc {
  margin-top: 0.125rem;
  font-size: 13px;
  line-height: 1.375;
  color: #475569;
}
.cmsbar-pm-social-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.cmsbar-pm-segment {
  display: flex;
  gap: 0.25rem;
  border-radius: 0.375rem;
  background: #f1f5f9;
  padding: 0.125rem;
}
.cmsbar-pm-seg-btn {
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: transparent;
  font-family: inherit;
}
.cmsbar-pm-seg-btn.active {
  background: #fff;
  color: #334155;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.cmsbar-pm-ogimg {
  height: 10rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e2e8f0;
  background-size: cover;
  background-position: center;
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-pm-fbcard {
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid #e2e8f0;
}
.cmsbar-pm-fbmeta {
  border-top: 1px solid #e2e8f0;
  background: #f2f3f5;
  padding: 0.5rem 0.75rem;
}
.cmsbar-pm-fbdomain {
  font-size: 11px;
  text-transform: uppercase;
  color: #64748b;
}
.cmsbar-pm-fbtitle {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-pm-fbdesc {
  font-size: 0.75rem;
  color: #64748b;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cmsbar-pm-xcard {
  overflow: hidden;
  border-radius: 1rem;
  border: 1px solid #e2e8f0;
}
.cmsbar-pm-xmeta {
  padding: 0.5rem 0.75rem;
}
.cmsbar-pm-xtitle {
  font-size: 0.875rem;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-pm-xdomain {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  color: #94a3b8;
}
</style>
