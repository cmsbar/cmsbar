import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";

export async function GET() {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    user: session.user,
    draft: session.draft ?? null,
  });
}
