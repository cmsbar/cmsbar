// Label conventions for CMS-bar issues, shared by the API routes and the
// in-page Issues panel. Pure functions only (no Node/Next imports) so this is
// safe to import from client components.
import type { IssueSummary } from "./github";

/** Every issue filed from the CMS bar carries this label, so the panel can
 *  list them without picking up the team's regular dev issues. */
export const CMS_ISSUE_LABEL = "cms-bar";
/** An open issue with this label is treated as "in progress". */
export const IN_PROGRESS_LABEL = "in-progress";

export const PAGE_LABEL_PREFIX = "cms-page:";
export const SCOPE_LABEL_PREFIX = "cms-scope:";
export const PRIORITY_LABEL_PREFIX = "priority:";

export type IssuePriority = "high" | "medium" | "low";
/** page = one page only · shared = appears on every page · toolbar = the CMS bar itself · editor = about the editing experience. */
export type IssueScope = "page" | "shared" | "toolbar" | "editor";
export type IssueStatus = "open" | "in-progress" | "closed";

export const PRIORITIES: IssuePriority[] = ["high", "medium", "low"];
export const SCOPES: IssueScope[] = ["page", "shared", "toolbar", "editor"];

export type ParsedIssue = {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  updatedAt: string;
  reporter: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  scope: IssueScope;
  /** Set only when scope === "page". */
  page: string | null;
  /** The content path the issue was pinned to, if any. */
  elementPath: string | null;
};

export function buildIssueLabels(args: {
  priority: IssuePriority;
  scope: IssueScope;
  page: string | null;
}): string[] {
  const labels = [CMS_ISSUE_LABEL, `${PRIORITY_LABEL_PREFIX}${args.priority}`];
  if (args.scope === "page" && args.page)
    labels.push(`${PAGE_LABEL_PREFIX}${args.page}`);
  else labels.push(`${SCOPE_LABEL_PREFIX}${args.scope}`);
  return labels;
}

const ELEMENT_MARKER = /<!--\s*cms-element:\s*(.+?)\s*-->/;

export function elementMarker(path: string): string {
  return `<!-- cms-element: ${path} -->`;
}

export function parseIssue(raw: IssueSummary): ParsedIssue {
  const names = raw.labels.map((l) => l.name);
  const status: IssueStatus =
    raw.state === "closed"
      ? "closed"
      : names.includes(IN_PROGRESS_LABEL)
        ? "in-progress"
        : "open";

  const prio = names.find((n) => n.startsWith(PRIORITY_LABEL_PREFIX));
  const priority =
    (prio?.slice(PRIORITY_LABEL_PREFIX.length) as IssuePriority) ?? "medium";

  let scope: IssueScope = "page";
  let page: string | null = null;
  const pageLabel = names.find((n) => n.startsWith(PAGE_LABEL_PREFIX));
  if (pageLabel) {
    scope = "page";
    page = pageLabel.slice(PAGE_LABEL_PREFIX.length);
  } else if (names.includes(`${SCOPE_LABEL_PREFIX}toolbar`)) {
    scope = "toolbar";
  } else if (names.includes(`${SCOPE_LABEL_PREFIX}shared`)) {
    scope = "shared";
  } else if (names.includes(`${SCOPE_LABEL_PREFIX}editor`)) {
    scope = "editor";
  }

  const m = (raw.body ?? "").match(ELEMENT_MARKER);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    htmlUrl: raw.html_url,
    updatedAt: raw.updated_at,
    reporter: raw.user?.login ?? null,
    status,
    priority,
    scope,
    page,
    elementPath: m ? m[1] : null,
  };
}

/** True when the issue should be visible while editing `pathname` -
 *  page-scoped issues match their page; shared/toolbar issues show everywhere. */
export function visibleOnPage(issue: ParsedIssue, pathname: string): boolean {
  if (
    issue.scope === "shared" ||
    issue.scope === "toolbar" ||
    issue.scope === "editor"
  )
    return true;
  return issue.page === pathname;
}
