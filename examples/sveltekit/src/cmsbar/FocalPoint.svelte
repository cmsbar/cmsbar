<script lang="ts" module>
  // Focal-point helpers + overlay, ported from
  // template/components/cmsbar/FocalPoint.tsx to Svelte 5. The overlay is a
  // click-to-set crosshair with a live-coords pill and per-axis locks; it is
  // shared by EditableImage and EditableMedia (image kind). Renders absolutely
  // inside a relatively-positioned wrapper, exactly like the React original.

  /** Parse an object-position string ("50% 30%") into percentages; center default. */
  export function parsePos(s: string | undefined): { x: number; y: number } {
    const m = (s ?? "").match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
  }

  export const clampPct = (n: number) =>
    Math.max(0, Math.min(100, Math.round(n)));
</script>

<script lang="ts">
  type Props = {
    position: { x: number; y: number };
    /** Called with the new x/y percentages when the editor clicks the image. */
    onSet: (x: number, y: number) => void;
  };

  let { position, onSet }: Props = $props();

  // Locked axes keep their current value so the editor can slide along one
  // direction only (e.g. lock Y to pan strictly left<->right). Local UI state.
  let lockX = $state(false);
  let lockY = $state(false);

  function onOverlayClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = lockX
      ? position.x
      : clampPct(((e.clientX - r.left) / r.width) * 100);
    const y = lockY
      ? position.y
      : clampPct(((e.clientY - r.top) / r.height) * 100);
    onSet(x, y);
  }
</script>

<!-- The overlay captures the click that sets the focal point. The control strip
     stops propagation so toggling a lock never also moves the point. -->
<div
  data-cms-ui
  class="cmsbar-focal"
  role="presentation"
  onclick={onOverlayClick}
>
  <div class="cmsbar-focal-scrim"></div>
  <div
    class="cmsbar-focal-marker"
    style="left: {position.x}%; top: {position.y}%;"
  ></div>

  <div
    data-cms-ui
    class="cmsbar-focal-strip"
    role="presentation"
    onclick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
  >
    <span class="cmsbar-focal-coords">{position.x}% {position.y}%</span>
    <span class="cmsbar-focal-sep"></span>
    <button
      type="button"
      class="cmsbar-focal-lock"
      class:active={lockX}
      title="Lock the horizontal (X) position"
      onclick={(e) => {
        e.stopPropagation();
        lockX = !lockX;
      }}
    >
      &#8596; X
    </button>
    <button
      type="button"
      class="cmsbar-focal-lock"
      class:active={lockY}
      title="Lock the vertical (Y) position"
      onclick={(e) => {
        e.stopPropagation();
        lockY = !lockY;
      }}
    >
      &#8597; Y
    </button>
  </div>
</div>

<style>
  .cmsbar-focal {
    position: absolute;
    inset: 0;
    z-index: 95;
    cursor: crosshair;
    pointer-events: auto;
  }
  .cmsbar-focal-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.2);
  }
  .cmsbar-focal-marker {
    position: absolute;
    height: 1.5rem;
    width: 1.5rem;
    transform: translate(-50%, -50%);
    border-radius: 9999px;
    border: 2px solid #fff;
    background: color-mix(in srgb, var(--cmsbar-accent) 70%, transparent);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
  }
  .cmsbar-focal-strip {
    position: absolute;
    left: 50%;
    top: 0.5rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.375rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.75);
    padding: 0.25rem 0.5rem;
    font-size: 11px;
    font-weight: 500;
    color: #fff;
  }
  .cmsbar-focal-coords {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .cmsbar-focal-sep {
    height: 0.75rem;
    width: 1px;
    background: rgba(255, 255, 255, 0.25);
  }
  .cmsbar-focal-lock {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.125rem 0.375rem;
    color: inherit;
    background: transparent;
    font: inherit;
  }
  .cmsbar-focal-lock:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  .cmsbar-focal-lock.active {
    background: var(--cmsbar-accent);
  }
</style>
