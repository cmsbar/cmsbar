import crypto from "node:crypto";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  slugify,
} from "@/lib/cmsbar/session";
import {
  baseBranchName,
  ensureBranch,
  createPullRequest,
  findOpenPullRequest,
} from "@/lib/cmsbar/backend/github";
import { buildCmsMetaMarker } from "@/lib/cmsbar/cmsMeta";
import { draftBranch } from "@/lib/cmsbar/keys";
import { publishingMode } from "@/lib/cmsbar/config";
import { cmsConfig } from "@/cms.config";
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

export const sessionStart: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const { title, pagePath } = (await req.json().catch(() => ({}))) as {
    title?: string;
    pagePath?: string;
  };
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return json({ error: "Missing title" }, { status: 400 });
  }
  const trimmed = title.trim().slice(0, 100);
  const normalizedPagePath =
    typeof pagePath === "string" && pagePath.startsWith("/")
      ? pagePath
      : undefined;
  const slug = slugify(trimmed);
  const shortId = crypto.randomBytes(3).toString("hex");
  const sessionId = `${slug}-${shortId}`;
  const branch = draftBranch(sessionId);

  // Direct publishing: no cms/* branch and no PR. The session's "draft"
  // points at the base branch itself - same cookie shape, so ContentProvider's
  // branch-keyed persistence keeps working - and every save commits (and
  // deploys) straight to base.
  if (publishingMode(cmsConfig) === "direct") {
    const base = baseBranchName();
    const token = signSession({
      user: session.user,
      issuedAt: session.issuedAt,
      draft: {
        sessionId: `live-${shortId}`,
        branch: base,
        title: "Live edits",
        pagePath: normalizedPagePath,
      },
    });
    const res = json({
      ok: true,
      branch: base,
      title: "Live edits",
    });
    appendCookie(res, sessionCookie(token));
    return res;
  }

  try {
    await ensureBranch(branch);
    let prInfo: { number?: number; url?: string } = {};
    try {
      const existing = await findOpenPullRequest(branch);
      if (existing) {
        prInfo = { number: existing.number, url: existing.html_url };
      } else {
        const pr = await createPullRequest({
          head: branch,
          title: `[CMS draft] ${trimmed}`,
          body: `Auto-opened by the in-page editor.\n\n_Editor:_ ${session.user}\n_Draft title:_ ${trimmed}\n\n${buildCmsMetaMarker({ pagePath: normalizedPagePath })}`,
          draft: false,
        });
        prInfo = { number: pr.number, url: pr.html_url };
      }
    } catch (prErr) {
      // PR can still be created later by /api/cms/commit. Don't fail session start.
      console.error("CMS: createPullRequest failed in session/start", prErr);
    }

    const token = signSession({
      user: session.user,
      issuedAt: session.issuedAt,
      draft: {
        sessionId,
        branch,
        title: trimmed,
        prNumber: prInfo.number,
        prUrl: prInfo.url,
        pagePath: normalizedPagePath,
      },
    });
    const res = json({
      ok: true,
      branch,
      title: trimmed,
      prUrl: prInfo.url,
    });
    appendCookie(res, sessionCookie(token));
    return res;
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
