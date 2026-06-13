import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

import { resolveMap } from "@/lib/cmsbar/server/handlers/resolveMap";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}

// A valid logged-in session token, reused across the authenticated cases.
const TOKEN = signSession({ user: "admin", issuedAt: Date.now() });

function req(body?: unknown) {
  return new Request("http://localhost/api/cms/resolve-map", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("resolveMap handler", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("rejects an unauthenticated request with 401", async () => {
    const res = await resolveMap(req({ url: "https://maps.app.goo.gl/x" }), ctx(undefined));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 400 bad request when the body is not valid JSON", async () => {
    const res = await resolveMap(req(), ctx(TOKEN));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  it("returns 400 when the url is not http(s)", async () => {
    const res = await resolveMap(req({ url: "ftp://example.com" }), ctx(TOKEN));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "url must be http(s)" });
  });

  it("returns 400 when the host is not a google maps host", async () => {
    const res = await resolveMap(req({ url: "https://example.com/x" }), ctx(TOKEN));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not a google maps url" });
  });

  it("passes an already-embed URL straight through without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const url = "https://maps.google.com/maps?q=x&output=embed";
    const res = await resolveMap(req({ url }), ctx(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ embed: url });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("follows a short link and extracts the @lat,lng,zoom embed (happy path)", async () => {
    const finalUrl =
      "https://www.google.com/maps/place/Kea/@45.8129,15.9785,17z/data=abc";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      url: finalUrl,
      text: async () => "",
    } as unknown as Response);

    const res = await resolveMap(
      req({ url: "https://maps.app.goo.gl/abc123" }),
      ctx(TOKEN),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      embed:
        "https://maps.google.com/maps?q=45.8129%2C15.9785&z=17&output=embed",
      finalUrl,
    });
  });

  it("scrapes a canonical URL when the redirect stays on the short host", async () => {
    const canonical =
      "https://www.google.com/maps/place/Kea/@45.8,15.9,18z/data=xyz";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      // Still on goo.gl after following redirects, so the handler scrapes HTML.
      url: "https://maps.app.goo.gl/abc123",
      text: async () =>
        `<link rel="canonical" href="${canonical}">`,
    } as unknown as Response);

    const res = await resolveMap(
      req({ url: "https://maps.app.goo.gl/abc123" }),
      ctx(TOKEN),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      embed: "https://maps.google.com/maps?q=45.8%2C15.9&z=18&output=embed",
      finalUrl: canonical,
    });
  });

  it("returns 502 when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await resolveMap(
      req({ url: "https://maps.app.goo.gl/abc123" }),
      ctx(TOKEN),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Could not follow URL: network down",
    });
  });

  it("returns 422 when no coordinates can be extracted", async () => {
    const finalUrl = "https://www.google.com/maps/no-coords-here";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      url: finalUrl,
      text: async () => "",
    } as unknown as Response);

    const res = await resolveMap(
      req({ url: "https://maps.app.goo.gl/abc123" }),
      ctx(TOKEN),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; finalUrl: string };
    expect(body.finalUrl).toBe(finalUrl);
    expect(body.error).toContain("Could not extract coordinates");
  });
});
