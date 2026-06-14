<script setup lang="ts">
// The editor bar, ported from template/components/cmsbar/CmsBar.tsx (mirroring
// examples/sveltekit/src/cmsbar/CmsBar.svelte) to a Vue 3 SFC. V5 wires in the
// remaining drawers/panels - Versions, Issues (with a per-page open-count badge),
// Settings, Page meta, and the opt-in guided Tour - matching CmsBar.tsx's layout
// and conditions (Versions hidden in direct mode; the Tour button only when
// cmsConfig.tour has steps; the shared-highlight toggle in draft mode).
//
// States:
//   - !authenticated  -> inline login form (POST /login, then full reload so the
//                        server re-reads the fresh session cookie).
//   - preview         -> read-only preview banner + bar (review-flow Save lands
//                        here against the just-saved branch).
//   - authenticated, no draft -> "Live site" bar with Edit/New-draft.
//   - authenticated, active draft -> top strip + bar with Save + Discard,
//                        pendingCount, the direct "Published" notice, errors, and
//                        the 401 "session expired" recovery message.
//
// Direct vs review publishing changes the verbs and the post-Save behaviour.

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";
import { cmsConfig } from "@/cms.config";
import { publishingMode } from "@/lib/cmsbar/config";
import { pageNameForPath } from "@/lib/cmsbar/pageName";
import { visibleOnPage, type ParsedIssue } from "@/lib/cmsbar/backend/issues";
import VersionsDialog from "@/cmsbar/VersionsDialog.vue";
import PageMetaDrawer from "@/cmsbar/PageMetaDrawer.vue";
import SettingsDrawer from "@/cmsbar/SettingsDrawer.vue";
import IssuesPanel from "@/cmsbar/IssuesPanel.vue";
import CmsTour, { TOUR_OPEN_EVENT } from "@/cmsbar/CmsTour.vue";

const store = useCmsStore();

// Direct publishing: saves commit straight to the base branch - no draft branch,
// no PR, no preview. Review-flow affordances are hidden.
const DIRECT = publishingMode(cmsConfig) === "direct";
// Guided tour is opt-in: sites without `tour` config get no button, no overlay.
const TOUR_ENABLED = (cmsConfig.tour?.steps.length ?? 0) > 0;

// Reactive current path (matches React's useHost().pathname). Falls back to "/"
// during SSR.
const route = useRoute();
const pathname = computed(() => route.path || "/");

// Reactive store reads.
const cms = computed(() => store.cms);
const pendingCount = computed(() => store.pendingCount);

const busy = ref<"saving" | "starting" | null>(null);
const error = ref<string | null>(null);
// Transient confirmation after a direct publish (auto-clears).
const notice = ref<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// Drawer/panel open flags.
const versionsOpen = ref(false);
const metaOpen = ref(false);
const settingsOpen = ref(false);
const highlightShared = ref(false);

// Login form state.
const username = ref("");
const password = ref("");
const loginError = ref<string | null>(null);
const loginBusy = ref(false);

// Toggle the body class that lights up every shared element on the page, so an
// editor can see at a glance what ripples site-wide before touching it.
watch(highlightShared, (on) => {
  document.body.classList.toggle("cms-highlight-shared", on);
});

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
  if (typeof document !== "undefined")
    document.body.classList.remove("cms-highlight-shared");
});

function flashNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 6000);
}

// ── Issues button state (owned here, mirroring IssuesButton.tsx) ──────────
// Lives in the bar so the per-page open-count badge and the panel share one
// list. GitHub's label-filtered list can lag seconds behind a create, so keep
// just-created issues pinned until a reload sees them.
const issuesOpen = ref(false);
const issues = ref<ParsedIssue[]>([]);
const issuesLoading = ref(false);
const issuesRefreshing = ref(false);
const issuesError = ref<string | null>(null);
const issuesLoadedOnce = ref(false);
const pendingIssueNums = new Set<number>();
let issuesInitialLoadDone = false;

