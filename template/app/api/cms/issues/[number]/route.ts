import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const jar = await cookies();
  if (!verifySession(jar.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { number: raw } = await params;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json(
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
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
