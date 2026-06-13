import { commit } from "@/lib/cmsbar/server/handlers/commit";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function POST(req: Request) {
  return commit(req, cookieCtxFromRequest(req));
}
