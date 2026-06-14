// The entire CMSBar API, mounted as one Nitro catch-all route.
//
// `[...path]` is a catch-all segment, so this route matches every
// /api/cms/<anything> path for every HTTP method. Nitro hands each request to
// this defineEventHandler as an H3 event; toWebRequest(event) yields a
// web-standard Request, and returning a web-standard Response is supported.
//
// createCmsApi() returns a single (req: Request) => Promise<Response> covering
// every CMS route (session, login, logout, commit, issues, images, media,
// preview, resolve-map, versions). It strips the "/api/cms" base itself, reads
// cookies off the request's Cookie header, and 404s unknown paths - so we just
// forward the raw request to it.
//
// `defineEventHandler` and `toWebRequest` are auto-imported by Nitro; we import
// toWebRequest from h3 explicitly so this also type-checks standalone.
import { toWebRequest } from "h3";
import { createCmsApi } from "@/lib/cmsbar/server/companion";

const cms = createCmsApi();

export default defineEventHandler((event) => cms(toWebRequest(event)));
