import { patchIssue } from "@/lib/cmsbar/server/handlers/issueByNumber";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handler. The [number] param is
// parsed from the request URL inside the handler, so the Next params arg is
// unused.
export function PATCH(req: Request) {
  return patchIssue(req, cookieCtxFromRequest(req));
}
