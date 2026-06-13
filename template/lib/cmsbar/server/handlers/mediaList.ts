import { readdir } from "fs/promises";
import path from "path";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { MEDIA_ROOTS } from "@/lib/cmsbar/media";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|avif)$/i;

// Lists self-hosted media from the running server's public folder. Filesystem-
// based (not GitHub) so it works in local dev and production alike, showing
// whatever is actually deployed - independent of draft branch.
//   ?type=image → public/images (images);  default → public/media (videos)
export const mediaList: CmsHandler = async (req, ctx) => {
  if (!verifySession(ctx.cookies.get(SESSION_COOKIE))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const isImage = new URL(req.url).searchParams.get("type") === "image";
  const sub = isImage ? MEDIA_ROOTS[0] : (MEDIA_ROOTS[1] ?? MEDIA_ROOTS[0]);
  const ext = isImage ? IMAGE_EXT : VIDEO_EXT;
  const dir = path.join(process.cwd(), "public", sub);
  try {
    const names = (await readdir(dir, { recursive: true })) as string[];
    const files = names
      .filter((n) => ext.test(n))
      .map((n) => ({ path: `/${sub}/` + n.split(path.sep).join("/") }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return json({ files });
  } catch {
    // No directory yet - empty library.
    return json({ files: [] });
  }
};
