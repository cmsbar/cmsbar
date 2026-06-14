// Client-side media helpers shared by EditableImage / EditableMedia /
// MediaBrowser / MediaPicker, ported 1:1 from the already-correct
// examples/sveltekit/src/cmsbar/mediaSrc.ts (itself mirroring the React
// originals template/components/cmsbar/EditableImage.tsx + EditableMedia.tsx).
// Kept in one module so the Vue media components never drift apart.
//
// Neutral helpers (cmsApiBase, MEDIA_ROOT) come from @/lib/cmsbar; the embed
// URL normalization + kind detection are UI-layer logic that the React
// components also kept local to the media components.

import { cmsApiBase } from "@/lib/cmsbar/cmsFetch";
import { MEDIA_ROOT } from "@/lib/cmsbar/media";

export type MediaKind = "empty" | "image" | "video" | "embed" | "html";

const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)$/i;

// ── Image src resolution (EditableImage.resolveSrcForBranch) ─────────────────
//
// If we're previewing another draft or editing our own, /images/... paths might
// not be on the local dev server's filesystem yet (committed to a cms/* branch
// but the build hasn't picked it up). Route those through the raw-image proxy so
// they render straight from GitHub.
export function resolveImageSrc(
  src: string,
  branch: string | undefined,
): string {
  if (!src) return src;
  if (!branch) return src;
  if (
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("http")
  )
    return src;
  if (!src.startsWith("/images/")) return src;
  const repoPath = `${MEDIA_ROOT}${src}`;
  return `${cmsApiBase()}/images/raw?branch=${encodeURIComponent(
    branch,
  )}&path=${encodeURIComponent(repoPath)}`;
}

// ── Media src resolution (EditableMedia.resolveForBranch) ────────────────────
export function resolveMediaSrc(
  src: string,
  branch: string | undefined,
): string {
  if (!branch) return src;
  if (!src) return src;
  if (
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("http")
  )
    return src;
  if (!src.startsWith("/images/") && !src.startsWith("/media/")) return src;
  // Videos are too large for the GitHub contents API (1 MB cap) and rarely
  // change mid-draft - serve them straight from the public path. Fresh uploads
  // still preview via their blob: URL.
  if (VIDEO_EXT.test(src)) return src;
  const repoPath = `${MEDIA_ROOT}${src}`;
  return `${cmsApiBase()}/images/raw?branch=${encodeURIComponent(
    branch,
  )}&path=${encodeURIComponent(repoPath)}`;
}

// ── Kind detection (EditableMedia.detectKind) ────────────────────────────────
export function detectKind(value: string): MediaKind {
  const v = value.trim();
  if (!v) return "empty";
  if (v.startsWith("<")) return "html";
  if (/^data:image\//i.test(v)) return "image";
  if (/^data:video\//i.test(v)) return "video";
  if (/^https?:\/\//i.test(v)) return "embed";
  if (VIDEO_EXT.test(v)) return "video";
  if (/\.(jpe?g|png|webp|gif|svg)$/i.test(v)) return "image";
  return "empty";
}

// ── Embed handling (EditableMedia) ───────────────────────────────────────────

const GOOGLE_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "google.com",
  "www.google.com",
]);

export function isGoogleMapsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return GOOGLE_MAPS_HOSTS.has(host);
  } catch {
    return false;
  }
}

// Normalize common embed URLs so editors don't have to remember the exact
// format. Instagram and YouTube both refuse to be framed unless the URL is
// their embed variant.
export function normalizeEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // Instagram: /p/<id>/, /reel/<id>/, /tv/<id>/ -> append /embed
    if (host === "instagram.com") {
      const m = u.pathname.match(/^\/(p|reel|tv)\/([^/]+)\/?$/);
      if (m) return `https://www.instagram.com/${m[1]}/${m[2]}/embed`;
      if (/\/embed\/?$/.test(u.pathname)) return url;
    }

    // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID -> /embed/ID
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    // Vimeo: vimeo.com/<id> (or /channels/.../<id>, optional unlisted hash) ->
    // player.vimeo.com/video/<id> - the bare share link refuses framing.
    if (host === "vimeo.com") {
      const m = u.pathname.match(/\/(\d+)(?:\/([0-9a-z]+))?\/?$/i);
      if (m) {
        const hash = m[2] ? `?h=${m[2]}` : "";
        return `https://player.vimeo.com/video/${m[1]}${hash}`;
      }
    }

    return url;
  } catch {
    return url;
  }
}

// Does this look like pasted embed *markup* (an <iframe>/<blockquote>/<script>
// snippet from a platform's "Embed" dialog) rather than a bare URL?
export function looksLikeEmbedHtml(s: string): boolean {
  return /<\s*(iframe|blockquote|script|object|embed|video|div)\b/i.test(s);
}

// Pull the src out of an <iframe ...> - covers YouTube, Facebook, Vimeo, Google
// Maps and any other iframe-based embed. Protocol-relative srcs are upgraded.
export function extractIframeSrc(html: string): string | null {
  const m = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  const src = m[1].trim();
  return src.startsWith("//") ? `https:${src}` : src;
}

// Instagram's embed code is a <blockquote> + script with the post URL in
// data-instgrm-permalink; reuse that to build their framable /embed form.
export function extractInstagramPermalink(html: string): string | null {
  const m = html.match(/data-instgrm-permalink\s*=\s*["']([^"'?]+)/i);
  return m ? m[1].trim() : null;
}

// Wrap raw embed markup in a minimal, centered HTML document for a sandboxed
// iframe. Scripts inside srcdoc actually execute, so platform widgets
// (X/Twitter, TikTok, Facebook SDK) render correctly.
export function buildEmbedDocument(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" />
<style>
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; overflow: auto; background: #fff; font-family: system-ui, -apple-system, sans-serif; }
  iframe { max-width: 100%; border: 0; }
  blockquote, .instagram-media, .twitter-tweet, .tiktok-embed { margin: 0 auto !important; }
</style>
</head>
<body>${html}</body>
</html>`;
}
