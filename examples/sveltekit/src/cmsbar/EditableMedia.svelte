<script lang="ts">
  // Editable media slot, ported from
  // template/components/cmsbar/EditableMedia.tsx to Svelte 5. One slot renders
  // an image, a self-hosted video, an iframe embed (YouTube/Instagram/Vimeo/
  // Maps), or pasted embed markup in a sandboxed iframe - the kind is detected
  // from the stored value. Editors get:
  //   - a "Change media" button -> the MediaPicker modal (Library / Upload /
  //     Embed code-or-URL / Clear tabs), and
  //   - for image media, a "Reposition" focal-point toggle.
  //
  // The MediaPicker is defined in this file (as in the React original) and
  // rendered through the same Svelte portal as MediaBrowser. Branch-aware src
  // resolution, embed normalization and kind detection come from the shared
  // mediaSrc helpers.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { isSharedPath } from "@/lib/cmsbar/shared-paths";
  import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
  import {
    detectKind,
    resolveMediaSrc,
    buildEmbedDocument,
    type MediaKind,
  } from "@/cmsbar/mediaSrc";
  import FocalPoint, { parsePos } from "@/cmsbar/FocalPoint.svelte";
  import MediaPicker from "@/cmsbar/MediaPicker.svelte";

  type Props = {
    path: string;
    class?: string;
    fallbackPlaceholder?: string;
    /** How a video fills its box. "cover" (default) crops; "contain" shows all. */
    videoMode?: "cover" | "contain";
    /** Autoplay a video muted+looping for background/hero use. */
    videoAutoplay?: boolean;
  };

  let {
    path,
    class: className,
    fallbackPlaceholder = "No media set",
    videoMode = "cover",
    videoAutoplay = false,
  }: Props = $props();

  const store = getCmsContext();

  const raw = $derived((store.get(path) as string | undefined) ?? "");
  const editMode = $derived(store.editMode);
  const branch = $derived(store.cms.preview?.branch ?? store.cms.draft?.branch);
  const authenticated = $derived(store.cms.authenticated);

  const src = $derived(
    raw.startsWith("blob:") || raw.startsWith("data:")
      ? raw
      : resolveMediaSrc(raw, branch),
  );

  // blob: preview URLs carry no extension, so a fresh upload would detect as
  // "empty" and vanish until saved. Classify via the staged public path (the
  // pending edit for this slot) instead; the blob stays the <img>/<video> src.
  const stagedValue = $derived(
    raw.startsWith("blob:")
      ? (store.pendingEdits.find((e) => e.path === path)?.value as
          | string
          | undefined)
      : undefined,
  );
  const kind = $derived<MediaKind>(detectKind(stagedValue ?? raw));

  // Focal point for image media, stored at a sibling key ("<path>__pos").
  const positionPath = $derived(`${path}__pos`);
  const objectPosition = $derived(
    (store.get(positionPath) as string | undefined) || undefined,
  );

  const shared = $derived(isSharedPath(path));
  const embedDoc = $derived(kind === "html" ? buildEmbedDocument(raw) : "");

  let pickerOpen = $state(false);
  let repositioning = $state(false);

  // ── Autoplay-video mute toggle (browser autoplay requires muted) ───────────
  let videoEl = $state<HTMLVideoElement | null>(null);
  let muted = $state(true);
  function onVideoMount(node: HTMLVideoElement) {
    node.muted = true;
    const onVolumeChange = () => (muted = node.muted);
    node.addEventListener("volumechange", onVolumeChange);
    return {
      destroy() {
        node.removeEventListener("volumechange", onVolumeChange);
      },
    };
  }
  function toggleMute() {
    const v = videoEl;
    if (!v) return;
    v.muted = !v.muted; // volumechange listener syncs `muted`
    if (v.paused) void v.play().catch(() => {});
  }
</script>

<div
  class={["cmsbar-media", className]}
  data-cms-path={authenticated ? path : undefined}
  data-cms-shared={authenticated && shared ? "true" : undefined}