function mergeWithPending(
  fetched: ParsedIssue[],
  prev: ParsedIssue[],
): ParsedIssue[] {
  const fetchedNums = new Set(fetched.map((i) => i.number));
  for (const n of fetchedNums) pendingIssueNums.delete(n);
  const extra = prev.filter(
    (i) => pendingIssueNums.has(i.number) && !fetchedNums.has(i.number),
  );
  return [...extra, ...fetched];
}

function addIssue(issue: ParsedIssue) {
  pendingIssueNums.add(issue.number);
  const rest = issues.value.filter((i) => i.number !== issue.number);
  issues.value = [issue, ...rest];
}

async function reloadIssues() {
  if (!issuesInitialLoadDone) issuesLoading.value = true;
  else issuesRefreshing.value = true;
  issuesError.value = null;
  try {
    const res = await cmsFetch("/issues", { cache: "no-store" });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { issues: ParsedIssue[] };
    issues.value = mergeWithPending(data.issues, issues.value);
  } catch (e) {
    issuesError.value = e instanceof Error ? e.message : String(e);
  } finally {
    issuesLoading.value = false;
    issuesRefreshing.value = false;
    issuesInitialLoadDone = true;
    issuesLoadedOnce.value = true;
  }
}

// Fetch once on mount for the badge count (authenticated editors only).
onMounted(() => {
  if (store.cms.authenticated) void reloadIssues();
});

const issuesCount = computed(() =>
  issuesLoadedOnce.value
    ? issues.value.filter(
        (i) => i.status !== "closed" && visibleOnPage(i, pathname.value),
      ).length
    : 0,
);

function openIssues() {
  issuesOpen.value = true;
  void reloadIssues();
}

function openTour() {
  window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT));
}

async function login(e: Event) {
  e.preventDefault();
  loginError.value = null;
  loginBusy.value = true;
  try {
    const res = await cmsFetch("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      loginError.value = body.error || "Login failed";
      loginBusy.value = false;
      return;
    }
    // Full-page navigation so the server re-reads the new session cookie.
    window.location.assign(pathname.value);
  } catch (err) {
    loginError.value = String(err);
    loginBusy.value = false;
  }
}

async function logout() {
  await cmsFetch("/logout", { method: "POST" });
  window.location.reload();
}

async function startDraft() {
  busy.value = "starting";
  error.value = null;
  try {
    const title = pageNameForPath(pathname.value);
    const res = await cmsFetch("/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, pagePath: pathname.value }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || `HTTP ${res.status}`);
    }
    window.location.reload();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = null;
  }
}

async function forkDraft(fromBranch: string, fromTitle: string | undefined) {
  busy.value = "starting";
  error.value = null;
  try {
    const base = fromTitle?.trim() || pageNameForPath(pathname.value);
    const title = /\(fork\)$/i.test(base) ? base : `${base} (fork)`;
    const res = await cmsFetch("/session/fork", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromBranch, title }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || `HTTP ${res.status}`);
    }
    window.location.reload();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = null;
  }
}

function forkFromPreview() {
  const p = cms.value.preview;
  if (p) void forkDraft(p.branch, p.title);
}
function forkFromDraft() {
  const d = cms.value.draft;
  if (d) void forkDraft(d.branch, d.title);
}

async function exitDraft() {
  if (
    pendingCount.value > 0 &&
    !confirm("Discard pending changes and exit this draft?")
  )
    return;
  store.discardAll();
  await cmsFetch("/session/clear", { method: "POST" });
  try {
    localStorage.removeItem(PREVIEW_LS_KEY);
  } catch {
    /* SSR / quota */
  }
  window.location.reload();
}

async function editPreviewVersion() {
  const p = cms.value.preview;
  if (!p) return;
  const res = await cmsFetch("/session/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branch: p.branch, title: p.title }),
  });
  const data = (await res.json().catch(() => ({}))) as { pagePath?: string };
  try {
    localStorage.removeItem(PREVIEW_LS_KEY);
  } catch {
    /* SSR */
  }
  const target = data.pagePath;
  if (target && target !== pathname.value) {
    window.location.href = target;
  } else {
    window.location.reload();
  }
}

