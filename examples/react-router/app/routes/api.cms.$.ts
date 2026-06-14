// The entire CMSBar API, mounted as one React Router resource route.
//
// A resource route is a route module with NO default export: React Router never
// renders it, it just runs the loader (for GET/HEAD) or the action (for any
// other method) and returns the Response. The neutral dispatcher,
// handleCmsRequest(request), inspects the request method + URL and routes to the
// matching CMS handler (commit, session/*, issues, images, media, preview,
// resolve-map, login, logout, versions). It strips the "/api/cms" base itself.
//
// Registered in app/routes.ts as the splat route route("api/cms/*", ...), so
// every /api/cms/<anything> request lands here.

import { handleCmsRequest } from "@/lib/cmsbar/server/router";

export function loader({ request }: { request: Request }) {
  return handleCmsRequest(request);
}

export function action({ request }: { request: Request }) {
  return handleCmsRequest(request);
}
