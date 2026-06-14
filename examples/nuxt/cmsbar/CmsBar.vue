<script setup lang="ts">
// The editor bar, ported from template/components/cmsbar/CmsBar.tsx (mirroring
// examples/sveltekit/src/cmsbar/CmsBar.svelte) to a Vue 3 SFC. V2 ports the
// CORE edit loop only; the remaining drawers/panels - Versions, Issues,
// Settings, Page meta, and the guided Tour - are deferred to V5.
//
// States:
//   - !authenticated  -> inline login form (POST /login, then full reload so
//                        the server re-reads the fresh session cookie).
//   - preview         -> read-only preview banner + bar (review-flow Save
//                        lands here against the just-saved branch).
//   - authenticated, no draft -> "Live site" bar with Edit/New-draft.
//   - authenticated, active draft -> top strip + bar with Save + Discard,
//                        pendingCount, the direct "Published" notice, errors,
//                        and the 401 "session expired" recovery message.
//
// Direct vs review publishing changes the verbs and the post-Save behaviour,
// exactly as in CmsBar.tsx / CmsBar.svelte.

import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import { useCmsStore } from "@/cmsbar/content";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";
import { cmsConfig } from "@/cms.config";
import { publishingMode } from "@/lib/cmsbar/config";
import { pageNameForPath } from "@/lib/cmsbar/pageName";

const store = useCmsStore();

// Direct publishing: saves commit straight to the base branch - no draft
// branch, no PR, no preview. Review-flow affordances are hidden.
const DIRECT = publishingMode(cmsConfig) === "direct";

// Reactive current path (matches React's useHost().pathname; the Svelte version
// read $app/state.page). Falls back to "/" during SSR.
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

// Login form state.
const username = ref("");
const password = ref("");
const loginError = ref<string | null>(null);
const loginBusy = ref(false);

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
});

function flashNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 6000);
}

async function login(e: Event) {
  e.preventDefault();
  loginError.value = null;
  loginBusy.value = true;
  try {
    const res = await cmsFetch("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
      }),
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

async function save() {
  if (pendingCount.value === 0 || !cms.value.draft) return;
  busy.value = "saving";
  error.value = null;
  try {
    // V2 stages text edits only; uploads/folders/deletes arrive with the media
    // phase, so they go up as the store's (empty) pending lists for now.
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
</script>

<template>
  <!-- ── Login (inline form) ─────────────────────────────────────────────── -->
  <form
    v-if="!cms.authenticated"
    class="cmsbar-login"
    data-cms-login
    @submit="login"
  >
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
      <button type="button" @click="store.setPreview(null)">Exit preview</button>
    </div>
    <div class="cmsbar-bar" data-cms-bar>
      <span class="cmsbar-brand">CMSBar</span>
      <span class="cmsbar-badge cmsbar-badge-preview">Preview</span>
      <span class="cmsbar-divider" />
      <button type="button" class="cmsbar-btn" @click="store.setPreview(null)">
        Exit preview
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
      {{
        busy === "starting" ? "Starting…" : DIRECT ? "Edit site" : "New draft"
      }}
    </button>
    <span class="cmsbar-divider" />
    <button type="button" class="cmsbar-btn" @click="logout">Log out</button>
  </div>

  <!-- ── Active draft ─────────────────────────────────────────────────────── -->
  <template v-else>
    <div
      class="cmsbar-strip"
      :style="DIRECT ? 'background: #d97706;' : undefined"
    >
      <span>{{ DIRECT ? "Editing live site:" : "Editing draft:" }}</span>
      <strong>{{ cms.draft.title }}</strong>
      <span v-if="pendingCount > 0" class="cmsbar-strip-count"
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
        :class="DIRECT ? 'cmsbar-badge-direct' : 'cmsbar-badge-draft'"
        >{{ DIRECT ? "Direct" : "Draft" }}</span
      >
      <span class="cmsbar-title" :title="cms.draft.title">{{
        cms.draft.title
      }}</span>
      <span class="cmsbar-divider" />

      <button
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
      <span v-if="notice" class="cmsbar-notice" :title="notice"
        >✓ {{ notice }}</span
      >

      <button
        type="button"
        class="cmsbar-btn"
        title="Discard this draft and return to the live site"
        @click="exitDraft"
      >
        Discard draft
      </button>

      <span class="cmsbar-divider" />
      <button type="button" class="cmsbar-btn" @click="logout">Log out</button>
    </div>
  </template>
</template>
