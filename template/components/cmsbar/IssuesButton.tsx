"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHost } from "./host";
import { IssuesPanel } from "./IssuesPanel";
import { visibleOnPage, type ParsedIssue } from "@/lib/cmsbar/backend/issues";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

/** GitHub's label-filtered issue list can lag seconds behind create - keep these until reload sees them. */
function mergeWithPending(
  fetched: ParsedIssue[],
  prev: ParsedIssue[],
  pending: Set<number>,
): ParsedIssue[] {
  const fetchedNums = new Set(fetched.map((i) => i.number));
  for (const n of fetchedNums) pending.delete(n);
  const extra = prev.filter(
    (i) => pending.has(i.number) && !fetchedNums.has(i.number),
  );
  return [...extra, ...fetched];
}

// The 🐛 Issues button rendered in the CMS bar (every mode). Owns the issue
// list so it can show a per-page open-count badge and hand the data to the panel.
export function IssuesButton() {
  const { pathname } = useHost();
  const [open, setOpen] = useState(false);
  const [issues, setIssues] = useState<ParsedIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const pendingIssueNums = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);

  const addIssue = useCallback((issue: ParsedIssue) => {
    pendingIssueNums.current.add(issue.number);
    setIssues((prev) => {
      const rest = prev.filter((i) => i.number !== issue.number);
      return [issue, ...rest];
    });
  }, []);

  const reload = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await cmsFetch("/issues", { cache: "no-store" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { issues: ParsedIssue[] };
      setIssues((prev) =>
        mergeWithPending(data.issues, prev, pendingIssueNums.current),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
      initialLoadDone.current = true;
      setLoadedOnce(true);
    }
  }, []);

  // Fetch once on mount for the badge count.
  useEffect(() => {
    void reload();
  }, [reload]);

  const count = loadedOnce
    ? issues.filter((i) => i.status !== "closed" && visibleOnPage(i, pathname))
        .length
    : 0;

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          void reload();
        }}
        className="relative rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
        title="Report or browse issues for this page"
      >
        🐛 Issues
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--cmsbar-accent)] px-1 text-[9px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
      {open && (
        <IssuesPanel
          onClose={() => setOpen(false)}
          pathname={pathname}
          issues={issues}
          loading={loading && issues.length === 0}
          refreshing={refreshing}
          error={error}
          reload={reload}
          addIssue={addIssue}
        />
      )}
    </>
  );
}
