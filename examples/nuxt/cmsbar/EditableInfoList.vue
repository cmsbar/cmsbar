<script setup lang="ts">
// A repeatable list/block - the "Informacije" block - ported from
// template/components/cmsbar/EditableInfoList.tsx (mirroring the already-correct
// examples/sveltekit/src/cmsbar/EditableInfoList.svelte) to a Vue 3 SFC. Each
// item has an icon, a label and a value.
//
//   - View mode: a plain list. The "footer" variant linkifies email/phone values
//     and renders the label as a parenthetical; the default variant is an icon
//     box + label + value stack.
//   - Edit mode (active draft): per-item inline-editable label/value fields, an
//     icon picker (the curated 12-icon set), a per-row delete, a drag handle to
//     reorder, and an "Add item" button. Every mutation writes the whole array
//     back through the store's addEdit(path, ...).
//
// Icons: the React original imports lucide-react (React-only). This port reuses
// the inline-SVG icon registry (icons.ts) - the same lucide node arrays rendered
// through Icon.vue - so the icon vocabulary stays in lockstep with the React app
// without a lucide-vue dependency.
//
// Inline-editable fields use the local `v-inline` directive: it seeds the
// contenteditable's textContent on mount and resyncs only while the node is
// unfocused (mounted/updated guard on document.activeElement), so a re-render
// mid-edit never collapses the caret - the Vue analogue of the Svelte
// `{@attach inlineField}` / React InlineEditable reseed. Commit is blur-only.

import { computed, ref, type ObjectDirective } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { isSharedPath } from "@/lib/cmsbar/shared-paths";
import {
  ICON_NAMES,
  getIconNode,
  GRIP_VERTICAL,
  PLUS,
  X_MARK,
} from "@/cmsbar/icons";
import Icon from "@/cmsbar/Icon.vue";

type InfoItem = { icon: string; label: string; value: string };

const props = withDefaults(
  defineProps<{
    path: string;
    class?: string;
    iconSize?: number;
    swapOrder?: boolean;
    variant?: "default" | "footer";
  }>(),
  { swapOrder: false, variant: "default" },
);

const store = useCmsStore();

const items = computed(
  () => ((store.get(props.path) as InfoItem[] | undefined) ?? []) as InfoItem[],
);
const editMode = computed(() => store.editMode);
const authenticated = computed(() => store.cms.authenticated);
const shared = computed(() => isSharedPath(props.path));
const resolvedIconSize = computed(
  () => props.iconSize ?? (props.variant === "footer" ? 18 : 24),
);

// Drag-to-reorder state (editor only).
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);

// Per-row icon-picker open state, keyed by row index.
const pickerIndex = ref<number | null>(null);

function update(next: InfoItem[]) {
  store.addEdit(props.path, next);
}

function move(from: number, to: number) {
  const list = items.value;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  update(next);
}

function patchItem(i: number, patch: Partial<InfoItem>) {
  const next = items.value.slice();
  next[i] = { ...next[i], ...patch };
  update(next);
}

function removeItem(i: number) {
  const next = items.value.slice();
  next.splice(i, 1);
  update(next);
}

function addItem() {
  update([...items.value, { icon: "Clock", label: "Label", value: "Value" }]);
}

function isEmail(v: string) {
  return v.includes("@");
}
function isPhone(v: string) {
  return /^[\d\s+\-()]+$/.test(v.trim());
}

// Inline-editable commit: write trimmed textContent back when it changed
// (blur-only, mirroring InlineEditable in the React original).
function commitField(e: Event, i: number, field: "label" | "value") {
  const node = e.currentTarget as HTMLElement;
  const nextText = (node.textContent ?? "").trim();
  if (nextText !== items.value[i][field]) patchItem(i, { [field]: nextText });
}

function onFieldKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    (e.currentTarget as HTMLElement).blur();
  }
}

// value -> DOM sync for an inline-editable field. Seeds textContent on mount and
// resyncs only while the node is unfocused, so a re-render mid-edit never
// collapses the caret (same rule as T.vue / RichText.vue).
const vInline: ObjectDirective<HTMLElement, string> = {
  mounted(el, binding) {
    if (el.textContent !== binding.value) el.textContent = binding.value;
  },
  updated(el, binding) {
    if (typeof document !== "undefined" && document.activeElement === el) return;
    if (el.textContent !== binding.value) el.textContent = binding.value;
  },
};

function onDragOver(i: number) {
  if (overIndex.value !== i) overIndex.value = i;
}
function onDrop(i: number) {
  if (dragIndex.value !== null) move(dragIndex.value, i);
  dragIndex.value = null;
  overIndex.value = null;
}
function onDragEnd() {
  dragIndex.value = null;
  overIndex.value = null;
}
</script>

