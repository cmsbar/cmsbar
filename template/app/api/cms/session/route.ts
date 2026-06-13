import { sessionInfo } from "@/lib/cmsbar/server/handlers/sessionInfo";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function GET(req: Request) {
  return sessionInfo(req, cookieCtxFromRequest(req));
}
