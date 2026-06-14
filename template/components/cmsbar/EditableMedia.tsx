"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useCms } from "./ContentProvider";
import { FocalPointOverlay, parsePos } from "./FocalPoint";
import { Portal } from "./Portal";
import { isSharedPath } from "@/lib/cmsbar/shared-paths";
import { cn } from "@/lib/cmsbar/utils";
import { cmsFetch, cmsApiBase } from "@/lib/cmsbar/cmsFetch";

type Props = {
  path: string;
  fallbackPlaceholder?: React.ReactNode;
  className?: string;
  /** How a video fills its box. "cover" (default) crops to fill; "contain" shows the whole frame. */
  videoMode?: "cover" | "contain";
  /** Autoplay a video muted+looping with no controls - for background/hero use. */
  videoAutoplay?: boolean;
};

type Kind = "empty" | "image" | "video" | "embed" | "html";

const GOOGLE_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "google.com",
  "www.google.com",
]);

function isGoogleMapsUrl(url: string): boolean {
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
function normalizeEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // Instagram: /p/<id>/, /reel/<id>/, /tv/<id>/ → append /embed
    if (host === "instagram.com") {
      const m = u.pathname.match(/^\/(p|reel|tv)\/([^/]+)\/?$/);
      if (m) return `https://www.instagram.com/${m[1]}/${m[2]}/embed`;
      // already has /embed at the end → leave alone
      if (/\/embed\/?$/.test(u.pathname)) return url;
    }

    // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID → /embed/ID
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

    // Vimeo: vimeo.com/<id> (or /channels/.../<id>, optional unlisted hash) →
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
function looksLikeEmbedHtml(s: string): boolean {
  return /<\s*(iframe|blockquote|script|object|embed|video|div)\b/i.test(s);
}

// Pull the src out of an <iframe …> - covers YouTube, Facebook, Vimeo, Google
// Maps and any other iframe-based embed. Protocol-relative srcs are upgraded.
function extractIframeSrc(html: string): string | null {
  const m = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  const src = m[1].trim();
  return src.startsWith("//") ? `https:${src}` : src;
}

// Instagram's embed code is a <blockquote> + script with the post URL in
// data-instgrm-permalink; we reuse that to build their framable /embed form.
function extractInstagramPermalink(html: string): string | null {
  const m = html.match(/data-instgrm-permalink\s*=\s*["']([^"'?]+)/i);
  return m ? m[1].trim() : null;
}

// Wrap raw embed markup in a minimal, centered HTML document for a sandboxed
// iframe. Scripts inside srcdoc actually execute (unlike dangerouslySetInnerHTML),
// so platform widgets (X/Twitter, TikTok, Facebook SDK) render correctly.
function buildEmbedDocument(html: string): string {
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

function detectKind(value: string): Kind {
  const v = value.trim();
  if (!v) return "empty";
  if (v.startsWith("<")) return "html";
  if (/^data:image\//i.test(v)) return "image";
  if (/^data:video\//i.test(v)) return "video";
  if (/^https?:\/\//i.test(v)) return "embed";
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(v)) return "video";
  if (/\.(jpe?g|png|webp|gif|svg)$/i.test(v)) return "image";
  return "empty";
}

export function resolveForBranch(
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
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(src)) return src;
  const repoPath = `public${src}`;
  return `${cmsApiBase()}/images/raw?branch=${encodeURIComponent(
    branch,
  )}&path=${encodeURIComponent(repoPath)}`;
}

export function EditableMedia({
  path,
  fallbackPlaceholder,
  className,
  videoMode = "cover",
  videoAutoplay = false,
}: Props) {
  const { get, editMode, cms, addEdit, pendingEdits } = useCms();
  const raw = (get(path) as string | undefined) ?? "";
  const branch = cms.preview?.branch ?? cms.draft?.branch;
  const src =
    raw.startsWith("blob:") || raw.startsWith("data:")
      ? raw
      : resolveForBranch(raw, branch);
  // blob: preview URLs carry no extension, so a fresh upload would detect as
  // "empty" and vanish until saved. Classify it via the staged public path
  // (the pending edit for this slot) instead; the blob stays the <img>/<video> src.
  const stagedValue = raw.startsWith("blob:")
    ? (pendingEdits.find((e) => e.path === path)?.value as string | undefined)
    : undefined;
  const kind = detectKind(stagedValue ?? raw);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repositioning, setRepositioning] = useState(false);

  // Focal point for image media - stored at a sibling content key ("<path>__pos")
  // and applied as CSS object-position. Stale values left behind when the slot
  // switches to video/embed are harmless and revive if an image returns.
  const positionPath = `${path}__pos`;
  const objectPosition = (get(positionPath) as string | undefined) || undefined;

  const shared = isSharedPath(path);

  return (
    <div
      className={cn("relative w-full h-full", className)}
      {...(cms.authenticated
        ? {
            "data-cms-path": path,
            "data-cms-shared": shared ? "true" : undefined,
          }
        : {})}
    >
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={objectPosition ? { objectPosition } : undefined}
        />
      )}
      {kind === "video" &&
        (videoAutoplay ? (
          <AutoplayVideo src={src} mode={videoMode} />
        ) : (
          <video
            src={src}
            controls
            playsInline
            className={cn(
              "absolute inset-0 w-full h-full bg-black",
              videoMode === "contain" ? "object-contain" : "object-cover",
            )}
          />
        ))}
      {kind === "embed" && (
        <iframe
          src={src}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          title="Embedded media"
        />
      )}
      {kind === "html" && (
        <HtmlEmbed html={raw} className="absolute inset-0 w-full h-full" />
      )}
      {kind === "empty" && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400 font-medium">
          {fallbackPlaceholder ?? "No media set"}
        </div>
      )}

      {/* Click overlay to set the focal point (object-position) - images only;
          other media kinds simply don't render it. */}
      {editMode && kind === "image" && repositioning && (
        <FocalPointOverlay
          position={parsePos(objectPosition)}
          onSet={(x, y) => addEdit(positionPath, `${x}% ${y}%`)}
        />
      )}
      {editMode && kind === "image" && (
        <button
          type="button"
          data-cms-ui
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRepositioning((v) => !v);
          }}
          className={cn(
            "absolute bottom-2 left-2 z-[96] pointer-events-auto rounded-full text-xs font-medium px-3 py-1.5 shadow-md",
            repositioning
              ? "bg-white text-[var(--cmsbar-accent)] hover:bg-slate-100"
              : "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent-strong)]",
          )}
        >
          {repositioning ? "Done" : "⊹ Reposition"}
        </button>
      )}
      {editMode && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPickerOpen(true);
          }}
          className="absolute bottom-2 right-2 z-[90] pointer-events-auto rounded-full bg-[var(--cmsbar-accent)] text-white text-xs font-medium px-3 py-1.5 shadow-md hover:bg-[var(--cmsbar-accent-strong)]"
        >
          Change media
        </button>
      )}
      {pickerOpen && (
        <MediaPicker
          path={path}
          currentValue={raw}
          currentKind={kind}
          onClose={() => setPickerOpen(false)}
          onCommit={(value) => {
            addEdit(path, value);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Muted-autoplay looping video (browser policy requires muted to autoplay)
// with an unmute toggle so viewers can opt into sound.
function AutoplayVideo({
  src,
  mode,
}: {
  src: string;
  mode: "cover" | "contain";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // React's `muted` attribute is unreliable; set it imperatively on mount so
  // autoplay is allowed. Mirror the element's real mute state into React so the
  // overlay icon stays in sync whether the custom button or native controls
  // change it.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    const onVolumeChange = () => setMuted(v.muted);
    v.addEventListener("volumechange", onVolumeChange);
    return () => v.removeEventListener("volumechange", onVolumeChange);
  }, []);

  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted; // volumechange listener syncs `muted` state
    if (v.paused) void v.play().catch(() => {});
  };

  return (
    <>
      <video
        ref={ref}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        controls
        className={cn(
          "absolute inset-0 w-full h-full bg-black",
          mode === "contain" ? "object-contain" : "object-cover",
        )}
      />
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute top-3 left-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        {muted ? (
          <VolumeX className="h-5 w-5" />
        ) : (
          <Volume2 className="h-5 w-5" />
        )}
      </button>
    </>
  );
}

// Renders author-pasted embed markup inside a sandboxed iframe. allow-scripts
// lets platform widgets run; the markup is authored by trusted, authenticated
// CMS editors and ships via reviewed PRs, so residual risk stays in this frame.
function HtmlEmbed({ html, className }: { html: string; className?: string }) {
  const doc = useMemo(() => buildEmbedDocument(html), [html]);
  return (
    <iframe
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      srcDoc={doc}
      className={cn("bg-white", className)}
      allowFullScreen
      title="Embedded media"
    />
  );
}

function MediaPicker({
  path,
  currentValue,
  currentKind,
  onClose,
  onCommit,
}: {
  path: string;
  currentValue: string;
  currentKind: Kind;
  onClose: () => void;
  onCommit: (value: string) => void;
}) {
  const { addUpload } = useCms();
  const isEmbed = currentKind === "embed" || currentKind === "html";
  const [tab, setTab] = useState<"library" | "upload" | "embed" | "clear">(
    isEmbed ? "embed" : "library",
  );
  const [embedInput, setEmbedInput] = useState(isEmbed ? currentValue : "");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [libItems, setLibItems] = useState<{ path: string }[] | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const libVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Only one library preview plays at a time.
  const pauseOtherLibVideos = (keep: string) => {
    Object.entries(libVideoRefs.current).forEach(([p, el]) => {
      if (el && p !== keep) el.pause();
    });
  };

  // Load the video library when its tab is first opened.
  useEffect(() => {
    if (tab !== "library" || libItems !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await cmsFetch("/media/list", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          files?: { path: string }[];
          error?: string;
        };
        if (!res.ok)
          throw new Error(data.error || `List failed (HTTP ${res.status})`);
        if (!cancelled) setLibItems(data.files ?? []);
      } catch (e) {
        if (!cancelled)
          setLibError(
            e instanceof Error ? e.message : "Could not load library",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, libItems]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onFile = (file: File) => {
    setError(null);
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      setError(`Unsupported file type: ${file.type}`);
      return;
    }
    // Stage the upload in a sensible folder for the type. The path computed by
    // addUpload becomes the eventual /images/... or /media/... URL.
    const folder = isVideo ? "media/videos" : "images/uploads";
    addUpload(path, file, folder);
    onClose();
  };

  const onEmbedSubmit = async () => {
    setError(null);
    const input = embedInput.trim();
    if (!input) return;

    // 1) Full embed code pasted from a platform's "Embed" share dialog.
    if (looksLikeEmbedHtml(input)) {
      // Prefer pulling a clean iframe src out - covers YouTube, Facebook,
      // Vimeo, Google Maps and anything else that embeds via <iframe>.
      const iframeSrc = extractIframeSrc(input);
      if (iframeSrc) {
        onCommit(normalizeEmbedUrl(iframeSrc));
        return;
      }
      // Instagram hands out a <blockquote> + script; reuse the permalink to
      // build their framable /embed form instead of running their script.
      const igPermalink = extractInstagramPermalink(input);
      if (igPermalink) {
        onCommit(normalizeEmbedUrl(igPermalink));
        return;
      }
      // Script-based embeds with no extractable URL (X/Twitter, TikTok, the
      // Facebook SDK widget, …) - keep the markup; it renders sandboxed.
      onCommit(input);
      return;
    }

    // 2) Bare URL.
    if (!/^https?:\/\//i.test(input)) {
      setError(
        "Paste a URL (https://…) or the full embed code from the platform.",
      );
      return;
    }
    if (isGoogleMapsUrl(input)) {
      try {
        setResolving(true);
        const r = await cmsFetch("/resolve-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: input }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(
            data.error ??
              `Could not resolve Google Maps URL (HTTP ${r.status})`,
          );
          return;
        }
        onCommit(String(data.embed));
        return;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not resolve Google Maps URL",
        );
        return;
      } finally {
        setResolving(false);
      }
    }
    onCommit(normalizeEmbedUrl(input));
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b px-5 py-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Change media
            </h2>
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="border-b flex">
            {(["library", "upload", "embed", "clear"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-2 text-sm font-medium",
                  tab === t
                    ? "text-[var(--cmsbar-accent)] border-b-2 border-[var(--cmsbar-accent)]"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {t === "library"
                  ? "Library"
                  : t === "upload"
                    ? "Upload"
                    : t === "embed"
                      ? "Embed code / URL"
                      : "Clear"}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {tab === "library" && (
            <div className="p-5">
              {libError && <p className="text-sm text-red-600">{libError}</p>}
              {!libError && libItems === null && (
                <p className="text-sm text-slate-500">Loading videos…</p>
              )}
              {!libError && libItems !== null && libItems.length === 0 && (
                <p className="text-sm text-slate-500">
                  No videos in <code>public/media</code> yet - add one in the
                  Upload tab.
                </p>
              )}
              {libItems && libItems.length > 0 && (
                <div className="grid max-h-[60vh] grid-cols-2 gap-4 overflow-y-auto sm:grid-cols-3">
                  {libItems.map((it) => {
                    const isCurrent = it.path === currentValue;
                    return (
                      <div
                        key={it.path}
                        className={cn(
                          "rounded-lg border p-1.5",
                          isCurrent
                            ? "border-[var(--cmsbar-accent)] bg-[var(--cmsbar-accent-soft)]"
                            : "border-slate-200",
                        )}
                      >
                        <video
                          ref={(el) => {
                            libVideoRefs.current[it.path] = el;
                          }}
                          src={`${it.path}#t=0.1`}
                          controls
                          playsInline
                          preload="metadata"
                          onPlay={() => pauseOtherLibVideos(it.path)}
                          className="aspect-[9/16] w-full rounded bg-black object-contain"
                        />
                        <p
                          className="mt-1 truncate text-[11px] text-slate-500"
                          title={it.path}
                        >
                          {it.path.split("/").pop()}
                        </p>
                        <button
                          type="button"
                          onClick={() => onCommit(it.path)}
                          className={cn(
                            "mt-1 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                            isCurrent
                              ? "bg-[var(--cmsbar-accent-soft)] text-[var(--cmsbar-accent)]"
                              : "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent-strong)]",
                          )}
                        >
                          {isCurrent ? "✓ In use" : "Use this video"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "upload" && (
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-600">
                Pick a JPG/PNG/WebP/GIF/SVG image or an MP4/WebM video (≤ 50
                MB).
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-md bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-sm font-medium px-3 py-2"
              >
                Choose file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-slate-500">
                Image uploads land under <code>public/images/uploads/</code>;
                videos under <code>public/media/videos/</code>. The file is
                staged locally - click <strong>Save</strong> in the CMS bar to
                commit it to your draft.
              </p>
            </div>
          )}

          {tab === "embed" && (
            <div className="p-5 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Embed code or URL - YouTube, Instagram, Facebook, Google Maps, …
              </label>
              <textarea
                rows={4}
                placeholder={
                  'Paste the platform "Embed" code (e.g. <iframe …>) - or just a URL like https://www.youtube.com/watch?v=…'
                }
                value={embedInput}
                onChange={(e) => setEmbedInput(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-[var(--cmsbar-accent)]"
              />
              <p className="text-xs text-slate-500">
                Paste the full <strong>embed code</strong> from the
                platform&rsquo;s share dialog, or just the page URL. We pull the
                iframe out of YouTube / Facebook / Vimeo / Maps embeds, convert
                Instagram posts to their framable form, and render script-based
                embeds (X, TikTok) in a sandboxed frame. Google Maps short links
                (<code>maps.app.goo.gl/…</code>) are resolved server-side.
              </p>
              <button
                type="button"
                onClick={onEmbedSubmit}
                disabled={!embedInput.trim() || resolving}
                className="w-full rounded-md bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-sm font-medium px-3 py-2 disabled:opacity-60"
              >
                {resolving ? "Resolving…" : "Use this embed"}
              </button>
            </div>
          )}

          {tab === "clear" && (
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-600">
                Remove the current media - the placeholder will show on the live
                site until you set something new.
              </p>
              <button
                type="button"
                onClick={() => onCommit("")}
                className="w-full rounded-md bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium px-3 py-2"
              >
                Clear media
              </button>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
