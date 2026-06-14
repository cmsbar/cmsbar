"use client";
import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";

import { useEffect, useRef, useState } from "react";
import { useHost } from "./host";
import { cmsConfig } from "@/cms.config";
import { publishingMode } from "@/lib/cmsbar/config";
import { useCms } from "./ContentProvider";
import { VersionsDialog } from "./VersionsDialog";
import { PageMetaDrawer } from "./PageMetaDrawer";
import { SettingsDrawer } from "./SettingsDrawer";
import { IssuesButton } from "./IssuesButton";
import { CmsTour, TOUR_OPEN_EVENT } from "./CmsTour";
import { pageNameForPath } from "./pageName";
import { cn } from "@/lib/cmsbar/utils";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

const DIVIDER = <span className="h-4 w-px bg-white/20" />;

// Guided tour is opt-in: sites without `tour` config get no button, no overlay.
const TOUR_ENABLED = (cmsConfig.tour?.steps.length ?? 0) > 0;

// Direct publishing: saves go straight to the base branch - no draft branch,
// no PR, no approval flow. Review-flow affordances are hidden.
const DIRECT = publishingMode(cmsConfig) === "direct";

const TourButton = () =>
  TOUR_ENABLED ? (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT))}
      className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
      title="Replay the guided tour"
    >
      ✦ Guide
    </button>
  ) : null;

