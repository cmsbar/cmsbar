"use client";

import { useEffect } from "react";
import { useCms } from "./ContentProvider";
import { cn } from "@/lib/cmsbar/utils";
import { siteLaunchLabel, type SiteLaunch } from "@/lib/cmsbar/launch";

/**
 * Site-wide CMS settings drawer (opened from the CMS bar). Ships with the
 * launch-gate section; structured as sections so projects can add their own
 * settings below it. Edits stage into the active draft like any other
 * content edit.
 */
export function SettingsDrawer({
  onClose,
  canEdit,
}: {
  onClose: () => void;
  canEdit: boolean;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[150] bg-[#080c18]/45 backdrop-blur-sm"
      />
      <aside className="fixed right-0 top-0 bottom-0 z-[160] flex w-[min(520px,100%)] flex-col bg-white shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.4)]">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              ⚙️ Settings
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Site settings</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!canEdit && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Read-only preview of the current values. Start a draft to edit.
            </div>
          )}
          <LaunchSection canEdit={canEdit} />
        </div>

        <footer className="border-t px-5 py-3 text-xs text-slate-500">
          {canEdit ? (
            <>
              Changes stage into your draft. Click <strong>Save</strong> in the
              CMS bar to commit them.
            </>
          ) : (
            <>Read-only. Start a draft to edit.</>
          )}
        </footer>
      </aside>
    </>
  );
}

const LAUNCH_MODES: {
  value: SiteLaunch["mode"];
  title: string;
  sub: string;
}[] = [
  {
    value: "teaser",
    title: "Teaser",
    sub: "The public sees the teaser page; only logged-in editors see the site.",
  },
  {
    value: "live",
    title: "Live",
    sub: "The whole site is visible to everyone.",
  },
];

const DEFAULT_LAUNCH: SiteLaunch = { mode: "live" };

function LaunchSection({ canEdit }: { canEdit: boolean }) {
  const { get, addEdit } = useCms();
  const launch = (get("launch") as SiteLaunch | undefined) ?? DEFAULT_LAUNCH;

  const status = siteLaunchLabel(launch);
  const toneCls =
    status.tone === "live"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  const update = (patch: Partial<SiteLaunch>) =>
    addEdit("launch", { ...launch, ...patch });

  return (
    <section className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">🚀 Site launch</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Who sees the site, and who sees the teaser
        </p>
      </div>

      <fieldset disabled={!canEdit} className="m-0 space-y-4 border-0 p-4">
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 text-sm font-medium",
            toneCls,
          )}
        >
          {status.text}
        </div>

        <div className="space-y-2">
          {LAUNCH_MODES.map((m) => {
            const active = launch.mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => update({ mode: m.value })}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-[var(--cmsbar-info)] bg-[var(--cmsbar-info-soft)] ring-1 ring-[var(--cmsbar-info)]"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border",
                    active ? "border-[var(--cmsbar-info)]" : "border-slate-300",
                  )}
                >
                  {active && (
                    <span className="h-2 w-2 rounded-full bg-[var(--cmsbar-info)]" />
                  )}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-800">
                    {m.title}
                  </span>
                  <span className="block text-xs text-slate-500">{m.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