<template>
  <!-- View mode -->
  <div
    v-if="!editMode"
    :class="['cmsbar-info', props.class]"
    :data-cms-path="authenticated ? path : undefined"
    :data-cms-shared="authenticated && shared ? 'true' : undefined"
  >
    <template v-for="(it, i) in items" :key="i">
      <div
        v-if="variant === 'footer'"
        class="cmsbar-info-foot"
        :class="it.label ? 'is-start' : 'is-center'"
      >
        <span class="cmsbar-info-foot-icon">
          <Icon :node="getIconNode(it.icon)" :size="resolvedIconSize" />
        </span>
        <span>
          <a v-if="isEmail(it.value)" :href="`mailto:${it.value}`" class="cmsbar-info-link">{{ it.value }}</a>
          <a
            v-else-if="isPhone(it.value)"
            :href="`tel:${it.value.replace(/\s/g, '')}`"
            class="cmsbar-info-link"
            >{{ it.value }}</a
          >
          <template v-else>{{ it.value }}</template>
          <template v-if="it.label">
            <br />
            <span class="cmsbar-info-foot-label">({{ it.label }})</span>
          </template>
        </span>
      </div>
      <div v-else class="cmsbar-info-row">
        <div class="cmsbar-info-iconbox">
          <Icon :node="getIconNode(it.icon)" :size="resolvedIconSize" />
        </div>
        <div>
          <p class="cmsbar-info-label">{{ it.label }}</p>
          <p class="cmsbar-info-value">{{ it.value }}</p>
        </div>
      </div>
    </template>
  </div>

  <!-- Edit mode -->
  <div
    v-else
    :class="['cmsbar-info', props.class]"
    :data-cms-path="path"
    :data-cms-shared="shared ? 'true' : undefined"
  >
    <div
      v-for="(it, i) in items"
      :key="i"
      class="cmsbar-info-edit"
      :class="[
        dragIndex === i && 'is-dragging',
        overIndex === i && dragIndex !== null && dragIndex !== i && 'is-over',
      ]"
      role="listitem"
      @dragover.prevent="onDragOver(i)"
      @drop.prevent="onDrop(i)"
    >
      <button
        type="button"
        draggable="true"
        title="Drag to reorder"
        aria-label="Drag to reorder"
        class="cmsbar-info-grip"
        @dragstart="dragIndex = i"
        @dragend="onDragEnd"
      >
        <Icon :node="GRIP_VERTICAL" :size="16" />
      </button>

      <div class="cmsbar-info-pickwrap">
        <button
          type="button"
          :class="['cmsbar-info-iconbtn', pickerIndex === i && 'is-open']"
          title="Change icon"
          @click="pickerIndex = pickerIndex === i ? null : i"
        >
          <Icon :node="getIconNode(it.icon)" :size="resolvedIconSize" />
          <span class="cmsbar-info-iconbadge">✎</span>
        </button>
        <div v-if="pickerIndex === i" class="cmsbar-info-picker" data-cms-ui>
          <p class="cmsbar-info-picker-title">Choose an icon</p>
          <div class="cmsbar-info-picker-grid">
            <button
              v-for="name in ICON_NAMES"
              :key="name"
              type="button"
              :title="name"
              :class="['cmsbar-info-picker-cell', name === it.icon && 'is-selected']"
              @click="
                patchItem(i, { icon: name });
                pickerIndex = null;
              "
            >
              <Icon :node="getIconNode(name)" :size="18" />
            </button>
          </div>
        </div>
      </div>

      <div class="cmsbar-info-fields">
        <template v-if="swapOrder">
          <span
            v-inline="it.value"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            class="cmsbar-editable cmsbar-info-field cmsbar-info-value"
            @blur="commitField($event, i, 'value')"
            @keydown="onFieldKeydown"
          ></span>
          <span
            v-if="it.label"
            v-inline="it.label"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            class="cmsbar-editable cmsbar-info-field cmsbar-info-label"
            @blur="commitField($event, i, 'label')"
            @keydown="onFieldKeydown"
          ></span>
        </template>
        <template v-else>
          <span
            v-inline="it.label"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            class="cmsbar-editable cmsbar-info-field cmsbar-info-label"
            @blur="commitField($event, i, 'label')"
            @keydown="onFieldKeydown"
          ></span>
          <span
            v-inline="it.value"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            class="cmsbar-editable cmsbar-info-field cmsbar-info-value"
            @blur="commitField($event, i, 'value')"
            @keydown="onFieldKeydown"
          ></span>
        </template>
      </div>

      <button
        type="button"
        title="Remove item"
        aria-label="Remove item"
        class="cmsbar-info-delete"
        @click="removeItem(i)"
      >
        <Icon :node="X_MARK" :size="14" />
      </button>
    </div>

    <button type="button" class="cmsbar-info-add" @click="addItem">
      <Icon :node="PLUS" :size="16" /> Add item
    </button>
  </div>
