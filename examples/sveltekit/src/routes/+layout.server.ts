// Root layout server load: derive the initial CMS state from the session
// cookie and hand it to the client store. This is the SSR seed for the editing
// foundation - the bundled content fallback is imported on the client directly
// (it is build-time data), so we only ship the session-derived CmsState here.
//
// No editing UI exists yet (that is a later phase); this just proves the store
// can be seeded server-side and hydrated into Svelte context.

import { verifySession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ cookies }) => {
  let authenticated = false;
  let user: string | undefined;
  let draft:
    | {
        sessionId: string;
        branch: string;
        title: string;
        prNumber?: number;
        prUrl?: string;
        pagePath?: string;
      }
    | undefined;

  try {
    const session = verifySession(cookies.get(SESSION_COOKIE));
    if (session) {
      authenticated = true;
      user = session.user;
      if (session.draft) draft = session.draft;
    }
  } catch {
    // Missing CMS_SESSION_SECRET (e.g. unconfigured dev): treat as logged out.
    authenticated = false;
  }

  return { initialCms: { authenticated, user, draft } };
};
