<script setup lang="ts">
// Per-page issue panel, ported from template/components/cmsbar/IssuesPanel.tsx
// (mirroring IssuesPanel.svelte) to a Vue 3 SFC. Two tabs:
//   - New issue: title + WYSIWYG details + priority + scope, plus "pin an
//     element" mode that lets the editor click a [data-cms-path] element on the
//     page to attach it to the report; POSTs /issues.
//   - Issues: filterable/sortable list of cms-bar issues; PATCH /issues/:n.
// Issue data + reload + addIssue are owned by the bar and passed in as props (so
// the badge count and the panel share one list). Rendered via <Teleport to=body>
// + body-scroll lock. The WYSIWYG editor uses a template ref + watchers (the Vue
// analogue of the Svelte bind:this + $effect).

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import {
  PRIORITIES,
  visibleOnPage,
  type IssuePriority,
  type IssueScope,
  type IssueStatus,
  type ParsedIssue,
} from "@/lib/cmsbar/backend/issues";
import { mdToHtml, htmlToMd, type MdFormat } from "@/cmsbar/issuesMarkdown";

type Pinned = { path: string; shared: boolean };

const props = withDefaults(
  defineProps<{
    pathname: string;
    issues: ParsedIssue[];
    loading: boolean;
    refreshing?: boolean;
    error: string | null;
    reload: () => Promise<void>;
    addIssue: (issue: ParsedIssue) => void;
  }>(),
  { refreshing: false },
);

const emit = defineEmits<{ (e: "close"): void }>();

const store = useCmsStore();
const cms = computed(() => store.cms);

const PRIO_DOT: Record<IssuePriority, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};
const PRIO_RANK: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_BADGE: Record<IssueStatus, { label: string; cls: string }> = {
  open: { label: "● open", cls: "open" },
  "in-progress": { label: "◑ in progress", cls: "inprog" },
  closed: { label: "✓ closed", cls: "closed" },
};

const tab = ref<"new" | "list">("new");

// ── Pin mode ──────────────────────────────────────────────────────────
const pinning = ref(false);
const pinned = ref<Pinned | null>(null);

watch(pinning, (val, _old, onCleanup) => {
  document.body.classList.toggle("cms-pinning", val);
  if (!val) return;
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest("[data-cms-path]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    pinned.value = {
      path: el.getAttribute("data-cms-path") || "",
      shared: el.getAttribute("data-cms-shared") === "true",
    };
    pinning.value = false;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") pinning.value = false;
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  });
});

// ── New-issue form ────────────────────────────────────────────────────
const title = ref("");
const details = ref("");
const priority = ref<IssuePriority>("medium");
const everyPage = ref(false);
const editorIssue = ref(false);
const submitting = ref(false);
const submitError = ref<string | null>(null);

const inDraftMode = computed(() => !!cms.value.draft);
// Scope: "editor" overrides all; a pinned shared element forces "shared";
// otherwise the "affects every page" choice decides between page and shared.
const scope = computed<IssueScope>(() =>
  editorIssue.value
    ? "editor"
    : pinned.value?.shared || everyPage.value
      ? "shared"
      : "page",
);
const contentDisabled = computed(() => editorIssue.value);

async function submit() {
  if (!title.value.trim()) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const res = await cmsFetch("/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.value.trim(),
        details: details.value.trim(),
        priority: priority.value,
        scope: scope.value,
        page: props.pathname,
        pageUrl: window.location.href,
        elementPath: pinned.value?.path,
      }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { issue: ParsedIssue };
    props.addIssue(data.issue);
    title.value = "";
    details.value = "";
    pinned.value = null;
    everyPage.value = false;
    editorIssue.value = false;
    priority.value = "medium";
    await props.reload();
    tab.value = "list";
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}

