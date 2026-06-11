import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  slugify,
} from "@/lib/cmsbar/session";
import {
  ensureBranch,
  createPullRequest,
  findOpenPullRequest,
} from "@/lib/cmsbar/backend/github";
import { buildCmsMetaMarker } from "@/lib/cmsbar/cmsMeta";
import { draftBranch } from "@/lib/cmsbar/keys";

function setCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function POST(req: Request) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { title, pagePath } = (await req.json().catch(() => ({}))) as {
    title?: string;
    pagePath?: string;
  };
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
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
    const res = NextResponse.json({
      ok: true,
      branch,
      title: trimmed,
      prUrl: prInfo.url,
    });
    setCookie(res, token);
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
