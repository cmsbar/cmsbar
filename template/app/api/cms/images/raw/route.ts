import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { getFileBinary } from "@/lib/cmsbar/backend/github";
import { isDraftBranch, BRANCH_PREFIX } from "@/lib/cmsbar/keys";
import { isAllowedRepoPath, describeAllowedFolders } from "@/lib/cmsbar/media";

function mimeFor(filepath: string): string {
  const ext = filepath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export async function GET(req: Request) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const branch = url.searchParams.get("branch");
  const path = url.searchParams.get("path");
  if (!branch || !path) {
    return NextResponse.json(
      { error: "Missing branch or path" },
      { status: 400 },
    );
  }
  // Only serve files inside the configured media folders - never any '..'
  if (!isAllowedRepoPath(path)) {
    return NextResponse.json(
      { error: `Path outside ${describeAllowedFolders()}` },
      { status: 400 },
    );
  }
  if (!isDraftBranch(branch)) {
    return NextResponse.json(
      { error: `Branch must start with ${BRANCH_PREFIX}` },
      { status: 400 },
    );
  }
  try {
    const file = await getFileBinary(branch, path);
    if (!file) {
      return NextResponse.json(
        { error: "Not found on branch" },
        { status: 404 },
      );
    }
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": mimeFor(path),
        "content-length": String(file.bytes.length),
        // Short cache so the same session-served image doesn't re-fetch on every scroll
        // but stale entries clear quickly when a draft changes.
        "cache-control": "private, max-age=30, must-revalidate",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
