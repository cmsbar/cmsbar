// One fetch wrapper for the CMS API, so the API base is set in a single place
// (a future HostProvider will call setCmsApiBase from the host's apiBase).
let apiBase = "/api/cms";
export function setCmsApiBase(base: string): void {
  apiBase = base.replace(/\/+$/, "");
}
export function cmsFetch(path: string, init?: RequestInit): Promise<Response> {
  const p = path.startsWith("/") ? path : "/" + path;
  return fetch(apiBase + p, init);
}

/** The current API base, for building non-fetch URLs (e.g. the image proxy src). */
export function cmsApiBase(): string {
  return apiBase;
}
