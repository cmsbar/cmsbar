import { logout } from "@/lib/cmsbar/server/handlers/logout";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function POST(req: Request) {
  return logout(req, cookieCtxFromRequest(req));
}
