import { sessionClear } from "@/lib/cmsbar/server/handlers/sessionClear";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function POST(req: Request) {
  return sessionClear(req, cookieCtxFromRequest(req));
}