async function changeStatus(n: number, status: IssueStatus) {
  try {
    const res = await cmsFetch(`/issues/${n}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await props.reload();
  } catch {
    /* surfaced via the list error on next reload */
  }
}

// ── Issue-list view state ─────────────────────────────────────────────
const scopeFilter = ref<"page" | "all">("page");
const statuses = ref<Set<IssueStatus>>(new Set(["open", "in-progress"]));
const sort = ref<"priority" | "recent">("priority");
const expanded = ref<number | null>(null);

function toggleStatus(s: IssueStatus) {
  const next = new Set(statuses.value);
  if (next.has(s)) next.delete(s);
  else next.add(s);
  statuses.value = next;
}

const visible = computed(() => {
  let list = props.issues.filter((i) => statuses.value.has(i.status));
  if (scopeFilter.value === "page")
    list = list.filter((i) => visibleOnPage(i, props.pathname));
  if (sort.value === "priority") {
    list = [...list].sort(
      (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority],
    );
  }
  return list;
});

function scopeTag(i: ParsedIssue): string {
  return i.scope === "shared"
    ? "🔗 shared · all pages"
    : i.scope === "toolbar"
      ? "🧰 toolbar · all pages"
      : i.scope === "editor"
        ? "🛠 CMS editor"
        : `📄 ${i.page ?? props.pathname}`;
}

function issueDesc(i: ParsedIssue): string {
  return i.body.split("---")[0].trim();
}

// ── WYSIWYG details editor (contenteditable) ──────────────────────────
const TOOLBAR_BTNS: {
  type: MdFormat;
  label: string;
  title: string;
  mono?: boolean;
}[] = [
  { type: "bold", label: "B", title: "Bold", mono: true },
  { type: "italic", label: "I", title: "Italic", mono: true },
  { type: "heading", label: "H", title: "Heading" },
  { type: "quote", label: "❝", title: "Blockquote" },
  { type: "link", label: "🔗", title: "Link" },
  { type: "ul", label: "•-", title: "Unordered list" },
  { type: "ol", label: "1.", title: "Ordered list", mono: true },
  { type: "checklist", label: "☐", title: "Checklist" },
];
const DIVIDER_BEFORE: Partial<Record<MdFormat, true>> = {
  heading: true,
  link: true,
  ul: true,
};

const editorEl = ref<HTMLDivElement | null>(null);
let lastMd = "";
let skipSync = false;
const isEmpty = ref(true);
const active = reactive<Record<MdFormat, boolean>>({
  bold: false,
  italic: false,
  heading: false,
  quote: false,
  link: false,
  ul: false,
  ol: false,
  checklist: false,
});

// Link-insertion bar
const showLinkBar = ref(false);
const linkUrl = ref("");
const linkInputEl = ref<HTMLInputElement | null>(null);
let savedRange: Range | null = null;

function closestEl(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node.nodeType === Node.TEXT_NODE
    ? node.parentElement
    : (node as Element);
}
function closestLi(): HTMLLIElement | null {
  return (
    (closestEl(window.getSelection()?.anchorNode)?.closest(
      "li",
    ) as HTMLLIElement) ?? null
  );
}
function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

function updateActive() {
  const el = editorEl.value;
  const sel = window.getSelection();
  if (!el || !sel || sel.rangeCount === 0) return;
  if (!el.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  const block = String(document.queryCommandValue("formatBlock") || "")
    .toLowerCase()
    .replace(/[<>]/g, "");
  const li = closestLi();
  const isTask = !!li?.classList.contains("task-item");
  const inUl = document.queryCommandState("insertUnorderedList");
  Object.assign(active, {
    bold: document.queryCommandState("bold"),
    italic: document.queryCommandState("italic"),
    heading: /^h[1-6]$/.test(block),
    quote: block === "blockquote",
    ol: document.queryCommandState("insertOrderedList"),
    ul: inUl && !isTask,
    checklist: isTask,
    link: !!closestEl(sel.anchorNode)?.closest("a"),
  });
}

// Init / re-init when the editor node mounts (tab switches unmount it).
watch(
  editorEl,
  (el) => {
    if (!el) return;
    el.innerHTML = mdToHtml(details.value) || "<p><br></p>";
    document.execCommand("defaultParagraphSeparator", false, "p");
    lastMd = details.value;
    isEmpty.value = !details.value.trim();
  },
  { flush: "post" },
);

// Sync external value changes (form reset after submit).
watch(details, (v) => {
  if (skipSync) return;
  if (v === lastMd) return;
  const el = editorEl.value;
  if (!el) return;
  el.innerHTML = mdToHtml(v) || "<p><br></p>";
  lastMd = v;
  isEmpty.value = !v.trim();
});

function fireChange() {
  const el = editorEl.value;
  if (!el) return;
  const md = htmlToMd(el.innerHTML);
  lastMd = md;
  skipSync = true;
  isEmpty.value = !md.trim();
  details.value = md;
  updateActive();
  requestAnimationFrame(() => {
    skipSync = false;
  });
}

function exec(cmd: string, arg?: string) {
  const el = editorEl.value;
  if (!el) return;
  el.focus();
  document.execCommand(cmd, false, arg);
  fireChange();
}

function handleLinkBtn() {
  const sel = window.getSelection();
  if (sel?.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
  linkUrl.value = "https://";
  showLinkBar.value = true;
  requestAnimationFrame(() => linkInputEl.value?.focus());
}

function commitLink() {
  const div = editorEl.value;
  if (!div) {
    showLinkBar.value = false;
    return;
  }
  const url = linkUrl.value.trim();
  if (!url || url === "https://") {
    showLinkBar.value = false;
    div.focus();
    return;
  }
  div.focus();
  const sel = window.getSelection();
  if (savedRange) {
    sel?.removeAllRanges();
    sel?.addRange(savedRange);
  }
  document.execCommand("createLink", false, url);
  showLinkBar.value = false;
  fireChange();
}

function applyFormat(type: MdFormat) {
  switch (type) {
    case "bold":
      exec("bold");
      break;
    case "italic":
      exec("italic");
      break;
    case "heading":
      exec("formatBlock", active.heading ? "p" : "h2");
      break;
    case "quote":
      exec("formatBlock", active.quote ? "p" : "blockquote");
      break;
    case "ul":
      exec("insertUnorderedList");
      break;
    case "ol":
      exec("insertOrderedList");
      break;
    case "link":
      handleLinkBtn();
      break;
    case "checklist": {
      const li = closestLi();
      if (li?.classList.contains("task-item")) {
        li.classList.remove("task-item");
        delete li.dataset.task;
        delete li.dataset.checked;
      } else {
        exec("insertUnorderedList");
        const newLi = closestLi();
        if (newLi) {
          newLi.classList.add("task-item");
          newLi.dataset.task = "true";
          newLi.dataset.checked = "false";
        }
      }
      fireChange();
      break;
    }
  }
}

function onEditorKeyDown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const bq = closestEl(sel?.anchorNode)?.closest(
      "blockquote",
    ) as HTMLElement | null;
    if (bq && range?.collapsed) {
      e.preventDefault();
      if ((bq.textContent ?? "").trim() === "") {
        const p = document.createElement("p");
        p.appendChild(document.createElement("br"));
        bq.replaceWith(p);
        placeCaret(p, 0);
      } else {
        const next = document.createElement("blockquote");
        next.appendChild(document.createElement("br"));
        bq.after(next);
        placeCaret(next, 0);
      }
      fireChange();
      return;
    }
    const li = closestLi();
    if (li?.classList.contains("task-item")) {
      setTimeout(() => {
        const newLi = closestLi();
        if (newLi && newLi !== li) {
          newLi.classList.add("task-item");
          newLi.dataset.task = "true";
          newLi.dataset.checked = "false";
          fireChange();
        }
      }, 0);
    }
  }
  if (e.key === "Escape" && showLinkBar.value) {
    showLinkBar.value = false;
    editorEl.value?.focus();
  }
}

function onEditorClick(e: MouseEvent) {
  const li = (e.target as HTMLElement).closest?.(
    "li.task-item",
  ) as HTMLElement | null;
  if (!li) return;
  const rect = li.getBoundingClientRect();
  if (e.clientX - rect.left <= 22) {
    li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
    fireChange();
  }
}

// Small casting helpers (keep input/select casts out of the template).
function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}
function isChecked(e: Event): boolean {
  return (e.target as HTMLInputElement).checked;
}
function onSortChange(e: Event) {
  sort.value = (e.target as HTMLSelectElement).value as "priority" | "recent";
}
function onLinkKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    commitLink();
  }
  if (e.key === "Escape") {
    showLinkBar.value = false;
    editorEl.value?.focus();
  }
}

let prevOverflow = "";
onMounted(() => {
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("selectionchange", updateActive);
});
onBeforeUnmount(() => {
  document.body.style.overflow = prevOverflow;
  document.body.classList.remove("cms-pinning");
  document.removeEventListener("selectionchange", updateActive);
});
</script>

<template>
  <Teleport to="body">
    <div class="cmsbar-ip-portal" data-cms-ui>
      <div v-if="pinning" class="cmsbar-ip-pinhint">
        🎯 Click a blue-outlined element to pin it.
        <button type="button" @click="pinning = false">cancel</button>
      </div>

      <div
        class="cmsbar-ip-overlay"
        :class="{ hidden: pinning }"
        role="presentation"
        @click="emit('close')"
      >
        <div
          class="cmsbar-ip-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Issues"
          tabindex="-1"
          @click.stop
          @keydown="(e) => e.key === 'Escape' && !showLinkBar && emit('close')"
        >
          <div class="cmsbar-ip-head">
            <div class="cmsbar-ip-tabs">
              <button
                type="button"
                class="cmsbar-ip-tab"
                :class="{ active: tab === 'new' }"
                @click="tab = 'new'"
              >
                ＋ New issue
              </button>
              <button
                type="button"
                class="cmsbar-ip-tab"
                :class="{ active: tab === 'list' }"
                @click="tab = 'list'"
              >
                Issues <span class="cmsbar-ip-dim">({{ issues.length }})</span>
              </button>
            </div>
            <button type="button" class="cmsbar-ip-x" aria-label="Close" @click="emit('close')">
              &#10005;
            </button>
          </div>

          <!-- ── New issue ──────────────────────────────────────────────── -->
          <div v-if="tab === 'new'" class="cmsbar-ip-form">
            <label
              class="cmsbar-ip-editorchk"
              :class="{ on: editorIssue, draftmode: inDraftMode }"
            >
              <input
                type="checkbox"
                :checked="editorIssue"
                @change="editorIssue = isChecked($event)"
              />
              <span>
                🛠 About the CMS editor / toolbar
                <span v-if="inDraftMode && !editorIssue" class="cmsbar-ip-editing"
                  >← you're editing</span
                >
              </span>
            </label>

            <div class="cmsbar-ip-context" :class="{ dim: contentDisabled }">
              <div class="cmsbar-ip-context-label">📍 Context</div>
              <div class="cmsbar-ip-context-row">
                <span class="cmsbar-ip-muted">Page</span>
                <span class="cmsbar-ip-strong">{{ pathname }}</span>
              </div>
              <div class="cmsbar-ip-context-row gap">
                <span class="cmsbar-ip-muted">Element</span>
                <span class="cmsbar-ip-mono">
                  {{ pinned ? pinned.path : "- none pinned -" }}
                </span>
              </div>
              <div v-if="pinned" class="cmsbar-ip-pinned">
                <span class="cmsbar-ip-pintag" :class="{ shared: pinned.shared }">
                  {{
                    pinned.shared
                      ? "🔗 shared - shows on every page"
                      : "📄 this page only"
                  }}
                </span>
              </div>
              <div class="cmsbar-ip-context-actions">
                <button
                  type="button"
                  class="cmsbar-ip-link"
                  :disabled="contentDisabled"
                  @click="pinning = true"
                >
                  🎯 {{ pinned ? "Pin a different element" : "Pin an element" }}
                </button>
                <button
                  v-if="pinned"
                  type="button"
                  class="cmsbar-ip-link gray"
                  @click="pinned = null"
                >
                  clear
                </button>
              </div>
            </div>

            <label class="cmsbar-ip-field">
              <span class="cmsbar-ip-fieldlabel">Title</span>
              <input
                class="cmsbar-ip-input"
                placeholder="Short summary of the problem"
                :value="title"
                @input="title = val($event)"
              />
            </label>

            <div class="cmsbar-ip-field">
              <span class="cmsbar-ip-fieldlabel">Details</span>
              <div class="cmsbar-ip-editor">
                <div class="cmsbar-ip-toolbar" data-cms-toolbar>
                  <div v-if="showLinkBar" class="cmsbar-ip-linkbar">
                    <span class="cmsbar-ip-linkicon">🔗</span>
                    <input
                      ref="linkInputEl"
                      v-model="linkUrl"
                      type="url"
                      class="cmsbar-ip-linkinput"
                      placeholder="https://"
                      @keydown="onLinkKeydown"
                    />
                    <button
                      type="button"
                      class="cmsbar-ip-linkgo"
                      @mousedown.prevent="commitLink"
                    >
                      Insert
                    </button>
                    <button
                      type="button"
                      class="cmsbar-ip-linkx"
                      @mousedown.prevent="
                        showLinkBar = false;
                        editorEl?.focus();
                      "
                    >
                      &#10005;
                    </button>
                  </div>
                  <template v-else>
                    <template v-for="btn in TOOLBAR_BTNS" :key="btn.type">
                      <span v-if="DIVIDER_BEFORE[btn.type]" class="cmsbar-ip-tbdiv"></span>
                      <button
                        type="button"
                        class="cmsbar-ip-tbbtn"
                        :class="{ mono: btn.mono, active: active[btn.type] }"
                        :title="btn.title"
                        :aria-pressed="active[btn.type]"
                        @mousedown.prevent="applyFormat(btn.type)"
                      >
                        {{ btn.label }}
                      </button>
                    </template>
                  </template>
                </div>
                <div class="cmsbar-ip-editarea">
                  <p v-if="isEmpty" class="cmsbar-ip-placeholder">
                    What's wrong, and what did you expect?
                  </p>
                  <div
                    ref="editorEl"
                    class="cmsbar-ip-contenteditable cmsbar-prose"
                    contenteditable="true"
                    role="textbox"
                    tabindex="0"
                    aria-multiline="true"
                    aria-label="Issue details"
                    @input="fireChange"
                    @keydown="onEditorKeyDown"
                    @click="onEditorClick"
                    @mouseup="updateActive"
                    @focus="updateActive"
                  ></div>
                </div>
              </div>
            </div>

            <div class="cmsbar-ip-field">
              <span class="cmsbar-ip-fieldlabel">Priority</span>
              <div class="cmsbar-ip-prio">
                <button
                  v-for="p in PRIORITIES"
                  :key="p"
                  type="button"
                  class="cmsbar-ip-priobtn"
                  :class="{ active: priority === p }"
                  @click="priority = p"
                >
                  {{ PRIO_DOT[p] }} {{ p }}
                </button>
              </div>
            </div>

            <label
              class="cmsbar-ip-everypage"
              :class="{ dim: contentDisabled || pinned?.shared }"
            >
              <input
                type="checkbox"
                :disabled="contentDisabled || pinned?.shared"
                :checked="scope === 'shared'"
                @change="everyPage = isChecked($event)"
              />
              Affects every page (shared / toolbar)
            </label>

            <div v-if="submitError" class="cmsbar-ip-submiterr">{{ submitError }}</div>

            <div class="cmsbar-ip-formactions">
              <button type="button" class="cmsbar-ip-cancel" @click="emit('close')">
                Cancel
              </button>
              <button
                type="button"
                class="cmsbar-ip-submit"
                :disabled="submitting || !title.trim()"
                @click="submit"
              >
                {{ submitting ? "Creating…" : "Create issue →" }}
              </button>
            </div>

            <p class="cmsbar-ip-formnote">
              Creates a GitHub issue labelled <code>cms-bar</code> + priority +
              scope. Page issues get <code>cms-page:{{ pathname }}</code>;
              shared/toolbar issues get <code>cms-scope:shared</code> and surface
              on every page.
            </p>
          </div>

          <!-- ── Issue list ─────────────────────────────────────────────── -->
          <div v-else class="cmsbar-ip-list">
            <div class="cmsbar-ip-filters">
              <div class="cmsbar-ip-filterrow">
                <span class="cmsbar-ip-muted">Show</span>
                <div class="cmsbar-ip-segment">
                  <button
                    v-for="s in (['page', 'all'] as const)"
                    :key="s"
                    type="button"
                    class="cmsbar-ip-segbtn"
                    :class="{ active: scopeFilter === s }"
                    @click="scopeFilter = s"
                  >
                    {{ s === "page" ? "This page" : "All" }}
                  </button>
                </div>
                <span class="cmsbar-ip-muted push">Sort</span>
                <select class="cmsbar-ip-select" :value="sort" @change="onSortChange">
                  <option value="priority">Priority</option>
                  <option value="recent">Most recent</option>
                </select>
              </div>
              <div class="cmsbar-ip-statusrow">
                <button
                  v-for="s in (['open', 'in-progress', 'closed'] as const)"
                  :key="s"
                  type="button"
                  class="cmsbar-ip-statusbtn"
                  :class="{ active: statuses.has(s) }"
                  @click="toggleStatus(s)"
                >
                  {{ STATUS_BADGE[s].label }}
                </button>
              </div>
            </div>

            <div class="cmsbar-ip-rows">
              <p v-if="refreshing && !loading" class="cmsbar-ip-refreshing">Refreshing…</p>
              <p v-if="loading" class="cmsbar-ip-emptymsg">Loading…</p>
              <p v-else-if="error" class="cmsbar-ip-errmsg">
                Couldn't load issues: {{ error }}
              </p>
              <p v-else-if="visible.length === 0" class="cmsbar-ip-emptymsg">
                No issues match these filters.
              </p>
              <template v-else>
                <div v-for="i in visible" :key="i.number" class="cmsbar-ip-row">
                  <div
                    class="cmsbar-ip-rowhead"
                    role="button"
                    tabindex="0"
                    @click="expanded = expanded === i.number ? null : i.number"
                    @keydown="
                      (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          expanded = expanded === i.number ? null : i.number;
                        }
                      }
                    "
                  >
                    <span>{{ PRIO_DOT[i.priority] }}</span>
                    <div class="cmsbar-ip-rowmain">
                      <div class="cmsbar-ip-rowtitle">
                        <span class="cmsbar-ip-rowname">{{ i.title }}</span>
                        <span class="cmsbar-ip-rownum">#{{ i.number }}</span>
                      </div>
                      <div class="cmsbar-ip-rowmeta">
                        <span v-if="i.elementPath" class="cmsbar-ip-mono"
                          >{{ i.elementPath }} · </span
                        >{{ scopeTag(i) }}
                      </div>
                    </div>
                    <span class="cmsbar-ip-status" :class="STATUS_BADGE[i.status].cls">
                      {{ STATUS_BADGE[i.status].label }}
                    </span>
                  </div>
                  <div v-if="expanded === i.number" class="cmsbar-ip-rowbody">
                    <p v-if="issueDesc(i)" class="cmsbar-ip-rowdesc">{{ issueDesc(i) }}</p>
                    <p v-else class="cmsbar-ip-rownodesc">no description</p>
                    <div class="cmsbar-ip-rowactions">
                      <button
                        v-if="i.status !== 'in-progress' && i.status !== 'closed'"
                        type="button"
                        class="cmsbar-ip-rowbtn"
                        @click="changeStatus(i.number, 'in-progress')"
                      >
                        ◑ Mark in progress
                      </button>
                      <button
                        v-if="i.status !== 'closed'"
                        type="button"
                        class="cmsbar-ip-rowbtn"
                        @click="changeStatus(i.number, 'closed')"
                      >
                        ✓ Close
                      </button>
                      <button
                        v-else
                        type="button"
                        class="cmsbar-ip-rowbtn"
                        @click="changeStatus(i.number, 'open')"
                      >
                        ↺ Reopen
                      </button>
                      <a
                        :href="i.htmlUrl"
                        target="_blank"
                        rel="noreferrer"
                        class="cmsbar-ip-rowbtn"
                        >Open in GitHub ↗</a
                      >
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <div class="cmsbar-ip-listfoot">
              {{
                scopeFilter === "page"
                  ? `${visible.length} shown · ${pathname} + site-wide`
                  : `${visible.length} shown · all pages`
              }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.cmsbar-ip-portal {
  font-family:
    ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #0f172a;
}
.cmsbar-ip-pinhint {
  position: fixed;
  bottom: 6rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 210;
  border-radius: 9999px;
  background: #2563eb;
  color: #fff;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}
.cmsbar-ip-pinhint button {
  margin-left: 0.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
  font: inherit;
}
.cmsbar-ip-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.4);
}
.cmsbar-ip-overlay.hidden {
  display: none;
}
.cmsbar-ip-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  max-width: 28rem;
  background: #fff;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
}
.cmsbar-ip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
}
.cmsbar-ip-tabs {
  display: flex;
  gap: 0.25rem;
  border-radius: 0.5rem;
  background: #f1f5f9;
  padding: 0.25rem;
  font-size: 0.875rem;
}
.cmsbar-ip-tab {
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0.25rem 0.75rem;
  font-weight: 500;
  color: #64748b;
  background: transparent;
  font: inherit;
}
.cmsbar-ip-tab.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.cmsbar-ip-dim {
  color: #94a3b8;
}
.cmsbar-ip-x {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1.125rem;
  color: #94a3b8;
}
.cmsbar-ip-x:hover {
  color: #334155;
}
.cmsbar-ip-form {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cmsbar-ip-editorchk {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #64748b;
  cursor: pointer;
}
.cmsbar-ip-editorchk.draftmode {
  border-color: #ddd6fe;
  background: rgba(245, 243, 255, 0.5);
}
.cmsbar-ip-editorchk.on {
  border-color: #a78bfa;
  background: #f5f3ff;
  color: #5b21b6;
}
.cmsbar-ip-editing {
  margin-left: 0.375rem;
  font-size: 10px;
  font-weight: 500;
  color: #8b5cf6;
}
.cmsbar-ip-context {
  border-radius: 0.5rem;
  background: #f8fafc;
  padding: 0.75rem;
  font-size: 0.875rem;
  box-shadow: inset 0 0 0 1px #e2e8f0;
}
.cmsbar-ip-context.dim {
  opacity: 0.4;
}
.cmsbar-ip-context-label {
  margin-bottom: 0.375rem;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}
.cmsbar-ip-context-row {
  display: flex;
  justify-content: space-between;
}
.cmsbar-ip-context-row.gap {
  margin-top: 0.25rem;
  gap: 0.75rem;
}
.cmsbar-ip-muted {
  color: #64748b;
}
.cmsbar-ip-strong {
  font-weight: 500;
}
.cmsbar-ip-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmsbar-ip-pinned {
  margin-top: 0.5rem;
}
.cmsbar-ip-pintag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--cmsbar-accent-soft);
  color: var(--cmsbar-accent);
}
.cmsbar-ip-pintag.shared {
  background: #fef3c7;
  color: #92400e;
}
.cmsbar-ip-context-actions {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.75rem;
}
.cmsbar-ip-link {
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  color: #2563eb;
}
.cmsbar-ip-link:hover {
  text-decoration: underline;
}
.cmsbar-ip-link:disabled {
  pointer-events: none;
  opacity: 0.5;
}
.cmsbar-ip-link.gray {
  color: #64748b;
}
.cmsbar-ip-field {
  display: block;
  font-size: 0.875rem;
}
.cmsbar-ip-fieldlabel {
  font-weight: 500;
  color: #475569;
}
.cmsbar-ip-input {
  margin-top: 0.25rem;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  outline: none;
  font-family: inherit;
}
.cmsbar-ip-input:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-ip-prio {
  margin-top: 0.375rem;
  display: flex;
  gap: 0.5rem;
}
.cmsbar-ip-priobtn {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  text-transform: capitalize;
  background: #fff;
  cursor: pointer;
  font-family: inherit;
}
.cmsbar-ip-priobtn.active {
  border-color: var(--cmsbar-accent);
  background: var(--cmsbar-accent-soft);
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-ip-everypage {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #475569;
}
.cmsbar-ip-everypage.dim {
  color: #94a3b8;
}
.cmsbar-ip-submiterr {
  border-radius: 0.375rem;
  background: #fef2f2;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #b91c1c;
}
.cmsbar-ip-formactions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.25rem;
}
.cmsbar-ip-cancel {
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #64748b;
  font: inherit;
}
.cmsbar-ip-cancel:hover {
  color: #1e293b;
}
.cmsbar-ip-submit {
  border: 0;
  cursor: pointer;
  border-radius: 0.375rem;
  background: var(--cmsbar-accent);
  color: #fff;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: inherit;
}
.cmsbar-ip-submit:hover:not(:disabled) {
  background: var(--cmsbar-accent-strong);
}
.cmsbar-ip-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
.cmsbar-ip-formnote {
  border-top: 1px solid #e2e8f0;
  padding-top: 0.75rem;
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: #94a3b8;
}
.cmsbar-ip-formnote code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cmsbar-ip-editor {
  margin-top: 0.25rem;
}
.cmsbar-ip-toolbar {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  border: 1px solid #cbd5e1;
  border-bottom: 0;
  border-radius: 0.375rem 0.375rem 0 0;
  background: #f8fafc;
  padding: 0.25rem 0.375rem;
  min-height: 2rem;
}
.cmsbar-ip-tbdiv {
  margin: 0 0.25rem;
  height: 0.875rem;
  width: 1px;
  flex-shrink: 0;
  background: #cbd5e1;
}
.cmsbar-ip-tbbtn {
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.75rem;
  color: #475569;
  background: transparent;
  font-family: inherit;
}
.cmsbar-ip-tbbtn:hover {
  background: #e2e8f0;
}
.cmsbar-ip-tbbtn.mono {
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cmsbar-ip-tbbtn.active {
  background: var(--cmsbar-accent);
  color: #fff;
}
.cmsbar-ip-linkbar {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.375rem;
}
.cmsbar-ip-linkicon {
  font-size: 0.75rem;
  color: #94a3b8;
}
.cmsbar-ip-linkinput {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  outline: none;
  font-family: inherit;
}
.cmsbar-ip-linkinput:focus {
  box-shadow: 0 0 0 1px #3b82f6;
}
.cmsbar-ip-linkgo {
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  background: #2563eb;
  color: #fff;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
}
.cmsbar-ip-linkgo:hover {
  background: #1d4ed8;
}
.cmsbar-ip-linkx {
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
  font-size: 0.75rem;
  color: #94a3b8;
}
.cmsbar-ip-linkx:hover {
  background: #e2e8f0;
}
.cmsbar-ip-editarea {
  position: relative;
}
.cmsbar-ip-placeholder {
  pointer-events: none;
  position: absolute;
  left: 0.75rem;
  top: 0.5rem;
  margin: 0;
  font-size: 0.875rem;
  color: #94a3b8;
  user-select: none;
}
.cmsbar-ip-contenteditable {
  min-height: 8rem;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 0 0 0.375rem 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  outline: none;
}
.cmsbar-ip-contenteditable:focus {
  box-shadow: 0 0 0 2px var(--cmsbar-accent);
}
.cmsbar-ip-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.cmsbar-ip-filters {
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1.25rem;
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.cmsbar-ip-filterrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cmsbar-ip-segment {
  display: flex;
  border-radius: 0.375rem;
  background: #f1f5f9;
  padding: 0.125rem;
}
.cmsbar-ip-segbtn {
  border: 0;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: #64748b;
  background: transparent;
  font-family: inherit;
}
.cmsbar-ip-segbtn.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.push {
  margin-left: auto;
}
.cmsbar-ip-select {
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-family: inherit;
}
.cmsbar-ip-statusrow {
  display: flex;
  gap: 0.375rem;
}
.cmsbar-ip-statusbtn {
  border: 1px solid #cbd5e1;
  cursor: pointer;
  border-radius: 9999px;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  color: #64748b;
  background: #fff;
  font-family: inherit;
}
.cmsbar-ip-statusbtn.active {
  border-color: #0f172a;
  background: #0f172a;
  color: #fff;
}
.cmsbar-ip-rows {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}
.cmsbar-ip-rows > * + * {
  border-top: 1px solid #e2e8f0;
}
.cmsbar-ip-refreshing {
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 0.375rem 1.25rem;
  text-align: center;
  font-size: 0.75rem;
  color: #94a3b8;
  margin: 0;
}
.cmsbar-ip-emptymsg {
  padding: 2rem;
  text-align: center;
  font-size: 0.875rem;
  color: #94a3b8;
  margin: 0;
}
.cmsbar-ip-errmsg {
  padding: 1.25rem;
  font-size: 0.875rem;
  color: #dc2626;
  margin: 0;
}
.cmsbar-ip-row {
  padding: 0.75rem 1.25rem;
}
.cmsbar-ip-row:hover {
  background: #f8fafc;
}
.cmsbar-ip-rowhead {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}
.cmsbar-ip-rowmain {
  min-width: 0;
  flex: 1;
}
.cmsbar-ip-rowtitle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cmsbar-ip-rowname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: #1e293b;
}
.cmsbar-ip-rownum {
  font-size: 0.75rem;
  color: #94a3b8;
}
.cmsbar-ip-rowmeta {
  margin-top: 0.125rem;
  font-size: 11px;
  color: #64748b;
}
.cmsbar-ip-status {
  white-space: nowrap;
  font-size: 0.75rem;
}
.cmsbar-ip-status.open {
  color: #059669;
}
.cmsbar-ip-status.inprog {
  color: #2563eb;
}
.cmsbar-ip-status.closed {
  color: #94a3b8;
}
.cmsbar-ip-rowbody {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #475569;
}
.cmsbar-ip-rowdesc {
  margin: 0 0 0.5rem;
  white-space: pre-wrap;
}
.cmsbar-ip-rownodesc {
  margin: 0 0 0.5rem;
  font-style: italic;
  color: #94a3b8;
}
.cmsbar-ip-rowactions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.cmsbar-ip-rowbtn {
  border: 1px solid #cbd5e1;
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: #fff;
  color: #334155;
  text-decoration: none;
  font-family: inherit;
}
.cmsbar-ip-rowbtn:hover {
  background: #f1f5f9;
}
.cmsbar-ip-listfoot {
  border-top: 1px solid #e2e8f0;
  padding: 0.625rem 1.25rem;
  font-size: 0.75rem;
  color: #64748b;
}
</style>
