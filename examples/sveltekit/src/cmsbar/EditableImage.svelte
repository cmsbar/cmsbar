<script lang="ts">
  // Editable image primitive, ported from
  // template/components/cmsbar/EditableImage.tsx to Svelte 5.
  //
  //   - View mode (anonymous or no draft): a plain <img>, resolved through the
  //     raw-image proxy when a draft/preview branch is active so freshly-
  //     committed files render straight from GitHub. For an authenticated editor
  //     it is wrapped in a `display:contents` element carrying data-cms-path so
  //     pin/inspect tooling can find it - exactly as the React version does.
  //   - Empty + edit mode: a dashed placeholder with a "Pick image" button.
  //   - Edit mode: the image plus a "Change image" button (opens MediaBrowser),
  //     and - for images that crop to fit (fill / object-cover) - a "Reposition"
  //     toggle that drags the focal point (object-position) via FocalPoint.
  //
  // The host-neutral <img> replaces the React useHost().Image seam: the
  // SvelteKit example ships no framework <Image>, so a plain <img> (which the
  // React DomImage default also reduces to) is the faithful default.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { isSharedPath } from "@/lib/cmsbar/shared-paths";
  import { resolveImageSrc } from "@/cmsbar/mediaSrc";
  import FocalPoint, { parsePos } from "@/cmsbar/FocalPoint.svelte";
  import MediaBrowser from "@/cmsbar/MediaBrowser.svelte";

  type Props = {
    path: string;
    fallback?: string;
    class?: string;
    alt?: string;
    /** Crop-to-fill (object-cover absolutely filling the positioned parent). */
    fill?: boolean;
    width?: number;
    height?: number;
    /** Content path holding an object-position string ("50% 30%"). When set and
     *  the image crops, editors can drag the focal point in edit mode. */
    positionPath?: string;
  };

  let {
    path,
    fallback,
    class: className,
    alt = "",
    fill = false,
    width,
    height,
    positionPath,
  }: Props = $props();

  const store = getCmsContext();

  const rawSrc = $derived((store.get(path) as string | undefined) ?? fallback ?? "");
  const editMode = $derived(store.editMode);
  const authenticated = $derived(store.cms.authenticated);
  const branch = $derived(store.cms.preview?.branch ?? store.cms.draft?.branch);

  // blob:/data: previews resolve as-is; everything else goes through the proxy
  // when a branch is set. Mirrors EditableImage.tsx's src computation.
  const src = $derived(
    rawSrc.startsWith("blob:") || rawSrc.startsWith("data:")
      ? rawSrc
      : resolveImageSrc(rawSrc, branch),
  );

  // Focal-point repositioning only matters for images that crop - those
  // rendered object-cover (via `fill` or an explicit object-cover class). For
  // those, derive a sibling content key ("<path>__pos") when none is passed.
  const cropsToFit = $derived(
    !!fill || /object-(cover|fill)/.test(className ?? ""),
  );
  const effectivePositionPath = $derived(
    cropsToFit ? (positionPath ?? `${path}__pos`) : positionPath,
  );
  const canReposition = $derived(!!effectivePositionPath);
  const shared = $derived(isSharedPath(path));

  const objectPosition = $derived(
    effectivePositionPath
      ? ((store.get(effectivePositionPath) as string | undefined) || undefined)
      : undefined,
  );

  // proxied src failing once falls back to the raw /images/... path - the dev
  // server can serve it from static/ even if it isn't on the cms/* branch yet.
  const proxied = $derived(src !== rawSrc);
  function onImgError(e: Event) {
    if (!proxied) return;
    const el = e.currentTarget as HTMLImageElement;
    if (el.dataset.fallback !== "1") {
      el.dataset.fallback = "1";
      el.src = rawSrc;
    }
  }

  let open = $state(false);
  let repositioning = $state(false);

  function imgStyle(): string | undefined {
    const parts: string[] = [];
    if (!fill) {
      if (width != null) parts.push(`width: ${width}px`);
      if (height != null) parts.push(`height: ${height}px`);
    }
    if (objectPosition) parts.push(`object-position: ${objectPosition}`);
    return parts.length ? parts.join("; ") : undefined;
  }