>
  {#if kind === "image"}
    <img
      {src}
      alt=""
      class="cmsbar-media-fill cmsbar-media-cover"
      style={objectPosition ? `object-position: ${objectPosition}` : undefined}
    />
  {:else if kind === "video"}
    {#if videoAutoplay}
      <video
        bind:this={videoEl}
        use:onVideoMount
        {src}
        autoplay
        muted
        loop
        playsinline
        controls
        class="cmsbar-media-fill cmsbar-media-video {videoMode === 'contain'
          ? 'cmsbar-media-contain'
          : 'cmsbar-media-cover'}"
      >
        <track kind="captions" />
      </video>
      <button
        type="button"
        class="cmsbar-media-mute"
        aria-label={muted ? "Unmute" : "Mute"}
        onclick={toggleMute}
      >
        {muted ? "🔇" : "🔊"}
      </button>
    {:else}
      <video
        {src}
        controls
        playsinline
        class="cmsbar-media-fill cmsbar-media-video {videoMode === 'contain'
          ? 'cmsbar-media-contain'
          : 'cmsbar-media-cover'}"
      >
        <track kind="captions" />
      </video>
    {/if}
  {:else if kind === "embed"}
    <iframe
      {src}
      class="cmsbar-media-fill"
      allowfullscreen
      title="Embedded media"
    ></iframe>
  {:else if kind === "html"}
    <iframe
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      srcdoc={embedDoc}
      class="cmsbar-media-fill cmsbar-media-htmlframe"
      allowfullscreen
      title="Embedded media"
    ></iframe>
  {:else}
    <div class="cmsbar-media-empty">{fallbackPlaceholder}</div>
  {/if}

  {#if editMode && kind === "image" && repositioning}
    <FocalPoint
      position={parsePos(objectPosition)}
      onSet={(x, y) => store.addEdit(positionPath, `${x}% ${y}%`)}
    />
  {/if}

  {#if editMode && kind === "image"}
    <button
      type="button"
      data-cms-ui
      class="cmsbar-media-btn cmsbar-media-btn-reposition"
      class:active={repositioning}
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        repositioning = !repositioning;
      }}
    >
      {repositioning ? "Done" : "‹ Reposition"}
    </button>
  {/if}

  {#if editMode}
    <button
      type="button"
      data-cms-ui
      class="cmsbar-media-btn cmsbar-media-btn-change"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pickerOpen = true;
      }}
    >
      Change media
    </button>
  {/if}

  {#if pickerOpen}
    <MediaPicker
      {path}
      currentValue={raw}
      currentKind={kind}
      onClose={() => (pickerOpen = false)}
      onCommit={(value) => {
        store.addEdit(path, value);
        pickerOpen = false;
      }}
    />
  {/if}
</div>

<!-- The MediaPicker (Library / Upload / Embed code-or-URL / Clear) is the
     sibling MediaPicker.svelte component, rendered above when pickerOpen. The
     React original nests it in the same file; Svelte's one-component-per-file
     rule splits it out, but the behaviour is identical. -->

<style>
  .cmsbar-media {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .cmsbar-media-fill {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .cmsbar-media-cover {
    object-fit: cover;
  }
  .cmsbar-media-contain {
    object-fit: contain;
  }
  .cmsbar-media-video {
    background: #000;
  }
  .cmsbar-media-htmlframe {
    background: #fff;
  }
  .cmsbar-media-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f1f5f9;
    color: #94a3b8;
    font-weight: 500;
  }
  .cmsbar-media-mute {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 20;
    display: flex;
    height: 2.5rem;
    width: 2.5rem;
    align-items: center;
    justify-content: center;
    border: 0;
    cursor: pointer;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .cmsbar-media-mute:hover {
    background: rgba(0, 0, 0, 0.8);
  }
  .cmsbar-media-btn {
    position: absolute;
    bottom: 0.5rem;
    z-index: 90;
    pointer-events: auto;
    border: 0;
    cursor: pointer;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.375rem 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    color: #fff;
    background: var(--cmsbar-accent);
  }
  .cmsbar-media-btn:hover {
    background: var(--cmsbar-accent-strong);
  }
  .cmsbar-media-btn-change {
    right: 0.5rem;
  }
  .cmsbar-media-btn-reposition {
    left: 0.5rem;
    z-index: 96;
  }
  .cmsbar-media-btn-reposition.active {
    background: #fff;
    color: var(--cmsbar-accent);
  }
</style>
