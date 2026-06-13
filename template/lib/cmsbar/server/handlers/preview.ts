import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { getFile } from "@/lib/cmsbar/backend/github";
import { isDraftBranch, BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import { cmsConfig } from "@/cms.config";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

// Returns the content/site-content.json on a given branch - used by the
// preview mode to render the page with that draft's content.
export const preview: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const branch = url.searchParams.get("branch");
  if (!branch || !isDraftBranch(branch)) {
    return json(
      { error: `branch must start with ${BRANCH_PREFIX}` },
      { status: 400 },
    );
  }
  try {
    const file = await getFile(branch, cmsConfig.contentFile);
    if (!file) {
      return json({ content: null }, { status: 200 });
    }
    return json({ content: JSON.parse(file.content) });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
