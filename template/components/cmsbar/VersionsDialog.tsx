"use client";
import { PREVIEW_LS_KEY } from "@/lib/cmsbar/keys";

import { useEffect, useState } from "react";
import { Portal } from "./Portal";
import { useCms } from "./ContentProvider";
import { cn } from "@/lib/cmsbar/utils";

export type Version = {
  number: number;
  title: string;
  branch: string;
  author: string | null;
  updatedAt: string;
  commitCount: number;
  prUrl: string;
  approved: boolean;
  labels: string[];
};

export function VersionsDialog({
  onClose,
  onFork,
}: {
  onClose: () => void;
  onFork: (branch: string, title?: string) => void;
}) {
  const { setPreview, cms } = useCms();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [approvedLabel, setApprovedLabel] = useState<string>("approved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/cms/versions", { cache: "no-store" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        versions: Version[];
        approvedLabel: string;
      };
      setVersions(data.versions);
      setApprovedLabel(data.approvedLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const preview = async (v: Version) => {
    setBusy(v.branch);
    await setPreview({
      branch: v.branch,
      title: v.title,
      approved: v.approved,
    });
    setBusy(null);
    onClose();
  };

  const editVersion = async (v: Version) => {
    setBusy(v.branch);
    try {
      const res = await fetch("/api/cms/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch: v.branch, title: v.title }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        pagePath?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      try {
        localStorage.removeItem(PREVIEW_LS_KEY);
      } catch {
        /* SSR */
      }
      const target = data.pagePath;
      if (target && target !== window.location.pathname) {
        window.location.href = target;
      } else {
        window.location.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Draft versions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every open PR in this repo whose branch starts with{" "}
                <code>cms/</code>. Preview renders the page with that
                draft&rsquo;s content. PRs labelled <code>{approvedLabel}</code>{" "}
                are locked - you can preview or fork, but not edit.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {!versions && (
              <p className="p-5 text-sm text-slate-500">Loading…</p>
            )}
            {versions && versions.length === 0 && (
              <p className="p-5 text-sm text-slate-500">
                No open CMS drafts yet. Start one from the CMS bar.
              </p>
            )}
            <ul>
              {versions?.map((v) => {
                const isActive = cms.draft?.branch === v.branch;
                const isPreviewing = cms.preview?.branch === v.branch;
                return (
                  <li
                    key={v.number}
                    className={cn(
                      "border-b last:border-b-0 px-5 py-3 flex items-center gap-3",
                      isActive && "bg-[var(--cmsbar-accent-soft)]",
                      isPreviewing && "bg-amber-50",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {v.title}
                        </span>
                        <a
                          href={v.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-slate-500 hover:text-[var(--cmsbar-accent)] shrink-0"
                          title="Open PR on GitHub"
                        >
                          #{v.number}
                        </a>
                        {v.approved && (
                          <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 font-medium">
                            {approvedLabel} · locked
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] rounded-full bg-[var(--cmsbar-accent-soft)] text-[var(--cmsbar-accent-strong)] px-2 py-0.5 font-medium">
                            your draft
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {v.commitCount} change{v.commitCount === 1 ? "" : "s"} ·{" "}
                        {v.author ?? "-"} · updated{" "}
                        {new Date(v.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void preview(v)}
                        disabled={busy === v.branch}
                        className="rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs px-2.5 py-1 disabled:opacity-50"
                      >
                        Preview
                      </button>
                      {!v.approved && !isActive && (
                        <button
                          type="button"
                          onClick={() => void editVersion(v)}
                          disabled={busy === v.branch}
                          className="rounded-md bg-slate-900 hover:bg-slate-700 text-white text-xs px-2.5 py-1 disabled:opacity-50"
                          title="Switch your active draft to this PR - your edits go onto it."
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onFork(v.branch, v.title)}
                        disabled={busy === v.branch}
                        className="rounded-md border border-slate-300 hover:border-[var(--cmsbar-accent)] hover:text-[var(--cmsbar-accent)] text-slate-700 text-xs px-2.5 py-1 disabled:opacity-50"
                        title="Create a new PR branched from this one."
                      >
                        Fork
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </Portal>
  );
}
