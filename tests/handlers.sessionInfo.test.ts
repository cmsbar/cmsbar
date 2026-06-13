import { describe, it, expect } from "vitest";

// session.ts requires a secret to sign/verify; set one for the suite.
process.env.CMS_SESSION_SECRET = "test-secret-0123456789abcdef";

import { sessionInfo } from "@/lib/cmsbar/server/handlers/sessionInfo";
import { signSession, SESSION_COOKIE } from "@/lib/cmsbar/session";

function ctx(token?: string) {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
  };
}
const req = () => new Request("http://localhost/api/cms/session");

describe("sessionInfo handler", () => {
  it("returns authenticated:false with no session cookie", async () => {
    const res = await sessionInfo(req(), ctx(undefined));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("returns authenticated:false for an invalid/tampered token", async () => {
    const res = await sessionInfo(req(), ctx("not-a-valid-token"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("returns the user and draft:null for a logged-in user with no draft", async () => {
    const token = signSession({ user: "admin", issuedAt: Date.now() });
    const res = await sessionInfo(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      user: "admin",
      draft: null,
    });
  });

  it("surfaces the active draft when the session carries one", async () => {
    const draft = {
      sessionId: "s",
      branch: "cms/x",
      title: "t",
      prNumber: 5,
    };
    const token = signSession({ user: "admin", issuedAt: Date.now(), draft });
    const res = await sessionInfo(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      user: "admin",
      draft,
    });
  });
});
