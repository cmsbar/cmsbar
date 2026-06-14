// Read the initial CMS state for the store. The value is computed server-side by
// the server-only plugin plugins/cmsbar-session.server.ts (which reads + verifies
// the session cookie) and transferred to the client via the Nuxt payload under
// the same useState key. Keeping the node:crypto verify in a `.server` plugin
// keeps it out of the client bundle; this composable is isomorphic and just
// reads the seeded state.

import { useState } from "nuxt/app";
import type { CmsState } from "@/cmsbar/content";

export function useInitialCms(): CmsState {
  // The key MUST match the plugin's useState key. The factory here is the
  // client/SSR-fallback default (logged out) used only if the plugin did not run
  // (it always does during SSR for a request-scoped render).
  const state = useState<CmsState>("cmsbar:initial", () => ({
    authenticated: false,
  }));
  return state.value;
}
