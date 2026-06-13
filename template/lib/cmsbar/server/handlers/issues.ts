import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { createIssue, listIssues } from "@/lib/cmsbar/backend/github";
import {
  CMS_ISSUE_LABEL,
  buildIssueLabels,
  elementMarker,
  parseIssue,
  PRIORITIES,
  SCOPES,
  type IssuePriority,
  type IssueScope,
} from "@/lib/cmsbar/backend/issues";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

function sessionUser(ctx: { cookies: { get(name: string): string | undefined } }): string | null {
  return verifySession(ctx.cookies.get(SESSION_COOKIE))?.user ?? null;
}

export const listIssuesHandler: CmsHandler = async (_req, ctx) => {
  if (!sessionUser(ctx)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const raw = await listIssues({ labels: CMS_ISSUE_LABEL, state: "all" });
    return json(
      { issues: raw.map(parseIssue) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};

export const createIssueHandler: CmsHandler = async (req, ctx) => {
  const user = sessionUser(ctx);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    details?: string;
    priority?: string;
    scope?: string;
    page?: string;
    pageUrl?: string;
    elementPath?: string;
  } | null;

  const title = body?.title?.trim();
  if (!title) {
    return json({ error: "Title is required" }, { status: 400 });
  }

  const priority = (
    PRIORITIES.includes(body?.priority as IssuePriority)
      ? body!.priority
      : "medium"
  ) as IssuePriority;
  const scope = (
    SCOPES.includes(body?.scope as IssueScope) ? body!.scope : "page"
  ) as IssueScope;
  const page = typeof body?.page === "string" && body.page ? body.page : "/";
  const pageUrl =
    typeof body?.pageUrl === "string" && body.pageUrl ? body.pageUrl : null;
  const elementPath =
    typeof body?.elementPath === "string" && body.elementPath
      ? body.elementPath
      : null;

  const labels = buildIssueLabels({ priority, scope, page });

  const scopeNote =
    scope === "page"
      ? ""
      : scope === "editor"
        ? " (about the CMS / editing experience)"
        : " (shows on every page)";

  const contextLines = [
    "",
    "---",
    pageUrl
      ? `_Filed from the CMS bar - [${page}](${pageUrl})_`
      : "_Filed from the CMS bar._",
    scope !== "editor" ? `- **Page:** \`${page}\`` : null,
    elementPath && scope !== "editor"
      ? `- **Element:** \`${elementPath}\``
      : null,
    `- **Scope:** ${scope}${scopeNote}`,
    `- **Reporter:** ${user}`,
    elementPath && scope !== "editor"
      ? `\n${elementMarker(elementPath)}`
      : null,
  ].filter(Boolean);
  const issueBody = `${(body?.details ?? "").trim()}\n${contextLines.join(
    "\n",
  )}`;

  try {
    const created = await createIssue({ title, body: issueBody, labels });
    return json({ issue: parseIssue(created) });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
