// Server-only Nuxt plugin: derive the initial CMS state from the session cookie
// and seed it into a useState ref so the client store hydrates with the same
// CmsState the server rendered. This is the Nuxt analogue of
// examples/sveltekit/src/routes/+layout.server.ts.
//
// The `.server.ts` suffix means this plugin (and its imports) are tree-shaken
// out of the CLIENT bundle entirely, so verifySession's node:crypto dependency
// never reaches the browser. The useState value it writes is serialized into the
// Nuxt payload and read back on the client by useInitialCms().

import { defineNuxtPlugin, useState, useRequestEvent } from "nuxt/app";
import { getCookie } from "h3";
import { verifySession, SESSION_COOKIE } from "@/lib/cmsbar/session";
import type { CmsState } from "@/cmsbar/content";

export default defineNuxtPlugin(() => {
  const state = useState<CmsState>("cmsbar:initial", () => ({
    authenticated: false,
  }));

  const event = useRequestEvent();
  if (!event) return;

  try {
    const session = verifySession(getCookie(event, SESSION_COOKIE));
    if (session) {
      state.value = {
        authenticated: true,
        user: session.user,
        draft: session.draft ?? undefined,
      };
    }
  } catch {
    // Missing CMS_SESSION_SECRET (e.g. unconfigured dev): treat as logged out.
    state.value = { authenticated: false };
  }
});
