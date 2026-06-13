import { checkSession } from "@/lib/cmsbar/server/handlers/sessionCheck";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function GET(req: Request) {
  return checkSession(req, cookieCtxFromRequest(req));
}
