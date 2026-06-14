// The entire CMSBar API, mounted as one TanStack Start server route.
//
// A server route is a file route with a `server.handlers` object and no
// component: TanStack Start never renders it, it just runs the matching method
// handler and returns the web Response. The neutral dispatcher,
// handleCmsRequest(request), inspects the request method + URL and routes to the
// matching CMS handler (commit, session/*, issues, images, media, preview,
// resolve-map, login, logout, versions). It strips the "/api/cms" base itself
// and reads cookies off the request Cookie header.
//
// The filename api/cms.$.ts registers the splat route "/api/cms/$", so every
// /api/cms/<anything> request - for every HTTP method the dispatcher uses
// (GET, POST, PATCH) - lands here.

import { createFileRoute } from "@tanstack/react-router";
import { handleCmsRequest } from "@/lib/cmsbar/server/router";

export const Route = createFileRoute("/api/cms/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleCmsRequest(request),
      POST: ({ request }) => handleCmsRequest(request),
      PATCH: ({ request }) => handleCmsRequest(request),
    },
  },
});
