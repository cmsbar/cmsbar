<script lang="ts">
  // The editor bar, ported from template/components/cmsbar/CmsBar.tsx to
  // Svelte 5. S2 ports ONLY the core edit loop; Versions / Issues / Settings /
  // PageMeta / Tour are deferred to a later phase.
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
  // exactly as in CmsBar.tsx.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
  import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";
  import { cmsConfig } from "@/cms.config";
  import { publishingMode } from "@/lib/cmsbar/config";

  const store = getCmsContext();

  // Direct publishing: saves commit straight to the base branch - no draft
  // branch, no PR, no preview. Review-flow affordances are hidden.
  const DIRECT = publishingMode(cmsConfig) === "direct";

  // pageNameForPath equivalent: the neutral helper lives in
  // template/components/cmsbar (not copied here - see the neutral-core gap in
  // the PR summary), so the lookup against cmsConfig.pages is inlined.
  function pageNameForPath(pathname: string): string {
    const clean = pathname.replace(/\/+$/, "") || "/";
    const hit = cmsConfig.pages.find((p) => p.path === clean);
    if (hit) return hit.label;
    if (clean === "/") return "Home";
    const first = clean.replace(/^\//, "").split("/")[0] ?? clean;
    return first.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  }

  function currentPath(): string {
    return typeof window !== "undefined" ? window.location.pathname : "/";
  }

  // Reactive store reads.
  const cms = $derived(store.cms);
  const pendingCount = $derived(store.pendingCount);

  let busy = $state<"saving" | "starting" | null>(null);
  let error = $state<string | null>(null);
  // Transient confirmation after a direct publish (auto-clears).
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  // Login form state.
  let username = $state("");
  let password = $state("");
  let loginError = $state<string | null>(null);
  let loginBusy = $state(false);

  function flashNotice(msg: string) {
    notice = msg;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  async function login(e: Event) {
    e.preventDefault();
    loginError = null;
    loginBusy = true;
    try {
      const res = await cmsFetch("/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        loginError = body.error || "Login failed";
        loginBusy = false;
        return;
      }
      // Full-page navigation so the server re-reads the new session cookie.
      window.location.assign(currentPath());
    } catch (err) {
      loginError = String(err);
      loginBusy = false;
    }
  }

  async function logout() {
    await cmsFetch("/logout", { method: "POST" });
    window.location.reload();
  }

  async function startDraft() {
    busy = "starting";
    error = null;
    try {
      const pagePath = currentPath();
      const title = pageNameForPath(pagePath);
      const res = await cmsFetch("/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, pagePath }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = null;
    }
  }

  async function exitDraft() {
    if (
      pendingCount > 0 &&
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
    if (pendingCount === 0 || !cms.draft) return;
    busy = "saving";
    error = null;
    try {
      // S2 stages text edits only; uploads/folders/deletes arrive with the
      // media phase, so they go up empty for now.
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
      if (cms.draft) {
        void store.setPreview({
          branch: cms.draft.branch,
          title: cms.draft.title,
        });
      }
      if (result.prError) {
        error = `Commit succeeded but PR creation failed: ${result.prError}. Branch URL: ${result.branchUrl}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

{#if !cms.authenticated}
  <!-- ── Login (inline form) ───────────────────────────────────────────── -->
  <form class="cmsbar-login" data-cms-login onsubmit={login}>
    <h2>CMSBar login</h2>
    <input
      type="text"
      placeholder="Username"
      autocomplete="username"
      bind:value={username}
      required
    />
    <input
      type="password"
      placeholder="Password"
      autocomplete="current-password"
      bind:value={password}
      required
    />
    {#if loginError}<p class="cmsbar-login-error">{loginError}</p>{/if}
    <button type="submit" disabled={loginBusy}>
      {loginBusy ? "Signing in…" : "Sign in"}
    </button>
  </form>
{:else if cms.preview}
  <!-- ── Preview banner (review-flow Save lands here) ──────────────────── -->
  <div class="cmsbar-preview-banner" data-cms-preview>
    <span>Previewing draft:</span>
    <strong>{cms.preview.title ?? cms.preview.branch}</strong>
    <button type="button" onclick={() => store.setPreview(null)}>
      Exit preview
    </button>
  </div>
  <div class="cmsbar-bar" data-cms-bar>
    <span class="cmsbar-brand">CMSBar</span>
    <span class="cmsbar-badge cmsbar-badge-preview">Preview</span>
    <span class="cmsbar-divider"></span>
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => store.setPreview(null)}
    >
      Exit preview
    </button>
    <span class="cmsbar-divider"></span>
    <button type="button" class="cmsbar-btn" onclick={logout}>Log out</button>
  </div>
{:else if !cms.draft}
  <!-- ── Live site (no active draft) ───────────────────────────────────── -->
  <div class="cmsbar-bar" data-cms-bar>
    <span class="cmsbar-brand">CMSBar</span>
    <span class="cmsbar-badge cmsbar-badge-live">Live site</span>
    <span class="cmsbar-divider"></span>
    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-primary"
      onclick={startDraft}
      disabled={busy === "starting"}
      title={DIRECT
        ? "Direct publishing: saves commit straight to the live branch"
        : `Will create a draft named "${pageNameForPath(currentPath())}"`}
    >
      {busy === "starting" ? "Starting…" : DIRECT ? "Edit site" : "New draft"}
    </button>
    <span class="cmsbar-divider"></span>
    <button type="button" class="cmsbar-btn" onclick={logout}>Log out</button>
  </div>
{:else}
  <!-- ── Active draft ──────────────────────────────────────────────────── -->
  <div
    class="cmsbar-strip"
    style={DIRECT ? "background: #d97706;" : undefined}
  >
    <span>{DIRECT ? "Editing live site:" : "Editing draft:"}</span>
    <strong>{cms.draft.title}</strong>
    {#if pendingCount > 0}
      <span class="cmsbar-strip-count">{pendingCount} unsaved</span>
    {/if}
  </div>

  {#if error}
    <div class="cmsbar-error">
      <div class="cmsbar-error-msg">{error}</div>
      <button type="button" onclick={() => (error = null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  {/if}

  <div class="cmsbar-bar" data-cms-bar>
    <span class="cmsbar-brand">CMSBar</span>
    <span
      class="cmsbar-badge {DIRECT ? 'cmsbar-badge-direct' : 'cmsbar-badge-draft'}"
    >
      {DIRECT ? "Direct" : "Draft"}
    </span>
    <span class="cmsbar-title" title={cms.draft.title}>{cms.draft.title}</span>
    <span class="cmsbar-divider"></span>

    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-primary"
      onclick={save}
      disabled={pendingCount === 0 || busy !== null}
      title={pendingCount === 0
        ? "No changes to save"
        : DIRECT
          ? `Publish ${pendingCount} change(s) straight to the live branch`
          : `Save ${pendingCount} change(s)`}
    >
      {busy === "saving"
        ? DIRECT
          ? "Publishing…"
          : "Saving…"
        : DIRECT
          ? "Publish"
          : "Save"}
    </button>
    {#if notice}
      <span class="cmsbar-notice" title={notice}>✓ {notice}</span>
    {/if}

    <button
      type="button"
      class="cmsbar-btn"
      onclick={exitDraft}
      title="Discard this draft and return to the live site"
    >
      Discard draft
    </button>

    <span class="cmsbar-divider"></span>
    <button type="button" class="cmsbar-btn" onclick={logout}>Log out</button>
  </div>
{/if}
