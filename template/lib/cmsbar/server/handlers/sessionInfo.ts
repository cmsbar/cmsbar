import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

export const sessionInfo: CmsHandler = async (_req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) return json({ authenticated: false });
  return json({
    authenticated: true,
    user: session.user,
    draft: session.draft ?? null,
  });
};
