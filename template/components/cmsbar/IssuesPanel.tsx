"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Portal } from "./Portal";
import { useCms } from "./ContentProvider";
import { cn } from "@/lib/cmsbar/utils";
import {
  PRIORITIES,
  visibleOnPage,
  type IssuePriority,
  type IssueScope,
  type IssueStatus,
  type ParsedIssue,
} from "@/lib/cmsbar/backend/issues";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

type Pinned = { path: string; shared: boolean };

const PRIO_DOT: Record<IssuePriority, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};
const PRIO_RANK: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_BADGE: Record<IssueStatus, { label: string; cls: string }> = {
  open: { label: "● open", cls: "text-emerald-600" },
  "in-progress": { label: "◑ in progress", cls: "text-blue-600" },
  closed: { label: "✓ closed", cls: "text-slate-400" },
};

export function IssuesPanel({
  onClose,
  pathname,
  issues,
  loading,
  refreshing,
  error,
  reload,
  addIssue,
}: {
  onClose: () => void;
  pathname: string;
  issues: ParsedIssue[];
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  reload: () => Promise<void>;
  addIssue: (issue: ParsedIssue) => void;
}) {
  const [tab, setTab] = useState<"new" | "list">("new");

  // ── Pin mode ──────────────────────────────────────────────────────────
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState<Pinned | null>(null);

  useEffect(() => {
    document.body.classList.toggle("cms-pinning", pinning);
    return () => document.body.classList.remove("cms-pinning");
  }, [pinning]);

  useEffect(() => {
    if (!pinning) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("[data-cms-path]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      setPinned({
        path: el.getAttribute("data-cms-path") || "",
        shared: el.getAttribute("data-cms-shared") === "true",
      });
      setPinning(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinning(false);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [pinning]);

  const { cms } = useCms();

  // ── New-issue form ────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [everyPage, setEveryPage] = useState(false);
  const [editorIssue, setEditorIssue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Scope: "editor" overrides all; a pinned shared element forces "shared";
  // otherwise the editor's "affects every page" choice decides between page and shared.
  const scope: IssueScope = editorIssue
    ? "editor"
    : pinned?.shared || everyPage
      ? "shared"
      : "page";

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await cmsFetch("/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          details: details.trim(),
          priority,
          scope,
          page: pathname,
          pageUrl: window.location.href,
          elementPath: pinned?.path,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { issue: ParsedIssue };
      addIssue(data.issue);
      setTitle("");
      setDetails("");
      setPinned(null);
      setEveryPage(false);
      setEditorIssue(false);
      setPriority("medium");
      await reload();
      setTab("list");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (n: number, status: IssueStatus) => {
    try {
      const res = await cmsFetch(`/issues/${n}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch {
      /* surfaced via the list error on next reload */
    }
  };

  return (
    <Portal>
      {pinning && (
        <div className="fixed bottom-24 left-1/2 z-[210] -translate-x-1/2 rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-lg">
          🎯 Click a blue-outlined element to pin it.
          <button onClick={() => setPinning(false)} className="ml-2 underline">
            cancel
          </button>
        </div>
      )}

      <div
        className={cn(
          "fixed inset-0 z-[200] flex justify-end bg-black/40",
          pinning && "hidden",
        )}
        onClick={onClose}
      >
        <div
          className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              <TabBtn active={tab === "new"} onClick={() => setTab("new")}>
                ＋ New issue
              </TabBtn>
              <TabBtn active={tab === "list"} onClick={() => setTab("list")}>
                Issues <span className="text-slate-400">({issues.length})</span>
              </TabBtn>
            </div>
            <button
              onClick={onClose}
              className="text-lg text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          </div>

          {tab === "new" ? (
            <NewIssue
              pathname={pathname}
              pinned={pinned}
              scope={scope}
              everyPage={everyPage}
              setEveryPage={setEveryPage}
              editorIssue={editorIssue}
              setEditorIssue={setEditorIssue}
              inDraftMode={!!cms.draft}
              startPinning={() => setPinning(true)}
              clearPin={() => setPinned(null)}
              title={title}
              setTitle={setTitle}
              details={details}
              setDetails={setDetails}
              priority={priority}
              setPriority={setPriority}
              submitting={submitting}
              submitError={submitError}
              onSubmit={submit}
              onCancel={onClose}
            />
          ) : (
            <IssueList
              pathname={pathname}
              issues={issues}
              loading={loading}
              refreshing={refreshing}
              error={error}
              onChangeStatus={changeStatus}
            />
          )}
        </div>
      </div>
    </Portal>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 font-medium",
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
      )}
    >
      {children}
    </button>
  );
}

function NewIssue(props: {
  pathname: string;
  pinned: Pinned | null;
  scope: IssueScope;
  everyPage: boolean;
  setEveryPage: (v: boolean) => void;
  editorIssue: boolean;
  setEditorIssue: (v: boolean) => void;
  inDraftMode: boolean;
  startPinning: () => void;
  clearPin: () => void;
  title: string;
  setTitle: (v: string) => void;
  details: string;
  setDetails: (v: string) => void;
  priority: IssuePriority;
  setPriority: (p: IssuePriority) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { pinned, scope } = props;
  const contentDisabled = props.editorIssue;
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-5">
      {/* Editor/CMS scope toggle - most relevant in draft mode, available always */}
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          props.editorIssue
            ? "border-violet-400 bg-violet-50 text-violet-800"
            : props.inDraftMode
              ? "border-violet-200 bg-violet-50/50 text-slate-600 hover:border-violet-300"
              : "border-slate-200 text-slate-500 hover:border-slate-300",
        )}
      >
        <input
          type="checkbox"
          className="accent-violet-600"
          checked={props.editorIssue}
          onChange={(e) => props.setEditorIssue(e.target.checked)}
        />
        <span>
          🛠 About the CMS editor / toolbar
          {props.inDraftMode && !props.editorIssue && (
            <span className="ml-1.5 text-[10px] font-medium text-violet-500">
              ← you&apos;re editing
            </span>
          )}
        </span>
      </label>

      <div
        className={cn(
          "rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200",
          contentDisabled && "opacity-40",
        )}
      >
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">
          📍 Context
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Page</span>
          <span className="font-medium">{props.pathname}</span>
        </div>
        <div className="mt-1 flex justify-between gap-3">
          <span className="text-slate-500">Element</span>
          <span className="truncate font-mono text-xs text-slate-700">
            {pinned ? pinned.path : "- none pinned -"}
          </span>
        </div>
        {pinned && (
          <div className="mt-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
                pinned.shared
                  ? "bg-amber-100 text-amber-800"
                  : "bg-[var(--cmsbar-accent-soft)] text-[var(--cmsbar-accent)]",
              )}
            >
              {pinned.shared
                ? "🔗 shared - shows on every page"
                : "📄 this page only"}
            </span>
          </div>
        )}
        <div className="mt-2 flex gap-3">
          <button
            onClick={props.startPinning}
            disabled={contentDisabled}
            className="text-xs text-blue-600 hover:underline disabled:pointer-events-none"
          >
            🎯 {pinned ? "Pin a different element" : "Pin an element"}
          </button>
          {pinned && (
            <button
              onClick={props.clearPin}
              className="text-xs text-slate-500 hover:underline"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-slate-600">Title</span>
        <input
          value={props.title}
          onChange={(e) => props.setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
          placeholder="Short summary of the problem"
        />
      </label>

      <div className="block text-sm">
        <span className="font-medium text-slate-600">Details</span>
        <DetailsEditor value={props.details} onChange={props.setDetails} />
      </div>

      <div className="text-sm">
        <span className="font-medium text-slate-600">Priority</span>
        <div className="mt-1.5 flex gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => props.setPriority(p)}
              className={cn(
                "flex-1 rounded-md border px-3 py-1.5 text-sm capitalize",
                props.priority === p
                  ? "border-[var(--cmsbar-accent)] bg-[var(--cmsbar-accent-soft)] ring-2 ring-[var(--cmsbar-accent)]"
                  : "border-slate-300",
              )}
            >
              {PRIO_DOT[p]} {p}
            </button>
          ))}
        </div>
      </div>

      <label
        className={cn(
          "flex items-center gap-2 text-sm",
          contentDisabled || pinned?.shared
            ? "text-slate-400"
            : "text-slate-600",
        )}
      >
        <input
          type="checkbox"
          className="accent-[var(--cmsbar-accent)]"
          disabled={contentDisabled || pinned?.shared}
          checked={scope === "shared"}
          onChange={(e) => props.setEveryPage(e.target.checked)}
        />
        Affects every page (shared / toolbar)
      </label>

      {props.submitError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {props.submitError}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={props.onCancel}
          className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={props.onSubmit}
          disabled={props.submitting || !props.title.trim()}
          className="rounded-md bg-[var(--cmsbar-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--cmsbar-accent-strong)] disabled:opacity-50"
        >
          {props.submitting ? "Creating…" : "Create issue →"}
        </button>
      </div>

      <p className="border-t pt-3 text-[11px] leading-snug text-slate-400">
        Creates a GitHub issue labelled <code>cms-bar</code> + priority + scope.
        Page issues get <code>cms-page:{props.pathname}</code>; shared/toolbar
        issues get <code>cms-scope:shared</code> and surface on every page.
      </p>
    </div>
  );
}

function IssueList({
  pathname,
  issues,
  loading,
  refreshing,
  error,
  onChangeStatus,
}: {
  pathname: string;
  issues: ParsedIssue[];
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  onChangeStatus: (n: number, status: IssueStatus) => void;
}) {
  const [scopeFilter, setScopeFilter] = useState<"page" | "all">("page");
  const [statuses, setStatuses] = useState<Set<IssueStatus>>(
    new Set(["open", "in-progress"]),
  );
  const [sort, setSort] = useState<"priority" | "recent">("priority");
  const [expanded, setExpanded] = useState<number | null>(null);

  const toggleStatus = (s: IssueStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const visible = useMemo(() => {
    let list = issues.filter((i) => statuses.has(i.status));
    if (scopeFilter === "page")
      list = list.filter((i) => visibleOnPage(i, pathname));
    if (sort === "priority") {
      list = [...list].sort(
        (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority],
      );
    }
    return list;
  }, [issues, statuses, scopeFilter, sort, pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b px-5 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Show</span>
          <div className="flex rounded-md bg-slate-100 p-0.5">
            {(["page", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScopeFilter(s)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  scopeFilter === s
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500",
                )}
              >
                {s === "page" ? "This page" : "All"}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-slate-500">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "priority" | "recent")}
            className="rounded-md border px-2 py-1 text-xs"
          >
            <option value="priority">Priority</option>
            <option value="recent">Most recent</option>
          </select>
        </div>
        <div className="flex gap-1.5">
          {(["open", "in-progress", "closed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                statuses.has(s)
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-500",
              )}
            >
              {STATUS_BADGE[s].label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
        {refreshing && !loading && (
          <p className="border-b bg-slate-50 px-5 py-1.5 text-center text-xs text-slate-400">
            Refreshing…
          </p>
        )}
        {loading && (
          <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
        )}
        {error && !loading && (
          <p className="p-5 text-sm text-red-600">
            Couldn’t load issues: {error}
          </p>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            No issues match these filters.
          </p>
        )}
        {visible.map((i) => {
          const scopeTag =
            i.scope === "shared"
              ? "🔗 shared · all pages"
              : i.scope === "toolbar"
                ? "🧰 toolbar · all pages"
                : i.scope === "editor"
                  ? "🛠 CMS editor"
                  : `📄 ${i.page ?? pathname}`;
          const open = expanded === i.number;
          return (
            <div key={i.number} className="px-5 py-3 hover:bg-slate-50">
              <div
                className="flex cursor-pointer items-start gap-2"
                onClick={() => setExpanded(open ? null : i.number)}
              >
                <span>{PRIO_DOT[i.priority]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800">
                      {i.title}
                    </span>
                    <span className="text-xs text-slate-400">#{i.number}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {i.elementPath && (
                      <span className="font-mono">{i.elementPath} · </span>
                    )}
                    {scopeTag}
                  </div>
                </div>
                <span
                  className={cn(
                    "whitespace-nowrap text-xs",
                    STATUS_BADGE[i.status].cls,
                  )}
                >
                  {STATUS_BADGE[i.status].label}
                </span>
              </div>
              {open && (
                <div className="mt-2 text-sm text-slate-600">
                  {i.body.split("---")[0].trim() ? (
                    <p className="mb-2 whitespace-pre-wrap">
                      {i.body.split("---")[0].trim()}
                    </p>
                  ) : (
                    <p className="mb-2 italic text-slate-400">no description</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {i.status !== "in-progress" && i.status !== "closed" && (
                      <button
                        onClick={() => onChangeStatus(i.number, "in-progress")}
                        className="rounded border px-2 py-1 text-xs hover:bg-blue-50"
                      >
                        ◑ Mark in progress
                      </button>
                    )}
                    {i.status !== "closed" ? (
                      <button
                        onClick={() => onChangeStatus(i.number, "closed")}
                        className="rounded border px-2 py-1 text-xs hover:bg-emerald-50"
                      >
                        ✓ Close
                      </button>
                    ) : (
                      <button
                        onClick={() => onChangeStatus(i.number, "open")}
                        className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        ↺ Reopen
                      </button>
                    )}
                    <a
                      href={i.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Open in GitHub ↗
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t px-5 py-2.5 text-xs text-slate-500">
        {scopeFilter === "page"
          ? `${visible.length} shown · ${pathname} + site-wide`
          : `${visible.length} shown · all pages`}
      </div>
    </div>
  );
}

// ─── WYSIWYG details editor ───────────────────────────────────────────────────

type MdFormat =
  | "bold"
  | "italic"
  | "heading"
  | "quote"
  | "link"
  | "ul"
  | "ol"
  | "checklist";

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

// ── markdown ↔ HTML conversion ──────────────────────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineMd(text: string): string {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function mdToHtml(md: string): string {
  if (!md.trim()) return "";
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`);
      i++;
      continue;
    }
    if (/^- \[[ x]\] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- \[[ x]\] /.test(lines[i])) {
        const checked = lines[i][3] === "x";
        items.push(
          `<li class="task-item" data-task="true" data-checked="${checked}">${inlineMd(
            lines[i].slice(6),
          )}</li>`,
        );
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        /^- /.test(lines[i]) &&
        !/^- \[/.test(lines[i])
      ) {
        items.push(`<li>${inlineMd(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\d+\. /, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  return out.join("");
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  const inner = () => nodestoMd(node.childNodes);
  const style = node.getAttribute("style") ?? "";
  switch (tag) {
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `_${inner()}_`;
    case "a":
      return `[${inner()}](${node.getAttribute("href") ?? ""})`;
    case "h1":
    case "h2":
    case "h3":
      return `## ${inner()}\n`;
    case "blockquote":
      return `> ${inner().trim()}\n`;
    case "br":
      return "\n";
    case "p":
      return `${inner()}\n`;
    case "div": {
      const c = inner();
      return c.trim() ? (c.endsWith("\n") ? c : c + "\n") : "";
    }
    case "ul": {
      const items: string[] = [];
      node.querySelectorAll(":scope > li").forEach((li) => {
        const el = li as HTMLElement;
        const isTask =
          el.classList.contains("task-item") || el.dataset.task === "true";
        const checked = el.dataset.checked === "true";
        const txt = nodestoMd(li.childNodes).trim();
        items.push(isTask ? `- [${checked ? "x" : " "}] ${txt}` : `- ${txt}`);
      });
      return items.join("\n") + "\n";
    }
    case "ol": {
      const items: string[] = [];
      let n = 1;
      node.querySelectorAll(":scope > li").forEach((li) => {
        items.push(`${n++}. ${nodestoMd(li.childNodes).trim()}`);
      });
      return items.join("\n") + "\n";
    }
    case "li":
      return ""; // consumed by ul/ol handler
    case "span": {
      let t = inner();
      if (style.includes("font-weight") && /bold|700/.test(style))
        t = `**${t}**`;
      if (style.includes("font-style") && style.includes("italic"))
        t = `_${t}_`;
      return t;
    }
    default:
      return inner();
  }
}
function nodestoMd(nodes: NodeList): string {
  let r = "";
  for (const n of nodes) r += nodeToMd(n);
  return r;
}
function htmlToMd(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return nodestoMd(div.childNodes)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── DetailsEditor component ──────────────────────────────────────────────────

function DetailsEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const lastMdRef = useRef(value);
  const skipSyncRef = useRef(false);

  // Link-insertion bar
  const [showLinkBar, setShowLinkBar] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  // Placeholder visibility
  const [isEmpty, setIsEmpty] = useState(!value.trim());

  // Which formats apply at the current caret/selection (drives toolbar highlight)
  const [active, setActive] = useState<Record<MdFormat, boolean>>({
    bold: false,
    italic: false,
    heading: false,
    quote: false,
    link: false,
    ul: false,
    ol: false,
    checklist: false,
  });

  const closestEl = (node: Node | null | undefined): Element | null => {
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element);
  };
  const closestLi = (): HTMLLIElement | null =>
    (closestEl(window.getSelection()?.anchorNode)?.closest(
      "li",
    ) as HTMLLIElement) ?? null;

  const placeCaret = (node: Node, offset: number) => {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  const updateActive = () => {
    const el = divRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    if (!el.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    const block = String(document.queryCommandValue("formatBlock") || "")
      .toLowerCase()
      .replace(/[<>]/g, "");
    const li = closestLi();
    const isTask = !!li?.classList.contains("task-item");
    const inUl = document.queryCommandState("insertUnorderedList");
    setActive({
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      bold: document.queryCommandState("bold"),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      italic: document.queryCommandState("italic"),
      heading: /^h[1-6]$/.test(block),
      quote: block === "blockquote",
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      ol: document.queryCommandState("insertOrderedList"),
      ul: inUl && !isTask,
      checklist: isTask,
      link: !!closestEl(sel.anchorNode)?.closest("a"),
    });
  };

  // Keep the toolbar highlight in sync as the caret moves
  useEffect(() => {
    const handler = () => updateActive();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Init from value once on mount
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    el.innerHTML = mdToHtml(value) || "<p><br></p>";
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("defaultParagraphSeparator", false, "p");
    lastMdRef.current = value;
    setIsEmpty(!value.trim());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value changes (form reset after submit)
  useEffect(() => {
    if (skipSyncRef.current) return;
    if (value === lastMdRef.current) return;
    const el = divRef.current;
    if (!el) return;
    el.innerHTML = mdToHtml(value) || "<p><br></p>";
    lastMdRef.current = value;
    setIsEmpty(!value.trim());
  }, [value]);

  const fireChange = () => {
    const el = divRef.current;
    if (!el) return;
    const md = htmlToMd(el.innerHTML);
    lastMdRef.current = md;
    skipSyncRef.current = true;
    setIsEmpty(!md.trim());
    onChange(md);
    updateActive();
    requestAnimationFrame(() => {
      skipSyncRef.current = false;
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const exec = (cmd: string, arg?: string) => {
    const el = divRef.current;
    if (!el) return;
    el.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, arg);
    fireChange();
  };

  const handleLinkBtn = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    setLinkUrl("https://");
    setShowLinkBar(true);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  };

  const commitLink = () => {
    const div = divRef.current;
    if (!div) {
      setShowLinkBar(false);
      return;
    }
    const url = linkUrl.trim();
    if (!url || url === "https://") {
      setShowLinkBar(false);
      div.focus();
      return;
    }
    div.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand("createLink", false, url);
    setShowLinkBar(false);
    fireChange();
  };

  const applyFormat = (type: MdFormat) => {
    switch (type) {
      case "bold":
        exec("bold");
        break;
      case "italic":
        exec("italic");
        break;
      // formatBlock doesn't toggle on its own - clicking an active block sends it back to a plain paragraph
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
        // Toggle: if we're already in a checklist item, drop back to a plain bullet
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
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      const bq = closestEl(sel?.anchorNode)?.closest(
        "blockquote",
      ) as HTMLElement | null;

      // Inside a quote: Enter adds another quote line; a second Enter on an
      // empty line breaks out into a normal paragraph.
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

      // Propagate the task-item marker onto the new line of a checklist
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
    if (e.key === "Escape" && showLinkBar) {
      setShowLinkBar(false);
      divRef.current?.focus();
    }
  };

  // Click the ☐/☑ box to toggle a checklist item
  const onEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const li = (e.target as HTMLElement).closest?.(
      "li.task-item",
    ) as HTMLElement | null;
    if (!li) return;
    const rect = li.getBoundingClientRect();
    if (e.clientX - rect.left <= 22) {
      li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
      fireChange();
    }
  };

  return (
    <div className="mt-1">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 rounded-t-md border border-b-0 border-slate-300 bg-slate-50 px-1.5 py-1 min-h-[2rem]">
        {showLinkBar ? (
          <div className="flex flex-1 items-center gap-1.5">
            <span className="text-xs text-slate-400">🔗</span>
            <input
              ref={linkInputRef}
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLink();
                }
                if (e.key === "Escape") {
                  setShowLinkBar(false);
                  divRef.current?.focus();
                }
              }}
              placeholder="https://"
              className="flex-1 rounded border border-slate-300 px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commitLink();
              }}
              className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Insert
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowLinkBar(false);
                divRef.current?.focus();
              }}
              className="rounded px-1 py-0.5 text-xs text-slate-400 hover:bg-slate-200"
            >
              ✕
            </button>
          </div>
        ) : (
          TOOLBAR_BTNS.map((btn) => (
            <span key={btn.type} className="contents">
              {DIVIDER_BEFORE[btn.type] && (
                <span className="mx-1 h-3.5 w-px shrink-0 bg-slate-300" />
              )}
              <button
                type="button"
                title={btn.title}
                aria-pressed={active[btn.type]}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat(btn.type);
                }}
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs hover:bg-slate-200 active:bg-slate-300",
                  btn.mono && "font-bold font-mono",
                  active[btn.type]
                    ? "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent)]"
                    : "text-slate-600",
                )}
              >
                {btn.label}
              </button>
            </span>
          ))
        )}
      </div>

      {/* Editable area */}
      <div className="relative">
        {isEmpty && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400 select-none">
            What&apos;s wrong, and what did you expect?
          </p>
        )}
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          onInput={fireChange}
          onKeyDown={onKeyDown}
          onClick={onEditorClick}
          onMouseUp={updateActive}
          onFocus={updateActive}
          className="md-editor min-h-[8rem] w-full rounded-b-md border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
        />
      </div>
    </div>
  );
}
