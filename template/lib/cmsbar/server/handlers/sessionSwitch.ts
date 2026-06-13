import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "@/lib/cmsbar/session";
import { findOpenPullRequest, getBranchSha } from "@/lib/cmsbar/backend/github";
import { parseCmsMeta } from "@/lib/cmsbar/cmsMeta";
import { isDraftBranch, BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

// Switch the active draft to an existing CMS branch.
export const sessionSwitch: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const { branch, title } = (await req.json().catch(() => ({}))) as {
    branch?: string;
    title?: string;
  };
  if (!branch || !isDraftBranch(branch)) {
    return json(
      { error: `Branch must start with ${BRANCH_PREFIX}` },
      { status: 400 },
    );
  }

  try {
    const sha = await getBranchSha(branch);
    if (!sha) {
      return json({ error: `Branch ${branch} not found` }, { status: 404 });
    }
    const sessionId = branch.slice(BRANCH_PREFIX.length);
    const existing = await findOpenPullRequest(branch);
    const pagePath = parseCmsMeta(existing?.body).pagePath;
    const draftTitle = title ?? sessionId;
    const token = signSession({
      user: session.user,
      issuedAt: session.issuedAt,
      draft: {
        sessionId,
        branch,
        title: draftTitle,
        prNumber: existing?.number,
        prUrl: existing?.html_url,
        pagePath,
      },
    });
    const res = json({
      ok: true,
      branch,
      title: draftTitle,
      prUrl: existing?.html_url,
      pagePath,
    });
    appendCookie(res, sessionCookie(token));
    return res;
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