</template>

<style>
.cmsbar-info {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── View: default variant ──────────────────────────────────────────────── */
.cmsbar-info-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}
.cmsbar-info-iconbox {
  padding: 0.5rem;
  border-radius: 0.5rem;
  color: var(--cmsbar-icon);
}
.cmsbar-info-label {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b; /* slate-500 */
  font-weight: 500;
}
.cmsbar-info-value {
  margin: 0;
  color: #1e293b; /* slate-800 */
  font-weight: 700;
}

/* ── View: footer variant ───────────────────────────────────────────────── */
.cmsbar-info-foot {
  display: flex;
  gap: 0.75rem;
}
.cmsbar-info-foot.is-start {
  align-items: flex-start;
}
.cmsbar-info-foot.is-center {
  align-items: center;
}
.cmsbar-info-foot-icon {
  flex-shrink: 0;
  color: var(--cmsbar-icon);
}
.cmsbar-info-foot-label {
  font-size: 0.75rem;
  color: #64748b;
}
.cmsbar-info-link {
  text-decoration: none;
}
.cmsbar-info-link:hover {
  text-decoration: underline;
}

/* ── Edit: rows ─────────────────────────────────────────────────────────── */
.cmsbar-info-edit {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  border-radius: 0.5rem;
  box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.5); /* dashed-ish blue-300 */
  padding: 0.25rem;
  transition:
    box-shadow 0.15s ease,
    opacity 0.15s ease;
}
.cmsbar-info-edit.is-dragging {
  opacity: 0.4;
}
.cmsbar-info-edit.is-over {
  box-shadow: 0 0 0 2px var(--cmsbar-info);
  background: var(--cmsbar-info-soft);
}
.cmsbar-info-grip {
  flex-shrink: 0;
  align-self: center;
  cursor: grab;
  border: 0;
  background: transparent;
  color: #cbd5e1; /* slate-300 */
  padding: 0;
  touch-action: none;
}
.cmsbar-info-grip:active {
  cursor: grabbing;
}
.cmsbar-info-grip:hover {
  color: #64748b;
}

/* Icon picker. */
.cmsbar-info-pickwrap {
  position: relative;
}
.cmsbar-info-iconbtn {
  position: relative;
  padding: 0.5rem;
  border-radius: 0.5rem;
  border: 0;
  cursor: pointer;
  background: transparent;
  color: var(--cmsbar-icon);
}
.cmsbar-info-iconbtn.is-open {
  box-shadow: 0 0 0 2px var(--cmsbar-info);
}
.cmsbar-info-iconbadge {
  position: absolute;
  bottom: -0.25rem;
  right: -0.25rem;
  background: var(--cmsbar-info);
  color: #fff;
  border-radius: 9999px;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  line-height: 1;
}
.cmsbar-info-picker {
  position: absolute;
  z-index: 20;
  top: 100%;
  margin-top: 0.5rem;
  left: 0;
  background: rgba(15, 23, 42, 1); /* slate-900 */
  color: #fff;
  padding: 0.75rem;
  border-radius: 0.75rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  width: 16rem;
}
.cmsbar-info-picker-title {
  margin: 0 0 0.5rem;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8; /* slate-400 */
}
.cmsbar-info-picker-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.25rem;
}
.cmsbar-info-picker-cell {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  cursor: pointer;
  background: transparent;
  color: #fff;
  border-radius: 0.375rem;
}
.cmsbar-info-picker-cell:hover {
  background: rgba(255, 255, 255, 0.1);
}
.cmsbar-info-picker-cell.is-selected {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 2px var(--cmsbar-info);
}

/* Inline-editable fields. */
.cmsbar-info-fields {
  flex: 1;
  min-width: 0;
}
.cmsbar-info-field {
  display: block;
}

/* Delete button. */
.cmsbar-info-delete {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: #fff;
  color: #64748b;
  border: 1px solid #e2e8f0; /* slate-200 */
  border-radius: 9999px;
  width: 1.5rem;
  height: 1.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  cursor: pointer;
}
.cmsbar-info-edit:hover .cmsbar-info-delete {
  opacity: 1;
}
.cmsbar-info-delete:hover {
  color: #ef4444; /* red-500 */
}

/* Add-item button. */
.cmsbar-info-add {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 2px dashed #cbd5e1; /* slate-300 */
  background: transparent;
  color: #64748b;
  border-radius: 0.75rem;
  padding: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}
.cmsbar-info-add:hover {
  border-color: var(--cmsbar-info);
  color: var(--cmsbar-info);
}
</style>
