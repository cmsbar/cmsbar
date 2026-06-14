<script setup lang="ts">
// Editable text primitive, ported from template/components/cmsbar/T.tsx (and
// mirroring the already-correct examples/sveltekit/src/cmsbar/T.svelte) to a
// Vue 3 SFC. Every editable text node renders through this component.
//
//   - View mode: a plain <{as}> element with the resolved string as its text.
//     `data-cms-path` is attached only for an authenticated editor (it is the
//     hook editor tooling keys off), exactly as the React/Svelte versions do.
//     No contenteditable, so public HTML stays inert.
//   - Edit mode (an active, editable draft): the same element gains
//     `contenteditable`; typing stages the new value through the store's
//     addEdit(path, ...). Enter blurs (single-line) so a stray newline never
//     sneaks into a heading.
//
// V2 is plain-text only: the React T uses innerHTML to round-trip inline
// rich-text tags, but rich text is a later Vue phase (V4), so we read/write
// textContent here. The caret-preservation rule is reproduced faithfully:
// the value->DOM sync writes textContent ONLY when the element is not focused,
// so re-renders mid-edit never collapse the user's caret to position 0.
//
// CRITICAL (the caret bug): in edit mode the contenteditable is rendered with
// an EMPTY body - it must NOT contain a reactive {{ value }} text child. Binding
// the reactive value as the element's text makes Vue's renderer rewrite the text
// node on every keystroke (addEdit -> value changes), collapsing the caret to
// position 0 and making typing impossible. Instead the focus-guarded watch below
// is the SOLE writer of the editable text: it seeds textContent when edit mode
// mounts and resyncs only while the node is unfocused, exactly as React's T
// writes innerHTML only when document.activeElement !== ref. View mode keeps the
// reactive {{ value }} child (no caret to clobber).

import { computed, ref, watch, nextTick, onMounted } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { cmsConfig } from "@/cms.config";

const props = withDefaults(
  defineProps<{
    path: string;
    as?: string;
    class?: string;
    /** Fallback text when the content model has no value for `path`. */
    fallback?: string;
  }>(),
  { as: "span", fallback: "" },
);

const store = useCmsStore();

// Reactive reads off the store: value re-resolves and editMode flips live.
const value = computed(
  () => (store.get(props.path) as string | undefined) ?? props.fallback,
);
const editMode = computed(() => store.editMode);
const authenticated = computed(() => store.cms.authenticated);

// Mirror of the React/Svelte helper: warn the editor when a path renders
// site-wide. (The neutral isSharedPath lives in template/components/cmsbar,
// which this example does not copy - see the neutral-core gap note in the
// summary - so the prefix check is inlined here against cmsConfig, exactly as
// T.svelte does.)
const shared = computed(() => {
  for (const p of cmsConfig.sharedPrefixes) {
    if (props.path === p.slice(0, -1) || props.path.startsWith(p)) return true;
  }
  return false;
});

const el = ref<HTMLElement | null>(null);

// value -> DOM sync. Only write when the node exists, is in edit mode, and is
// NOT the active element: writing textContent on a focused contenteditable
// resets the caret, so we leave the user's in-progress text alone and let the
// @input handler own it. Matches T.tsx's `document.activeElement` guards and
// T.svelte's focus-guarded $effect.
function syncDom() {
  const node = el.value;
  const next = value.value;
  if (!node) return;
  if (!editMode.value) return;
  if (typeof document !== "undefined" && document.activeElement === node) return;
  if (node.textContent !== next) node.textContent = next;
}

// Resync whenever the value changes or we enter edit mode. nextTick covers the
// case where edit mode just turned on and the contenteditable element has only
// now been (re)created, so el.value points at the fresh node before we seed it.
watch(
  [value, editMode],
  () => {
    void nextTick(syncDom);
  },
  { flush: "post" },
);

// Seed the contenteditable's text on first mount in edit mode (SSR hydration or
// a page that loads already inside a draft). nextTick so the ref is populated.
onMounted(() => {
  void nextTick(syncDom);
});

function onInput(e: Event) {
  const text = (e.currentTarget as HTMLElement).textContent ?? "";
  // Single-line field: trim, matching T.tsx's non-multiline stage().
  store.addEdit(props.path, text.trim());
}

function onKeydown(e: KeyboardEvent) {
  // Single-line: Enter commits + blurs instead of inserting a newline.
  if (e.key === "Enter") {
    e.preventDefault();
    (e.currentTarget as HTMLElement).blur();
  }
}
</script>

<template>
  <!-- Edit mode: an EMPTY contenteditable. The focus-guarded watch above is the
       sole writer of its text - never bind {{ value }} here (caret bug). -->
  <component
    :is="as"
    v-if="editMode"
    ref="el"
    :data-cms-path="path"
    :data-cms-shared="shared ? 'true' : undefined"
    :title="
      shared
        ? 'Shared element - editing this changes it on every page that uses it'
        : undefined
    "
    :class="['cmsbar-editable', props.class]"
    contenteditable="true"
    role="textbox"
    tabindex="0"
    @input="onInput"
    @keydown="onKeydown"
  />
  <!-- View mode: a reactive {{ value }} child (no caret to clobber).
       data-cms-path only for an authenticated editor, so public HTML is inert. -->
  <component
    :is="as"
    v-else
    :data-cms-path="authenticated ? path : undefined"
    :data-cms-shared="authenticated && shared ? 'true' : undefined"
    :class="props.class"
    >{{ value }}</component
  >
</template>
