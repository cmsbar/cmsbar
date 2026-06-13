import { mediaList } from "@/lib/cmsbar/server/handlers/mediaList";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler.
export function GET(req: Request) {
  return mediaList(req, cookieCtxFromRequest(req));
}
