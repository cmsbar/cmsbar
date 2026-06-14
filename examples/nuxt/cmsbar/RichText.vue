<script setup lang="ts">
// Inline rich-text editing, ported from template/components/cmsbar/RichText.tsx
// (mirroring the already-correct examples/sveltekit/src/cmsbar/RichText.svelte)
// to a Vue 3 SFC. View mode renders the saved (sanitized) HTML inert; edit mode
// turns the same element into a contenteditable region with a floating selection
// toolbar (h2/h3/h4, bold, italic, underline, lists, link, plus an optional
// decorative-class button when cmsConfig.richText.decorClass is set).
//
// The toolbar drives the browser's execCommand + Selection/Range API exactly as
// the React/Svelte originals do, then stages sanitized HTML through the store's
// addEdit(path, ...). The same caret-preservation rule as T.vue applies: the
// value->DOM sync writes innerHTML only when the editor is NOT focused (and focus
// is not parked in the toolbar's link input), so a re-render mid-edit never
// detaches the saved selection or collapses the caret.
//
// The selection/range helpers live in richText.ts (a plain module) so RichText
// and RichTextToolbar can both import them without an SFC<->SFC circular import.
// The toolbar itself portals to <body> (Vue <Teleport>) for viewport-relative
// position:fixed coordinates that escape any overflow-clipped ancestor.

import { computed, h, nextTick, onMounted, ref, watch, type VNode } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { isSharedPath } from "@/lib/cmsbar/shared-paths";
import { cmsConfig } from "@/cms.config";
import { sanitizeRichText } from "@/cmsbar/richText";
import Toolbar from "@/cmsbar/RichTextToolbar.vue";

// Block-level editor roots get the theme's .cmsbar-prose content defaults
// (headings, lists, links survive a CSS reset). Must stay in sync with the
// Toolbar's isBlockRoot check, which gates the block-format buttons.
const BLOCK_TAGS = new Set(["div", "article", "section"]);

const props = withDefaults(
  defineProps<{
    path: string;
    as?: string;
    class?: string;
    fallback?: string;
  }>(),
  { as: "span", fallback: "" },
);

// Optional decorative class the toolbar can toggle on inline spans (empty string
// disables the button entirely), configured per-project.
const HAND_CLASS = cmsConfig.richText?.decorClass ?? "";

const store = useCmsStore();

const value = computed(
  () => (store.get(props.path) as string | undefined) ?? props.fallback,
);
const editMode = computed(() => store.editMode);
const authenticated = computed(() => store.cms.authenticated);
const shared = computed(() => isSharedPath(props.path));
const isBlock = computed(() => BLOCK_TAGS.has(props.as));

const el = ref<HTMLElement | null>(null);
const focused = ref(false);

// Tracks the last HTML we either seeded or staged, so stage() can no-op when
// nothing meaningful changed (mirrors lastSeenRef in RichText.tsx). Plain (non-
// reactive) bookkeeping, seeded by syncDom on mount / value change.
let lastSeen = "";

function stage(nextHtml: string) {
  const cleaned = sanitizeRichText(nextHtml, HAND_CLASS);
  if (cleaned === lastSeen) return;
  lastSeen = cleaned;
  store.addEdit(props.path, cleaned);
}

// value -> DOM sync (edit mode only). Writes innerHTML ONLY when the editor is
// not focused and focus is not parked in the toolbar (the link input keeps a
// live editing session whose saved Range we must not detach). Faithful copy of
// RichText.tsx's resync effects / RichText.svelte's focus-guarded $effect.
function syncDom() {
  const node = el.value;
  const next = value.value;
  if (!node) return;
  if (!editMode.value) return;
  if (typeof document === "undefined") return;
  if (document.activeElement === node) return;
  if ((document.activeElement as HTMLElement | null)?.closest("[data-cms-toolbar]")) return;
  if (node.innerHTML !== next) node.innerHTML = next;
  lastSeen = next;
}

watch(
  [value, editMode],
  () => {
    void nextTick(syncDom);
  },
  { flush: "post" },
);
onMounted(() => {
  void nextTick(syncDom);
});

function onFocus() {
  focused.value = true;
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {
    /* unsupported on some browsers - harmless */
  }
}

function onBlur(e: FocusEvent) {
  // Always stage - even when focus moves into the toolbar (link input). syncDom
  // skips while the toolbar holds focus, so staging here can no longer rewrite
  // innerHTML mid-link-edit and detach the saved range.
  const html = (e.currentTarget as HTMLElement).innerHTML;
  stage(html);
  setTimeout(() => {
    if ((document.activeElement as HTMLElement | null)?.closest("[data-cms-toolbar]"))
      return;
    focused.value = false;
  }, 200);
}

function swallow(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

function onAbandon() {
  if (el.value) stage(el.value.innerHTML);
  focused.value = false;
}

// View-mode renderer. We render the saved HTML via a render function (h with
// innerHTML) rather than `<component :is="as"> v-html` in the template: Vue's
// optimizing SSR compiler does NOT emit v-html content for a *dynamic* component
// element, so the template form server-renders an empty node (the value is
// present - confirmed - but the HTML is dropped). h()'s innerHTML goes through
// the runtime SSR path, which serializes it correctly. `as` stays generic.
const rtView = (): VNode =>
  h(props.as, {
    "data-cms-path": authenticated.value ? props.path : undefined,
    "data-cms-shared": authenticated.value && shared.value ? "true" : undefined,
    class: [isBlock.value && "cmsbar-prose", props.class],
    innerHTML: value.value,
  });
</script>

<template>
  <!-- editMode is the single conditional. The contenteditable + its floating
       Toolbar live inside the v-if block; the inert view is the v-else. Keeping
       the Toolbar's own v-if INSIDE this block (not between v-if/v-else-if at the
       same level) is essential: a sibling v-if there would group the v-else
       branch with the Toolbar and break v-html on the view element. -->
  <template v-if="editMode">
    <component
      :is="as"
      ref="el"
      :data-cms-path="path"
      :data-cms-shared="shared ? 'true' : undefined"
      :title="
        shared
          ? 'Shared element - editing this changes it on every page that uses it'
          : undefined
      "
      :class="[
        'cmsbar-richtext',
        shared && 'cmsbar-richtext-shared',
        isBlock && 'cmsbar-prose',
        props.class,
      ]"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      @focus="onFocus"
      @blur="onBlur"
      @click.capture="swallow"
    />
    <Toolbar
      v-if="focused && el"
      :editor="el"
      :hand-class="HAND_CLASS"
      @abandon="onAbandon"
    />
  </template>
  <!-- View mode: render the saved (already-sanitized) HTML inert through the
       rtView render function (see its definition for why not template v-html).
       data-cms-path only for an authenticated editor, so public HTML stays inert. -->
  <component v-else :is="rtView" />
</template>

<style>
/* Edit-mode outline, mirroring RichText.tsx's ring treatment. The amber
   "shared" variant warns about site-wide content. */
.cmsbar-richtext {
  outline: none;
  border-radius: 4px;
  padding: 0 2px;
  box-shadow: 0 0 0 1px var(--cmsbar-ring);
  transition: box-shadow 0.15s ease;
}
.cmsbar-richtext:hover {
  box-shadow: 0 0 0 1px var(--cmsbar-accent);
}
.cmsbar-richtext:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-richtext-shared {
  background: var(--cmsbar-shared-soft);
  box-shadow: 0 0 0 2px var(--cmsbar-shared);
}
.cmsbar-richtext-shared:hover,
.cmsbar-richtext-shared:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-shared-strong);
}
</style>
