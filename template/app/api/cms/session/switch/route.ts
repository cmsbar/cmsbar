import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "@/lib/cmsbar/session";
import { findOpenPullRequest, getBranchSha } from "@/lib/cmsbar/backend/github";
import { parseCmsMeta } from "@/lib/cmsbar/cmsMeta";
import { isDraftBranch, BRANCH_PREFIX } from "@/lib/cmsbar/keys";

function setCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

// Switch the active draft to an existing CMS branch.
export async function POST(req: Request) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { branch, title } = (await req.json().catch(() => ({}))) as {
    branch?: string;
    title?: string;
  };
  if (!branch || !isDraftBranch(branch)) {
    return NextResponse.json(
      { error: `Branch must start with ${BRANCH_PREFIX}` },
      { status: 400 },
    );
  }

  try {
    const sha = await getBranchSha(branch);
    if (!sha) {
      return NextResponse.json(
        { error: `Branch ${branch} not found` },
        { status: 404 },
      );
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
    const res = NextResponse.json({
      ok: true,
      branch,
      title: draftTitle,
      prUrl: existing?.html_url,
      pagePath,
    });
    setCookie(res, token);
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
