import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import {
  addIssueLabels,
  removeIssueLabel,
  setIssueState,
} from "@/lib/cmsbar/backend/github";
import {
  IN_PROGRESS_LABEL,
  type IssueStatus,
} from "@/lib/cmsbar/backend/issues";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

export const patchIssue: CmsHandler = async (req, ctx) => {
  if (!verifySession(ctx.cookies.get(SESSION_COOKIE))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // The dispatcher accepts a trailing slash (normalizes it for matching), so
  // strip it here too before taking the last segment - otherwise /issues/5/
  // pops an empty segment.
  const raw =
    new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    return json(
      { error: "Invalid issue number" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    status?: IssueStatus;
  } | null;
  const status = body?.status;

  try {
    if (status === "closed") {
      await setIssueState(number, "closed");
      await removeIssueLabel(number, IN_PROGRESS_LABEL);
    } else if (status === "open") {
      await setIssueState(number, "open");
      await removeIssueLabel(number, IN_PROGRESS_LABEL);
    } else if (status === "in-progress") {
      await setIssueState(number, "open");
      await addIssueLabels(number, [IN_PROGRESS_LABEL]);
    } else {
      return json({ error: "Unknown status" }, { status: 400 });
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, { status: 500 });
  }
};
