import {
  createIssueHandler,
  listIssuesHandler,
} from "@/lib/cmsbar/server/handlers/issues";
import { cookieCtxFromRequest } from "@/lib/cmsbar/server/http";

export const dynamic = "force-dynamic";

// Thin Next App Router wrapper: build the neutral request context from the
// request and delegate to the framework-agnostic handlers.
export function GET(req: Request) {
  return listIssuesHandler(req, cookieCtxFromRequest(req));
}

export function POST(req: Request) {
  return createIssueHandler(req, cookieCtxFromRequest(req));
}
