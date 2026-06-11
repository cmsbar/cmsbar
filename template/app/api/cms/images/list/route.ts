import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { ensureBranch, listTree } from "@/lib/cmsbar/backend/github";
import { MEDIA_FOLDERS } from "@/lib/cmsbar/media";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg)$/i;

export async function GET() {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Library always reads from the active draft's branch (committed-but-pending
  // uploads only show up after the next Save).
  const branch =
    session.draft?.branch ?? process.env.GITHUB_BASE_BRANCH ?? "master";
  try {
    if (session.draft) await ensureBranch(branch);
    const entries = await listTree(branch, MEDIA_FOLDERS[0]);
    const images = entries
      .filter((e) => IMAGE_EXT.test(e.path))
      .map((e) => ({
        path: "/" + e.path.replace(/^public\//, ""),
        repoPath: e.path,
        size: e.size,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return NextResponse.json({ images });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
