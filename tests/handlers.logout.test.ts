import { describe, it, expect } from "vitest";

// session.ts requires a secret to load (SESSION_COOKIE is exported from it).
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

import { logout } from "@/lib/cmsbar/server/handlers/logout";
import { SESSION_COOKIE } from "@/lib/cmsbar/session";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () =>
  new Request("http://localhost/api/cms/logout", { method: "POST" });

describe("logout handler", () => {
  it("returns ok:true", async () => {
    const res = await logout(req(), ctx("any-token"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("clears the session cookie via Set-Cookie Max-Age=0", async () => {
    const res = await logout(req(), ctx("any-token"));
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
  });

  it("clears the cookie even when no session cookie is present", async () => {
    const res = await logout(req(), ctx(undefined));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