</script>

{#if !src}
  <!-- Empty: dashed placeholder + Pick button in edit mode; nothing in view. -->
  {#if editMode}
    <div class={["cmsbar-img-wrap", className]}>
      <div class="cmsbar-img-empty">No image - click to add</div>
      <button
        type="button"
        data-cms-ui
        class="cmsbar-img-btn cmsbar-img-btn-pick"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open = true;
        }}
      >
        Pick image
      </button>
      {#if open}
        <MediaBrowser
          contentPath={path}
          currentSrc=""
          onClose={() => (open = false)}
        />
      {/if}
    </div>
  {/if}
{:else if !editMode}
  <!-- View / preview: a plain <img>; authenticated editors get a contents
       wrapper carrying data-cms-path so pin/inspect can find it. -->
  {#if authenticated}
    <div
      data-cms-path={path}
      data-cms-shared={shared ? "true" : undefined}
      style="display: contents;"
    >
      <img
        {src}
        {alt}
        class={[className, fill && "cmsbar-img-fill"]}
        style={imgStyle()}
        onerror={onImgError}
      />
    </div>
  {:else}
    <img
      {src}
      {alt}
      class={[className, fill && "cmsbar-img-fill"]}
      style={imgStyle()}
      onerror={onImgError}
    />
  {/if}
{:else}
  <!-- Edit mode -->
  <div
    data-cms-path={path}
    data-cms-shared={shared ? "true" : undefined}
    class={["cmsbar-img-wrap", shared && "cmsbar-img-shared", className]}
  >
    {#if shared}
      <span data-cms-ui class="cmsbar-img-shared-tag">&#128279; shared</span>
    {/if}

    <img
      {src}
      {alt}
      class={["cmsbar-img", fill && "cmsbar-img-fill"]}
      style={imgStyle()}
      onerror={onImgError}
    />

    {#if repositioning && effectivePositionPath}
      <FocalPoint
        position={parsePos(objectPosition)}
        onSet={(x, y) => store.addEdit(effectivePositionPath, `${x}% ${y}%`)}
      />
    {/if}

    {#if canReposition}
      <button
        type="button"
        data-cms-ui
        class="cmsbar-img-btn cmsbar-img-btn-reposition"
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

    <button
      type="button"
      data-cms-ui
      class="cmsbar-img-btn cmsbar-img-btn-change"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open = true;
      }}
    >
      Change image
    </button>

    {#if open}
      <MediaBrowser
        contentPath={path}
        currentSrc={rawSrc}
        onClose={() => (open = false)}
      />
    {/if}
  </div>
{/if}

<style>
  .cmsbar-img-wrap {
    position: relative;
    display: inline-block;
    width: 100%;
    height: 100%;
  }
  .cmsbar-img-shared {
    border-radius: 0.5rem;
    box-shadow: 0 0 0 2px var(--cmsbar-shared);
  }
  .cmsbar-img-shared-tag {
    pointer-events: none;
    position: absolute;
    left: 0.375rem;
    top: 0.375rem;
    z-index: 97;
    border-radius: 0.25rem;
    background: var(--cmsbar-shared);
    padding: 0.125rem 0.375rem;
    font-size: 10px;
    font-weight: 700;
    color: #451a03;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .cmsbar-img-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f1f5f9;
    color: #94a3b8;
    font-size: 0.75rem;
    border: 2px dashed #cbd5e1;
    border-radius: 0.5rem;
  }
  .cmsbar-img {
    display: block;
  }
  .cmsbar-img-fill {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cmsbar-img-btn {
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
  .cmsbar-img-btn:hover {
    background: var(--cmsbar-accent-strong);
  }
  .cmsbar-img-btn-change,
  .cmsbar-img-btn-pick {
    right: 0.5rem;
  }
  .cmsbar-img-btn-reposition {
    left: 0.5rem;
    z-index: 96;
  }
  .cmsbar-img-btn-reposition.active {
    background: #fff;
    color: var(--cmsbar-accent);
  }
  .cmsbar-img-btn-reposition.active:hover {
    background: #f1f5f9;
  }
</style>
