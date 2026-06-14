// The entire CMSBar API, mounted as one SvelteKit endpoint.
//
// `[...path]` is a rest (catch-all) param, so this route matches every
// /api/cms/<anything> path. A SvelteKit endpoint is a set of HTTP-method
// handlers; each receives a RequestEvent whose `.request` is a web-standard
// Request and may return a web-standard Response - exactly what the neutral CMS
// dispatcher needs.
//
// createCmsApi() returns a single (req: Request) => Promise<Response> covering
// every CMS route (session, login, logout, commit, issues, images, media,
// preview, resolve-map, versions). It strips the "/api/cms" base itself, reads
// cookies off the request's Cookie header, and 404s unknown paths - so we just
// forward the raw request to it. We export the methods the API actually uses
// (GET/POST/PATCH); SvelteKit answers any other method with 405 automatically.

import { createCmsApi } from "@/lib/cmsbar/server/companion";
import type { RequestHandler } from "./$types";

const cms = createCmsApi();

export const GET: RequestHandler = ({ request }) => cms(request);
export const POST: RequestHandler = ({ request }) => cms(request);
export const PATCH: RequestHandler = ({ request }) => cms(request);