async function save() {
  if (pendingCount.value === 0 || !cms.value.draft) return;
  busy.value = "saving";
  error.value = null;
  try {
    const res = await cmsFetch("/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        edits: store.pendingEdits,
        uploads: [],
        folders: store.pendingFolders,
        deletes: store.pendingDeletes,
      }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) {
        // A 12h session can lapse mid-edit. Make recovery obvious and reassure
        // that work isn't lost - pending edits are kept on this device and
        // reattach to the next session after logging back in.
        throw new Error(
          "Your session expired - log in again, then your edits are still here. Your unsaved changes are kept on this device.",
        );
      }
      throw new Error(b.error || `Save failed (HTTP ${res.status})`);
    }
    const result = (await res.json()) as {
      direct?: boolean;
      branch?: string;
      prUrl?: string;
      prError?: string;
      branchUrl?: string;
    };
    if (result.direct) {
      // Direct publish: the commit already landed on the live branch. Stay in
      // edit mode (no PR, no preview branch) and confirm inline.
      store.applyCommitted();
      flashNotice(
        `Published - the site redeploys from ${result.branch ?? "the live branch"}`,
      );
      return;
    }
    store.applyCommitted({ prUrl: result.prUrl });
    // Review flow: switch into preview against the just-saved branch so the
    // editor sees the rendered result without the editing outlines.
    if (cms.value.draft) {
      void store.setPreview({
        branch: cms.value.draft.branch,
        title: cms.value.draft.title,
      });
    }
    if (result.prError) {
      error.value = `Commit succeeded but PR creation failed: ${result.prError}. Branch URL: ${result.branchUrl}`;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = null;
  }
}

// The approval lock is a review-flow concept; in direct mode there is no PR to
// approve, so it must never render (or block saving).
const approved = computed(() => !DIRECT && !!cms.value.draftApproved);
const canEdit = computed(() => !!cms.value.draft && !approved.value);
</script>

