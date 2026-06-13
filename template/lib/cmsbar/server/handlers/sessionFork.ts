import crypto from "node:crypto";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  slugify,
} from "@/lib/cmsbar/session";
import {
  getBranchSha,
  createPullRequest,
  findOpenPullRequest,
} from "@/lib/cmsbar/backend/github";
import { parseCmsMeta, buildCmsMetaMarker } from "@/lib/cmsbar/cmsMeta";
import { draftBranch } from "@/lib/cmsbar/keys";
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

async function createBranchFrom(
  branch: string,
  fromSha: string,
): Promise<void> {
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "cmsbar",
      },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createBranchFrom ${branch} failed: ${res.status} ${text}`);
  }
}

export const sessionFork: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const { fromBranch, title } = (await req.json().catch(() => ({}))) as {
    fromBranch?: string;
    title?: string;
  };
  if (!fromBranch) {
    return json({ error: "Missing fromBranch" }, { status: 400 });
  }
  if (!title || title.trim().length === 0) {
    return json({ error: "Missing title" }, { status: 400 });
  }
  const trimmed = title.trim().slice(0, 100);
  const slug = slugify(trimmed);
  const shortId = crypto.randomBytes(3).toString("hex");
  const newSessionId = `${slug}-${shortId}`;
  const newBranch = draftBranch(newSessionId);

  try {
    const [sourceSha, sourcePr] = await Promise.all([
      getBranchSha(fromBranch),
      findOpenPullRequest(fromBranch).catch(() => null),
    ]);
    if (!sourceSha) {
      return json(
        { error: `Source branch ${fromBranch} not found` },
        { status: 404 },
      );
    }
    const forkPagePath = parseCmsMeta(sourcePr?.body).pagePath;
    await createBranchFrom(newBranch, sourceSha);

    let prInfo: { number?: number; url?: string } = {};
    try {
      const existing = await findOpenPullRequest(newBranch);
      if (existing) {
        prInfo = { number: existing.number, url: existing.html_url };
      } else {
        const pr = await createPullRequest({
          head: newBranch,
          title: `[CMS draft] ${trimmed}`,
          body: `Forked from \`${fromBranch}\` by ${session.user}.\n\n_Title:_ ${trimmed}\n\n${buildCmsMetaMarker({ pagePath: forkPagePath })}`,
          draft: false,
        });
        prInfo = { number: pr.number, url: pr.html_url };
      }
    } catch (prErr) {
      console.error("CMS: createPullRequest failed in fork", prErr);
    }

    const token = signSession({
      user: session.user,
      issuedAt: session.issuedAt,
      draft: {
        sessionId: newSessionId,
        branch: newBranch,
        title: trimmed,
        prNumber: prInfo.number,
        prUrl: prInfo.url,
        pagePath: forkPagePath,
      },
    });
    const res = json({
      ok: true,
      branch: newBranch,
      title: trimmed,
      prUrl: prInfo.url,
    });
    appendCookie(res, sessionCookie(token));
    return res;
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