export function CmsBar() {
  const {
    cms,
    pendingCount,
    pendingEdits,
    pendingUploads,
    pendingFolders,
    pendingDeletes,
    discardAll,
    applyCommitted,
    setPreview,
  } = useCms();
  const { pathname, navigate } = useHost();
  const [busy, setBusy] = useState<"saving" | "starting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Transient in-bar confirmation after a direct publish (auto-clears).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [highlightShared, setHighlightShared] = useState(false);

  // Toggle the body class that lights up every shared element on the page, so
  // an editor can see at a glance what ripples site-wide before touching it.
  useEffect(() => {
    document.body.classList.toggle("cms-highlight-shared", highlightShared);
    return () => document.body.classList.remove("cms-highlight-shared");
  }, [highlightShared]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };

  const startDraft = async () => {
    setBusy("starting");
    setError(null);
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
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const forkDraft = async (
    fromBranch: string,
    fromTitle: string | undefined,
  ) => {
    setBusy("starting");
    setError(null);
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
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (!cms.authenticated) return null;

  const logout = async () => {
    await cmsFetch("/logout", { method: "POST" });
    window.location.reload();
  };

  const exitDraft = async () => {
    if (
      pendingCount > 0 &&
      !confirm("Discard pending changes and exit this draft?")
    )
      return;
    discardAll();
    await cmsFetch("/session/clear", { method: "POST" });
    try {
      localStorage.removeItem(PREVIEW_LS_KEY);
    } catch {
      /* SSR */
    }
    window.location.reload();
  };

  const save = async () => {
    if (pendingCount === 0 || !cms.draft) return;
    setBusy("saving");
    setError(null);
    try {
      const uploads = await Promise.all(
        pendingUploads.map(async (u) => ({
          repoPath: u.repoPath,
          contentBase64: await fileToBase64(u.file),
        })),
      );
      const res = await cmsFetch("/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          edits: pendingEdits,
          uploads,
          folders: pendingFolders,
          deletes: pendingDeletes,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          // A 12h session can lapse mid-edit (most likely in direct mode, where
          // the rolling-refresh poll is skipped). Make the recovery obvious and
          // reassure that work isn't lost - pending edits are kept on this
          // device and reattach to the next session after logging back in.
          throw new Error(
            "Your session expired - log in again at /cmsbar/login, then your edits are still here. Your unsaved changes are kept on this device.",
          );
        }
        throw new Error(b.error || `Save failed (HTTP ${res.status})`);
      }
      const result = (await res.json()) as {
        direct?: boolean;
        branch?: string;
        commitSha?: string;
        prUrl?: string;
        prError?: string;
        branchUrl?: string;
      };
      if (result.direct) {
        // Direct publish: the commit already landed on the live branch.
        // Stay in edit mode - there is no PR to review and no draft branch
        // to preview - and confirm inline. The server reports the branch it
        // committed to (a stale review-era cookie can carry a cms/* name).
        applyCommitted();
        flashNotice(
          `Published - the site redeploys from ${result.branch ?? "the live branch"}`,
        );
        return;
      }
      applyCommitted({ prUrl: result.prUrl });
      // After a successful save, switch into preview mode against the just-saved
      // branch - so the editor immediately sees the rendered result without the
      // dashed editing outlines, and can't accidentally start another round of
      // edits before deciding what's next.
      if (cms.draft) {
        void setPreview({
          branch: cms.draft.branch,
          title: cms.draft.title,
        });
      }
      if (result.prError) {
        setError(
          `Commit succeeded but PR creation failed: ${result.prError}. Branch URL: ${result.branchUrl}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // ─── Preview banner ───────────────────────────────────────────────────────
  if (cms.preview) {
    return (
      <>
        <PreviewBanner
          title={cms.preview.title ?? cms.preview.branch}
          approved={!!cms.preview.approved}
          onExitPreview={() => setPreview(null)}
          onEdit={async () => {
            const res = await cmsFetch("/session/switch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                branch: cms.preview!.branch,
                title: cms.preview!.title,
              }),
            });
            const data = (await res.json().catch(() => ({}))) as {
              pagePath?: string;
            };
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
          }}
          onFork={() => forkDraft(cms.preview!.branch, cms.preview!.title)}
          onShowVersions={() => setVersionsOpen(true)}
          onLogout={logout}
        />
        {versionsOpen && (
          <VersionsDialog
            onClose={() => setVersionsOpen(false)}
            onFork={(branch, title) => {
              setVersionsOpen(false);
              forkDraft(branch, title);
            }}
          />
        )}
        {/* Saving a draft lands here (preview); the tour remounts and
            resumes its step from sessionStorage, so render it here too. */}
        {TOUR_ENABLED && <CmsTour />}
      </>
    );
  }

  // ─── No active draft ──────────────────────────────────────────────────────
  if (!cms.draft) {
    return (
      <>
        <div
          data-cms-bar
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full bg-slate-900/95 text-white px-4 py-2 shadow-2xl backdrop-blur text-sm"
        >
          <span className="font-medium">CMSBar</span>
          <span className="rounded-full bg-emerald-500/20 text-emerald-200 px-2.5 py-0.5 text-xs font-medium">
            Live site
          </span>
          {DIVIDER}
          <button
            onClick={startDraft}
            disabled={busy === "starting"}
            className="rounded-full bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-xs font-semibold px-3 py-1 disabled:opacity-60"
            title={
              DIRECT
                ? "Direct publishing: saves commit straight to the live branch"
                : `Will create a draft named "${pageNameForPath(pathname)}"`
            }
          >
            {busy === "starting"
              ? "Starting…"
              : DIRECT
                ? "Edit site"
                : "New draft"}
          </button>
          {/* Versions lists open cms/* PRs; direct publishing creates none,
              so the dialog would be perpetually empty - hide it. */}
          {!DIRECT && (
            <button
              onClick={() => setVersionsOpen(true)}
              className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
            >
              Versions
            </button>
          )}
          <TourButton />
          {DIVIDER}
          <button
            onClick={() => setMetaOpen(true)}
            className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
            title="Preview SEO / page metadata (read-only without a draft)"
          >
            🔎 Page meta
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
            title="Preview site settings (read-only without a draft)"
          >
            ⚙️ Settings
          </button>
          {DIVIDER}
          <IssuesButton />
          {DIVIDER}
          <button
            onClick={logout}
            className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1 text-xs"
          >
            Log out
          </button>
        </div>
        {versionsOpen && (
          <VersionsDialog
            onClose={() => setVersionsOpen(false)}
            onFork={(branch, title) => {
              setVersionsOpen(false);
              forkDraft(branch, title);
            }}
          />
        )}
        {metaOpen && (
          <PageMetaDrawer onClose={() => setMetaOpen(false)} canEdit={false} />
        )}
        {settingsOpen && (
          <SettingsDrawer
            onClose={() => setSettingsOpen(false)}
            canEdit={false}
          />
        )}
        {TOUR_ENABLED && <CmsTour />}
      </>
    );
  }

  // ─── Active draft ─────────────────────────────────────────────────────────
  // The approval lock is a review-flow concept; in direct mode there is no PR
  // to approve, so it must never render (or block saving).
  const approved = !DIRECT && !!cms.draftApproved;
  const stripBg = approved
    ? "bg-emerald-600 text-white"
    : pendingCount > 0
      ? "bg-[var(--cmsbar-accent)] text-white"
      : "bg-[var(--cmsbar-accent)] text-white";
  return (
    <>
      {/* Always-on top strip so the editor can't lose track of being in draft mode. */}
      <div
        className={cn(
          "fixed top-0 left-0 right-0 z-[99] text-xs font-medium shadow flex items-center justify-center gap-3 px-4 py-1.5",
          stripBg,
        )}
      >
        <span>
          {approved
            ? "Approved draft (read-only):"
            : DIRECT
              ? "Editing live site:"
              : "Editing draft:"}
        </span>
        <strong className="truncate max-w-[24rem]">{cms.draft.title}</strong>
        {!approved && pendingCount > 0 && (
          <span className="rounded-full bg-white/20 text-white text-[10px] px-2 py-0.5">
            {pendingCount} unsaved
          </span>
        )}
        {approved && (
          <span className="rounded-full bg-emerald-900/40 text-emerald-100 text-[10px] px-2 py-0.5">
            label · {cms.approvedLabelName ?? "cmsbar approved"}
          </span>
        )}
        {cms.draft.pagePath && cms.draft.pagePath !== pathname && (
          <button
            onClick={() => navigate(cms.draft!.pagePath!)}
            className="rounded-full bg-white/20 hover:bg-white/30 text-white text-[10px] px-2 py-0.5 underline decoration-dotted underline-offset-2"
            title={`This draft was started on ${cms.draft.pagePath}. Click to navigate there.`}
          >
            ⚠ Go to {pageNameForPath(cms.draft.pagePath)}
          </button>
        )}
      </div>

      {error && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[110] max-w-md bg-red-600 text-white text-sm rounded-lg shadow-lg px-4 py-2 flex items-start gap-3">
          <div className="flex-1 break-all">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-white/80 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
      <div
        data-cms-bar
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full bg-slate-900/95 text-white px-4 py-2 shadow-2xl backdrop-blur text-sm"
      >
        <span className="font-medium">CMSBar</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            approved
              ? "bg-emerald-500/20 text-emerald-200"
              : DIRECT
                ? "bg-amber-500/20 text-amber-200"
                : "bg-[var(--cmsbar-accent-soft)] text-[var(--cmsbar-accent-text)]",
          )}
          title={
            DIRECT
              ? "Direct publishing: edits commit straight to the live branch - no review"
              : undefined
          }
        >
          {approved ? "Approved" : DIRECT ? "Direct" : "Draft"}
        </span>
        <span
          className="text-white/50 text-xs max-w-[12rem] truncate"
          title={cms.draft.title}
        >
          {cms.draft.title}
        </span>
        {DIVIDER}

        {/* 1. Save (or Fork when the draft is approved/locked) */}
        {approved ? (
          <button
            onClick={() => forkDraft(cms.draft!.branch, cms.draft!.title)}
            disabled={busy === "starting"}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1 disabled:opacity-60"
            title="This draft is locked - fork it to keep editing"
          >
            {busy === "starting" ? "Forking…" : "Fork"}
          </button>
        ) : (
          <button
            onClick={save}
            disabled={pendingCount === 0 || busy !== null}
            className="rounded-full bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-xs font-semibold px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              pendingCount === 0
                ? "No changes to save"
                : DIRECT
                  ? `Publish ${pendingCount} change(s) straight to the live branch`
                  : `Save ${pendingCount} change(s)`
            }
          >
            {busy === "saving"
              ? DIRECT
                ? "Publishing…"
                : "Saving…"
              : DIRECT
                ? "Publish"
                : "Save"}
          </button>
        )}
        {notice && (
          <span
            className="text-emerald-300 text-xs max-w-[18rem] truncate"
            title={notice}
          >
            ✓ {notice}
          </span>
        )}
        {/* 2. Discard draft (abandon the whole draft and return to the live site) */}
        <button
          onClick={exitDraft}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
          title="Discard this draft and return to the live site"
        >
          Discard draft
        </button>

        {DIVIDER}

        {/* 4. Page meta · 5. Settings */}
        <button
          onClick={() => setMetaOpen(true)}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
          title={
            approved
              ? "View SEO / page metadata (read-only)"
              : "Edit SEO / page metadata"
          }
        >
          🔎 Page meta
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
          title="Site settings (workshop visibility & schedule)"
        >
          ⚙️ Settings
        </button>

        {DIVIDER}

        {/* Issue reporting + shared-element highlight */}
        <IssuesButton />
        <button
          onClick={() => setHighlightShared((v) => !v)}
          className={cn(
            "rounded-full text-xs px-3 py-1",
            highlightShared
              ? "bg-[var(--cmsbar-shared-soft)] text-[var(--cmsbar-shared-text)]"
              : "bg-white/10 hover:bg-white/20",
          )}
          title="Highlight every element that appears on more than one page"
        >
          🔗 Shared
        </button>
        <TourButton />

        {DIVIDER}

        {/* 7. Log out */}
        <button
          onClick={logout}
          className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1 text-xs"
        >
          Log out
        </button>
      </div>
      {versionsOpen && (
        <VersionsDialog
          onClose={() => setVersionsOpen(false)}
          onFork={(branch, title) => {
            setVersionsOpen(false);
            forkDraft(branch, title);
          }}
        />
      )}
      {metaOpen && (
        <PageMetaDrawer
          onClose={() => setMetaOpen(false)}
          canEdit={!approved}
        />
      )}
      {settingsOpen && (
        <SettingsDrawer
          onClose={() => setSettingsOpen(false)}
          canEdit={!approved}
        />
      )}
      {TOUR_ENABLED && <CmsTour />}
    </>
  );
}

function PreviewBanner({
  title,
  approved,
  onExitPreview,
  onEdit,
  onFork,
  onShowVersions,
  onLogout,
}: {
  title: string;
  approved: boolean;
  onExitPreview: () => void;
  onEdit: () => void;
  onFork: () => void;
  onShowVersions: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      {/* Banner across the top of the page so the editor can never miss they're previewing. */}
      <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 text-sm font-medium shadow flex items-center justify-center gap-3 px-4 py-2">
        <span>Previewing draft:</span>
        <strong className="truncate max-w-[24rem]">{title}</strong>
        {approved && (
          <span className="rounded-full bg-emerald-700 text-white text-xs px-2 py-0.5">
            approved - read-only
          </span>
        )}
        <button
          onClick={onExitPreview}
          className="ml-3 underline decoration-dotted"
        >
          Exit preview
        </button>
      </div>
      <div
        data-cms-bar
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full bg-slate-900/95 text-white px-4 py-2 shadow-2xl backdrop-blur text-sm"
      >
        <span className="font-medium">CMSBar</span>
        <span className="rounded-full bg-amber-500/20 text-amber-200 px-2.5 py-0.5 text-xs font-medium">
          Preview
        </span>
        {DIVIDER}
        {!approved && (
          <button
            onClick={onEdit}
            className="rounded-full bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-xs font-semibold px-3 py-1"
            title="Switch your active draft to this PR and continue editing it"
          >
            Edit this version
          </button>
        )}
        <button
          onClick={onExitPreview}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
        >
          Exit preview
        </button>
        <button
          onClick={onFork}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
          title="Create a new draft branched from this one"
        >
          Fork
        </button>
        <button
          onClick={onShowVersions}
          className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
        >
          Versions
        </button>
        {DIVIDER}
        <IssuesButton />
        {DIVIDER}
        <button
          onClick={onLogout}
          className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1 text-xs"
        >
          Log out
        </button>
      </div>
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
