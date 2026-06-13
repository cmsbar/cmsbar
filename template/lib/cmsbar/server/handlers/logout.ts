import {
  type CmsHandler,
  appendCookie,
  clearedSessionCookie,
  json,
} from "@/lib/cmsbar/server/http";

export const logout: CmsHandler = async () => {
  const res = json({ ok: true });
  appendCookie(res, clearedSessionCookie());
  return res;
};
