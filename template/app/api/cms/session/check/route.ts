import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  type Session,
} from "@/lib/cmsbar/session";
import {
  findOpenPullRequest,
  getPullRequest,
} from "@/lib/cmsbar/backend/github";
import { approvedLabelName, isApproved } from "@/lib/cmsbar/approved";

// Re-issue the session cookie once it's older than this, so an active editor
// gets a rolling 12h window instead of a hard logout mid-edit. This route is
// polled every 30s while a draft is open, which makes it the natural refresh
// point.
const ROLL_AFTER_MS = 60 * 60 * 1000;

function rollSession(res: NextResponse, session: Session): void {
  if (Date.now() - session.issuedAt < ROLL_AFTER_MS) return;
  const refreshed = signSession({ ...session, issuedAt: Date.now() });
  res.cookies.set(SESSION_COOKIE, refreshed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

// Returns the freshest state of the active draft so the client can disable
// editing if a reviewer has approved the PR since this page loaded.
export async function GET() {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false });
  if (!session.draft) {
    const res = NextResponse.json({ authenticated: true, draft: null });
    rollSession(res, session);
    return res;
  }
  try {
    let pr = session.draft.prNumber
      ? await getPullRequest(session.draft.prNumber).catch(() => null)
      : null;
    if (!pr) {
      pr = await findOpenPullRequest(session.draft.branch);
    }
    const approved = pr ? isApproved(pr.labels) : false;
    const res = NextResponse.json({
      authenticated: true,
      draft: {
        ...session.draft,
        prState: pr?.state ?? null,
        approved,
        approvedLabel: approvedLabelName(),
        // Surface the actual labels GitHub returned, so the editor can confirm
        // the label name matches CMS_APPROVED_LABEL when something feels off.
        labels: pr?.labels.map((l) => l.name) ?? [],
      },
    });
    rollSession(res, session);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { authenticated: true, draft: { ...session.draft, error: String(err) } },
      { status: 200 },
    );
    rollSession(res, session);
    return res;
  }
}
