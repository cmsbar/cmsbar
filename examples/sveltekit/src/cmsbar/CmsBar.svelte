<script lang="ts">
  // The editor bar, ported from template/components/cmsbar/CmsBar.tsx to
  // Svelte 5. S2 ported the core edit loop; S5 wires in the remaining
  // drawers/panels - Versions, Issues (with a per-page open-count badge),
  // Settings, Page meta, and the opt-in guided Tour - matching CmsBar.tsx's
  // layout and conditions (Versions hidden in direct mode; the Tour button only
  // when cmsConfig.tour has steps; the shared-highlight toggle in draft mode).
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
  import {
    visibleOnPage,
    type ParsedIssue,
  } from "@/lib/cmsbar/backend/issues";
  import { page } from "$app/state";
  import VersionsDialog from "@/cmsbar/VersionsDialog.svelte";
  import PageMetaDrawer from "@/cmsbar/PageMetaDrawer.svelte";
  import SettingsDrawer from "@/cmsbar/SettingsDrawer.svelte";
  import IssuesPanel from "@/cmsbar/IssuesPanel.svelte";
  import CmsTour, { TOUR_OPEN_EVENT } from "@/cmsbar/CmsTour.svelte";

  const store = getCmsContext();

  // Direct publishing: saves commit straight to the base branch - no draft
  // branch, no PR, no preview. Review-flow affordances are hidden.
  const DIRECT = publishingMode(cmsConfig) === "direct";
  // Guided tour is opt-in: sites without `tour` config get no button, no overlay.
  const TOUR_ENABLED = (cmsConfig.tour?.steps.length ?? 0) > 0;

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

  // Reactive current path (matches React's useHost().pathname). Falls back to
  // "/" during SSR before $app/state is populated.
  const pathname = $derived(page.url?.pathname ?? "/");

  // Reactive store reads.
  const cms = $derived(store.cms);
  const pendingCount = $derived(store.pendingCount);

  let busy = $state<"saving" | "starting" | null>(null);
  let error = $state<string | null>(null);
  // Transient confirmation after a direct publish (auto-clears).
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  // Drawer/panel open flags.
  let versionsOpen = $state(false);
  let metaOpen = $state(false);
  let settingsOpen = $state(false);
  let highlightShared = $state(false);

  // Login form state.
  let username = $state("");
  let password = $state("");
  let loginError = $state<string | null>(null);
  let loginBusy = $state(false);

  // Toggle the body class that lights up every shared element on the page, so
  // an editor can see at a glance what ripples site-wide before touching it.
  $effect(() => {
    document.body.classList.toggle("cms-highlight-shared", highlightShared);
    return () => document.body.classList.remove("cms-highlight-shared");
  });

  $effect(() => () => {
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  function flashNotice(msg: string) {
    notice = msg;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  // ── Issues button state (owned here, mirroring IssuesButton.tsx) ──────────
  // Lives in the bar so the per-page open-count badge and the panel share one
  // list. GitHub's label-filtered list can lag seconds behind a create, so
  // keep just-created issues pinned until a reload sees them.
  let issuesOpen = $state(false);
  let issues = $state<ParsedIssue[]>([]);
  let issuesLoading = $state(false);
  let issuesRefreshing = $state(false);
  let issuesError = $state<string | null>(null);
  let issuesLoadedOnce = $state(false);
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
    const rest = issues.filter((i) => i.number !== issue.number);
    issues = [issue, ...rest];
  }

  async function reloadIssues() {
    if (!issuesInitialLoadDone) issuesLoading = true;
    else issuesRefreshing = true;
    issuesError = null;
    try {
      const res = await cmsFetch("/issues", { cache: "no-store" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { issues: ParsedIssue[] };
      issues = mergeWithPending(data.issues, issues);
    } catch (e) {
      issuesError = e instanceof Error ? e.message : String(e);
    } finally {
      issuesLoading = false;
      issuesRefreshing = false;
      issuesInitialLoadDone = true;
      issuesLoadedOnce = true;
    }
  }

  // Fetch once on mount for the badge count (authenticated editors only).
  $effect(() => {
    if (!store.cms.authenticated) return;
    void reloadIssues();
  });

  const issuesCount = $derived(
    issuesLoadedOnce
      ? issues.filter(
          (i) => i.status !== "closed" && visibleOnPage(i, pathname),
        ).length
      : 0,
  );

  function openIssues() {
    issuesOpen = true;
    void reloadIssues();
  }

  function openTour() {
    window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT));
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
      window.location.assign(pathname);
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
      const title = pageNameForPath(pathname);
      const res = await cmsFetch("/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, pagePath: pathname }),
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

  async function forkDraft(fromBranch: string, fromTitle: string | undefined) {
    busy = "starting";
    error = null;
    try {
      const base = fromTitle?.trim() || pageNameForPath(pathname);
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

  async function editPreviewVersion() {
    if (!cms.preview) return;
    const res = await cmsFetch("/session/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branch: cms.preview.branch,
        title: cms.preview.title,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { pagePath?: string };
    try {
      localStorage.removeItem(PREVIEW_LS_KEY);
    } catch {
      /* SSR */
    }
    const target = data.pagePath;
    if (target && target !== pathname) {
      window.location.href = target;
    } else {
      window.location.reload();
    }
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

  // The approval lock is a review-flow concept; in direct mode there is no PR
  // to approve, so it must never render (or block saving).
  const approved = $derived(!DIRECT && !!cms.draftApproved);
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
    {#if cms.preview.approved}
      <span class="cmsbar-badge cmsbar-badge-live">approved - read-only</span>
    {/if}
    <button type="button" onclick={() => store.setPreview(null)}>
      Exit preview
    </button>
  </div>
  <div class="cmsbar-bar" data-cms-bar>
    <span class="cmsbar-brand">CMSBar</span>
    <span class="cmsbar-badge cmsbar-badge-preview">Preview</span>
    <span class="cmsbar-divider"></span>
    {#if !cms.preview.approved}
      <button
        type="button"
        class="cmsbar-btn cmsbar-btn-primary"
        onclick={editPreviewVersion}
        title="Switch your active draft to this PR and continue editing it"
      >
        Edit this version
      </button>
    {/if}
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => store.setPreview(null)}
    >
      Exit preview
    </button>
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => forkDraft(cms.preview!.branch, cms.preview!.title)}
      title="Create a new draft branched from this one"
    >
      Fork
    </button>
    {#if !DIRECT}
      <button
        type="button"
        class="cmsbar-btn"
        onclick={() => (versionsOpen = true)}
      >
        Versions
      </button>
    {/if}
    <span class="cmsbar-divider"></span>
    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-issues"
      onclick={openIssues}
      title="Report or browse issues for this page"
    >
      🐛 Issues
      {#if issuesCount > 0}<span class="cmsbar-issue-badge">{issuesCount}</span
        >{/if}
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
        : `Will create a draft named "${pageNameForPath(pathname)}"`}
    >
      {busy === "starting" ? "Starting…" : DIRECT ? "Edit site" : "New draft"}
    </button>
    <!-- Versions lists open cms/* PRs; direct publishing creates none, so the
         dialog would be perpetually empty - hide it. -->
    {#if !DIRECT}
      <button
        type="button"
        class="cmsbar-btn"
        onclick={() => (versionsOpen = true)}
      >
        Versions
      </button>
    {/if}
    {#if TOUR_ENABLED}
      <button
        type="button"
        class="cmsbar-btn"
        onclick={openTour}
        title="Replay the guided tour"
      >
        ✦ Guide
      </button>
    {/if}
    <span class="cmsbar-divider"></span>
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => (metaOpen = true)}
      title="Preview SEO / page metadata (read-only without a draft)"
    >
      🔎 Page meta
    </button>
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => (settingsOpen = true)}
      title="Preview site settings (read-only without a draft)"
    >
      ⚙️ Settings
    </button>
    <span class="cmsbar-divider"></span>
    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-issues"
      onclick={openIssues}
      title="Report or browse issues for this page"
    >
      🐛 Issues
      {#if issuesCount > 0}<span class="cmsbar-issue-badge">{issuesCount}</span
        >{/if}
    </button>
    <span class="cmsbar-divider"></span>
    <button type="button" class="cmsbar-btn" onclick={logout}>Log out</button>
  </div>
{:else}
  <!-- ── Active draft ──────────────────────────────────────────────────── -->
  <div
    class="cmsbar-strip"
    style={approved
      ? "background: #059669;"
      : DIRECT
        ? "background: #d97706;"
        : undefined}
  >
    <span>
      {approved
        ? "Approved draft (read-only):"
        : DIRECT
          ? "Editing live site:"
          : "Editing draft:"}
    </span>
    <strong>{cms.draft.title}</strong>
    {#if !approved && pendingCount > 0}
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
      class="cmsbar-badge {approved
        ? 'cmsbar-badge-live'
        : DIRECT
          ? 'cmsbar-badge-direct'
          : 'cmsbar-badge-draft'}"
    >
      {approved ? "Approved" : DIRECT ? "Direct" : "Draft"}
    </span>
    <span class="cmsbar-title" title={cms.draft.title}>{cms.draft.title}</span>
    <span class="cmsbar-divider"></span>

    {#if approved}
      <button
        type="button"
        class="cmsbar-btn cmsbar-btn-primary"
        onclick={() => forkDraft(cms.draft!.branch, cms.draft!.title)}
        disabled={busy === "starting"}
        title="This draft is locked - fork it to keep editing"
      >
        {busy === "starting" ? "Forking…" : "Fork"}
      </button>
    {:else}
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
    {/if}
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

    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => (metaOpen = true)}
      title={approved
        ? "View SEO / page metadata (read-only)"
        : "Edit SEO / page metadata"}
    >
      🔎 Page meta
    </button>
    <button
      type="button"
      class="cmsbar-btn"
      onclick={() => (settingsOpen = true)}
      title="Site settings"
    >
      ⚙️ Settings
    </button>

    <span class="cmsbar-divider"></span>

    <button
      type="button"
      class="cmsbar-btn cmsbar-btn-issues"
      onclick={openIssues}
      title="Report or browse issues for this page"
    >
      🐛 Issues
      {#if issuesCount > 0}<span class="cmsbar-issue-badge">{issuesCount}</span
        >{/if}
    </button>
    <button
      type="button"
      class="cmsbar-btn"
      class:cmsbar-btn-shared={highlightShared}
      onclick={() => (highlightShared = !highlightShared)}
      title="Highlight every element that appears on more than one page"
    >
      🔗 Shared
    </button>
    {#if TOUR_ENABLED}
      <button
        type="button"
        class="cmsbar-btn"
        onclick={openTour}
        title="Replay the guided tour"
      >
        ✦ Guide
      </button>
    {/if}

    <span class="cmsbar-divider"></span>
    <button type="button" class="cmsbar-btn" onclick={logout}>Log out</button>
  </div>
{/if}

<!-- ── Drawers / panels / tour (rendered for any authenticated state) ────── -->
{#if cms.authenticated}
  {#if versionsOpen}
    <VersionsDialog
      onClose={() => (versionsOpen = false)}
      onFork={(branch, title) => {
        versionsOpen = false;
        forkDraft(branch, title);
      }}
    />
  {/if}
  {#if metaOpen}
    <PageMetaDrawer onClose={() => (metaOpen = false)} canEdit={!!cms.draft && !approved} />
  {/if}
  {#if settingsOpen}
    <SettingsDrawer
      onClose={() => (settingsOpen = false)}
      canEdit={!!cms.draft && !approved}
      highlightShared={highlightShared}
      onToggleHighlight={!!cms.draft && !approved
        ? () => (highlightShared = !highlightShared)
        : undefined}
    />
  {/if}
  {#if issuesOpen}
    <IssuesPanel
      onClose={() => (issuesOpen = false)}
      {pathname}
      {issues}
      loading={issuesLoading && issues.length === 0}
      refreshing={issuesRefreshing}
      error={issuesError}
      reload={reloadIssues}
      {addIssue}
    />
  {/if}
  {#if TOUR_ENABLED}
    <CmsTour />
  {/if}
{/if}

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
