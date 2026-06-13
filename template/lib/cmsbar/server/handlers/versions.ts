import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import {
  listOpenPullRequests,
  countCommits,
} from "@/lib/cmsbar/backend/github";
import { approvedLabelName } from "@/lib/cmsbar/approved";
import { BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

export const versions: CmsHandler = async (_req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const approvedLabel = approvedLabelName();
  const base = process.env.GITHUB_BASE_BRANCH || "master";
  try {
    const prs = await listOpenPullRequests(BRANCH_PREFIX);
    // Best-effort commit counts (skip if it fails for any PR).
    const versions = await Promise.all(
      prs.map(async (pr) => {
        let commitCount = 0;
        try {
          commitCount = await countCommits(pr.head.ref, base);
        } catch {
          /* leave 0 */
        }
        const approved = pr.labels.some(
          (l) => l.name.toLowerCase() === approvedLabel,
        );
        return {
          number: pr.number,
          title: pr.title.replace(/^\[CMS draft\]\s*/, ""),
          branch: pr.head.ref,
          headSha: pr.head.sha,
          author: pr.user?.login ?? null,
          updatedAt: pr.updated_at,
          commitCount,
          prUrl: pr.html_url,
          approved,
          labels: pr.labels.map((l) => l.name),
        };
      }),
    );
    return json({ versions, approvedLabel });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
