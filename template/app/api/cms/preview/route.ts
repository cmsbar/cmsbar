import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { getFile } from "@/lib/cmsbar/backend/github";
import { isDraftBranch, BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import { cmsConfig } from "@/cms.config";

// Returns the content/site-content.json on a given branch - used by the
// preview mode to render the page with that draft's content.
export async function GET(req: Request) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const branch = url.searchParams.get("branch");
  if (!branch || !isDraftBranch(branch)) {
    return NextResponse.json(
      { error: `branch must start with ${BRANCH_PREFIX}` },
      { status: 400 },
    );
  }
  try {
    const file = await getFile(branch, cmsConfig.contentFile);
    if (!file) {
      return NextResponse.json({ content: null }, { status: 200 });
    }
    return NextResponse.json({ content: JSON.parse(file.content) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
