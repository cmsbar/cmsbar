import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "@/lib/cmsbar/session";
import {
  countCommits,
  deleteBranch,
  getBranchSha,
} from "@/lib/cmsbar/backend/github";

export async function POST() {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // When discarding a draft that never got any committed changes, clean up the
  // orphan branch that session/start created (this also auto-closes the empty
  // draft PR). Branches with real commits are left intact - they stay
  // recoverable from the Versions list.
  let deletedBranch: string | undefined;
  const branch = session.draft?.branch;
  if (branch) {
    try {
      const sha = await getBranchSha(branch);
      if (sha) {
        const base = process.env.GITHUB_BASE_BRANCH || "master";
        const ahead = await countCommits(branch, base);
        if (ahead === 0) {
          await deleteBranch(branch);
          deletedBranch = branch;
        }
      }
    } catch (err) {
      // Non-fatal: never block discarding the draft on a cleanup failure.
      console.error("CMS: failed to remove empty draft branch", err);
    }
  }

  const token = signSession({ user: session.user, issuedAt: session.issuedAt });
  const res = NextResponse.json({ ok: true, deletedBranch });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
