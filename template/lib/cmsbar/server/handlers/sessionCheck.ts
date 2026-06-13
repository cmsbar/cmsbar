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
import {
  type CmsHandler,
  appendCookie,
  json,
  sessionCookie,
} from "@/lib/cmsbar/server/http";

// Re-issue the session cookie once it's older than this, so an active editor
// gets a rolling 12h window instead of a hard logout mid-edit. This route is
// polled every 30s while a draft is open, which makes it the natural refresh
// point.
const ROLL_AFTER_MS = 60 * 60 * 1000;

function rolled(res: Response, session: Session): Response {
  if (Date.now() - session.issuedAt < ROLL_AFTER_MS) return res;
  return appendCookie(
    res,
    sessionCookie(signSession({ ...session, issuedAt: Date.now() })),
  );
}

// Returns the freshest state of the active draft so the client can disable
// editing if a reviewer has approved the PR since this page loaded.
export const checkSession: CmsHandler = async (_req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) return json({ authenticated: false });
  if (!session.draft) {
    return rolled(json({ authenticated: true, draft: null }), session);
  }
  try {
    let pr = session.draft.prNumber
      ? await getPullRequest(session.draft.prNumber).catch(() => null)
      : null;
    if (!pr) {
      pr = await findOpenPullRequest(session.draft.branch);
    }
    const approved = pr ? isApproved(pr.labels) : false;
    return rolled(
      json({
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
      }),
      session,
    );
  } catch (err) {
    return rolled(
      json({
        authenticated: true,
        draft: { ...session.draft, error: String(err) },
      }),
      session,
    );
  }
};