<template>
  <!-- ── Login (inline form) ─────────────────────────────────────────────── -->
  <form v-if="!cms.authenticated" class="cmsbar-login" data-cms-login @submit="login">
    <h2>CMSBar login</h2>
    <input
      v-model="username"
      type="text"
      placeholder="Username"
      autocomplete="username"
      required
    />
    <input
      v-model="password"
      type="password"
      placeholder="Password"
      autocomplete="current-password"
      required
    />
    <p v-if="loginError" class="cmsbar-login-error">{{ loginError }}</p>
    <button type="submit" :disabled="loginBusy">
      {{ loginBusy ? "Signing in…" : "Sign in" }}
    </button>
  </form>

  <!-- ── Preview banner (review-flow Save lands here) ─────────────────────── -->
  <template v-else-if="cms.preview">
    <div class="cmsbar-preview-banner" data-cms-preview>
      <span>Previewing draft:</span>
      <strong>{{ cms.preview.title ?? cms.preview.branch }}</strong>
      <span v-if="cms.preview.approved" class="cmsbar-badge cmsbar-badge-live"
        >approved - read-only</span
      >
      <button type="button" @click="store.setPreview(null)">Exit preview</button>
    </div>
    <div class="cmsbar-bar" data-cms-bar>
      <span class="cmsbar-brand">CMSBar</span>
      <span class="cmsbar-badge cmsbar-badge-preview">Preview</span>
      <span class="cmsbar-divider" />
      <button
        v-if="!cms.preview.approved"
        type="button"
        class="cmsbar-btn cmsbar-btn-primary"
        title="Switch your active draft to this PR and continue editing it"
        @click="editPreviewVersion"
      >
        Edit this version
      </button>
      <button type="button" class="cmsbar-btn" @click="store.setPreview(null)">
        Exit preview
      </button>
      <button
        type="button"
        class="cmsbar-btn"
        title="Create a new draft branched from this one"
        @click="forkFromPreview"
      >
        Fork
      </button>
      <button
        v-if="!DIRECT"
        type="button"
        class="cmsbar-btn"
        @click="versionsOpen = true"
      >
        Versions
      </button>
      <span class="cmsbar-divider" />
      <button
        type="button"
        class="cmsbar-btn cmsbar-btn-issues"
        title="Report or browse issues for this page"
        @click="openIssues"
      >
        🐛 Issues
        <span v-if="issuesCount > 0" class="cmsbar-issue-badge">{{ issuesCount }}</span>
      </button>
      <span class="cmsbar-divider" />
      <button type="button" class="cmsbar-btn" @click="logout">Log out</button>
    </div>
  </template>

  <!-- ── Live site (no active draft) ──────────────────────────────────────── -->
  <div v-else-if="!cms.draft" class="cmsbar-bar" data-cms-bar>
    <span class="cmsbar-brand">CMSBar</span>
    <span class="cmsbar-badge cmsbar-badge-live">Live site</span>
    <span class="cmsbar-divider" />
    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-primary"
      :disabled="busy === 'starting'"
      :title="
        DIRECT
          ? 'Direct publishing: saves commit straight to the live branch'
          : `Will create a draft named &quot;${pageNameForPath(pathname)}&quot;`
      "
      @click="startDraft"
    >
      {{ busy === "starting" ? "Starting…" : DIRECT ? "Edit site" : "New draft" }}
    </button>
    <button
      v-if="!DIRECT"
      type="button"
      class="cmsbar-btn"
      @click="versionsOpen = true"
    >
      Versions
    </button>
    <button
      v-if="TOUR_ENABLED"
      type="button"
      class="cmsbar-btn"
      title="Replay the guided tour"
      @click="openTour"
    >
      ✦ Guide
    </button>
    <span class="cmsbar-divider" />
    <button
      type="button"
      class="cmsbar-btn"
      title="Preview SEO / page metadata (read-only without a draft)"
      @click="metaOpen = true"
    >
      🔎 Page meta
    </button>
    <button
      type="button"
      class="cmsbar-btn"
      title="Preview site settings (read-only without a draft)"
      @click="settingsOpen = true"
    >
      ⚙️ Settings
    </button>
    <span class="cmsbar-divider" />
    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-issues"
      title="Report or browse issues for this page"
      @click="openIssues"
    >
      🐛 Issues
      <span v-if="issuesCount > 0" class="cmsbar-issue-badge">{{ issuesCount }}</span>
    </button>
    <span class="cmsbar-divider" />
    <button type="button" class="cmsbar-btn" @click="logout">Log out</button>
  </div>

  <!-- ── Active draft ─────────────────────────────────────────────────────── -->
  <template v-else>
    <div
      class="cmsbar-strip"
      :style="
        approved
          ? 'background: #059669;'
          : DIRECT
            ? 'background: #d97706;'
            : undefined
      "
    >
      <span>
        {{
          approved
            ? "Approved draft (read-only):"
            : DIRECT
              ? "Editing live site:"
              : "Editing draft:"
        }}
      </span>
      <strong>{{ cms.draft.title }}</strong>
      <span v-if="!approved && pendingCount > 0" class="cmsbar-strip-count"
        >{{ pendingCount }} unsaved</span
      >
    </div>

    <div v-if="error" class="cmsbar-error">
      <div class="cmsbar-error-msg">{{ error }}</div>
      <button type="button" aria-label="Dismiss" @click="error = null">✕</button>
    </div>

    <div class="cmsbar-bar" data-cms-bar>
      <span class="cmsbar-brand">CMSBar</span>
      <span
        class="cmsbar-badge"
        :class="
          approved
            ? 'cmsbar-badge-live'
            : DIRECT
              ? 'cmsbar-badge-direct'
              : 'cmsbar-badge-draft'
        "
        >{{ approved ? "Approved" : DIRECT ? "Direct" : "Draft" }}</span
      >
      <span class="cmsbar-title" :title="cms.draft.title">{{ cms.draft.title }}</span>
      <span class="cmsbar-divider" />

      <button
        v-if="approved"
        type="button"
        class="cmsbar-btn cmsbar-btn-primary"
        :disabled="busy === 'starting'"
        title="This draft is locked - fork it to keep editing"
        @click="forkFromDraft"
      >
        {{ busy === "starting" ? "Forking…" : "Fork" }}
      </button>
      <button
        v-else
        type="button"
        class="cmsbar-btn cmsbar-btn-primary"
        :disabled="pendingCount === 0 || busy !== null"
        :title="
          pendingCount === 0
            ? 'No changes to save'
            : DIRECT
              ? `Publish ${pendingCount} change(s) straight to the live branch`
              : `Save ${pendingCount} change(s)`
        "
        @click="save"
      >
        {{
          busy === "saving"
            ? DIRECT
              ? "Publishing…"
              : "Saving…"
            : DIRECT
              ? "Publish"
              : "Save"
        }}
      </button>
      <span v-if="notice" class="cmsbar-notice" :title="notice">✓ {{ notice }}</span>

      <button
        type="button"
        class="cmsbar-btn"
        title="Discard this draft and return to the live site"
        @click="exitDraft"
      >
        Discard draft
      </button>

      <span class="cmsbar-divider" />

      <button
        type="button"
        class="cmsbar-btn"
        :title="
          approved
            ? 'View SEO / page metadata (read-only)'
            : 'Edit SEO / page metadata'
        "
        @click="metaOpen = true"
      >
        🔎 Page meta
      </button>
      <button
        type="button"
        class="cmsbar-btn"
        title="Site settings"
        @click="settingsOpen = true"
      >
        ⚙️ Settings
      </button>

      <span class="cmsbar-divider" />

      <button
        type="button"
        class="cmsbar-btn cmsbar-btn-issues"
        title="Report or browse issues for this page"
        @click="openIssues"
      >
        🐛 Issues
        <span v-if="issuesCount > 0" class="cmsbar-issue-badge">{{ issuesCount }}</span>
      </button>
      <button
        type="button"
        class="cmsbar-btn"
        :class="{ 'cmsbar-btn-shared': highlightShared }"
        title="Highlight every element that appears on more than one page"
        @click="highlightShared = !highlightShared"
      >
        🔗 Shared
      </button>
      <button
        v-if="TOUR_ENABLED"
        type="button"
        class="cmsbar-btn"
        title="Replay the guided tour"
        @click="openTour"
      >
        ✦ Guide
      </button>

      <span class="cmsbar-divider" />
      <button type="button" class="cmsbar-btn" @click="logout">Log out</button>
    </div>
  </template>

  <!-- ── Drawers / panels / tour (rendered for any authenticated state) ────── -->
  <template v-if="cms.authenticated">
    <VersionsDialog
      v-if="versionsOpen"
      @close="versionsOpen = false"
      @fork="
        (branch, title) => {
          versionsOpen = false;
          forkDraft(branch, title);
        }
      "
    />
    <PageMetaDrawer v-if="metaOpen" :can-edit="canEdit" @close="metaOpen = false" />
    <SettingsDrawer
      v-if="settingsOpen"
      :can-edit="canEdit"
      :highlight-shared="highlightShared"
      :can-toggle-highlight="canEdit"
      @close="settingsOpen = false"
      @toggle-highlight="highlightShared = !highlightShared"
    />
    <IssuesPanel
      v-if="issuesOpen"
      :pathname="pathname"
      :issues="issues"
      :loading="issuesLoading && issues.length === 0"
      :refreshing="issuesRefreshing"
      :error="issuesError"
      :reload="reloadIssues"
      :add-issue="addIssue"
      @close="issuesOpen = false"
    />
    <CmsTour v-if="TOUR_ENABLED" />
  </template>
</template>

<style>
/* Issues button badge (the open-count pill, mirroring IssuesButton.tsx). */
.cmsbar-btn-issues {
  position: relative;
}
.cmsbar-issue-badge {
  position: absolute;
  right: -0.375rem;
  top: -0.375rem;
  display: grid;
  place-items: center;
  height: 1rem;
  min-width: 1rem;
  border-radius: 9999px;
  background: var(--cmsbar-accent);
  padding: 0 0.25rem;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
}
/* Active shared-highlight toggle. */
.cmsbar-btn-shared {
  background: var(--cmsbar-shared-soft);
  color: var(--cmsbar-shared-text);
}
</style>
