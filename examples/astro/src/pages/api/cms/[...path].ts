// The entire CMSBar API, mounted as one Astro endpoint.
//
// `[...path].ts` is a rest (catch-all) route, so it matches every
// /api/cms/<anything> path. An Astro endpoint is a web Request -> Response
// function; exporting `ALL` handles every HTTP method (GET/POST/PATCH/...),
// which is exactly what the neutral CMS dispatcher needs.
//
// createCmsApi() returns a single (req: Request) => Promise<Response> covering
// every CMS route (session, login, logout, commit, issues, images, media,
// preview, resolve-map, versions). It strips the "/api/cms" base itself, reads
// cookies off the Cookie header, and 404s unknown paths - so we just forward
// the raw request to it.

import type { APIRoute } from "astro";
import { createCmsApi } from "@/lib/cmsbar/server/companion";

export const prerender = false;

const cms = createCmsApi();

export const ALL: APIRoute = ({ request }) => cms(request);
