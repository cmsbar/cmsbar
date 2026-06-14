<script lang="ts" module>
  // Guided onboarding tour, ported from template/components/cmsbar/CmsTour.tsx
  // to Svelte 5. Renders nothing unless the project configures cmsConfig.tour.
  // Opens automatically once per browser when tour.autoStart is set, and
  // imperatively whenever anyone dispatches TOUR_OPEN_EVENT - the bar's
  // "✦ Guide" pill does exactly that. A window event (not lifted state) keeps
  // the bar's render branches untouched.
  export const TOUR_OPEN_EVENT = "cmsbar:tour:open";
</script>

<script lang="ts">
  import { cmsConfig } from "@/cms.config";
  import type { CmsTourStep } from "@/lib/cmsbar/config";

  const steps: CmsTourStep[] = cmsConfig.tour?.steps ?? [];

  // Per-namespace storage keys (match CmsTour.tsx).
  const DONE_LS_KEY = `cmsbar:tour-done:${cmsConfig.namespace}`;
  const STEP_SS_KEY = `cmsbar:tour-step:${cmsConfig.namespace}`;
  const MARGIN = 12;

  let open = $state(false);
  let index = $state(0);
  // Viewport rect of the current step's target; null = centered card, no spotlight.
  let rect = $state<DOMRect | null>(null);
  let cardPos = $state<{ top: number; left: number } | null>(null);
  let cardEl = $state<HTMLDivElement | null>(null);

  const step = $derived(open ? steps[index] : undefined);
  const last = $derived(index === steps.length - 1);

  function close(markDone: boolean) {
    open = false;
    index = 0;
    try {
      sessionStorage.removeItem(STEP_SS_KEY);
      if (markDone) localStorage.setItem(DONE_LS_KEY, "1");
    } catch {
      /* storage unavailable */
    }
  }

  // Imperative open (bar button). Always restarts from the first step.
  // Plus: auto-open on first visit and resume any in-flight tour across the
  // reloads its own steps cause (New draft / Save→preview remount us). Resume
  // must NOT be gated on autoStart/done.
  $effect(() => {
    const onOpen = () => {
      index = 0;
      open = true;
    };
    window.addEventListener(TOUR_OPEN_EVENT, onOpen);

    if (steps.length > 0) {
      try {
        const saved = sessionStorage.getItem(STEP_SS_KEY);
        if (saved !== null) {
          const n = Number(saved);
          index = Number.isInteger(n)
            ? Math.min(Math.max(n, 0), steps.length - 1)
            : 0;
          open = true;
        } else if (cmsConfig.tour?.autoStart && !localStorage.getItem(DONE_LS_KEY)) {
          open = true;
        }
      } catch {
        if (cmsConfig.tour?.autoStart) open = true;
      }
    }

    return () => window.removeEventListener(TOUR_OPEN_EVENT, onOpen);
  });

  // Track the target's rect; recompute on scroll/resize. Capture-phase scroll
  // listener so nested scroll containers are covered too.
  $effect(() => {
    const s = step;
    if (!s) return;
    // Read index so a step change re-arms this effect (matches React's deps).
    void index;
    try {
      sessionStorage.setItem(STEP_SS_KEY, String(index));
    } catch {
      /* storage unavailable */
    }
    let el: Element | null = null;
    if (s.target) {
      try {
        el = document.querySelector(s.target);
      } catch {
        // Invalid selector in the site's tour config must not crash the page.
        el = null;
      }
    }
    if (!el) {
      rect = null;
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const update = () => {
      const r = (el as Element).getBoundingClientRect();
      // Hidden targets (display:none) report a zero rect - treat as missing.
      rect = r.width || r.height ? r : null;
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  });

  // Place the card next to the target (clamped to the viewport) once it can be
  // measured. Reads cardEl so it re-runs after the card mounts.
  $effect(() => {
    const s = step;
    if (!s) return;
    if (!rect) {
      cardPos = null;
      return;
    }
    const card = cardEl;
    if (!card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let top: number;
    let left: number;
    switch (s.placement ?? "bottom") {
      case "top":
        top = rect.top - ch - MARGIN;
        left = rect.left + rect.width / 2 - cw / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.left - cw - MARGIN;
        break;
      case "right":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.right + MARGIN;
        break;
      default:
        top = rect.bottom + MARGIN;
        left = rect.left + rect.width / 2 - cw / 2;
    }
    cardPos = {
      top: Math.min(Math.max(top, MARGIN), window.innerHeight - ch - MARGIN),
      left: Math.min(Math.max(left, MARGIN), window.innerWidth - cw - MARGIN),
    };
  });

  // Escape closes the tour, unless it's aimed at another surface.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest?.("input, textarea, [contenteditable], [data-cms-toolbar]")
      ) {
        return;
      }
      close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Svelte portal: relocate to <body> (no scroll lock - the tour wants the page
  // scrollable so spotlit targets can be reached).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#if step}
  <!-- pointer-events:none lets the user click the spotlit element (the tour
       asks them to); only the card captures clicks. data-cms-ui so the CMS
       click-capture logic ignores the layer. -->
  <div use:portal class="cmsbar-tour-layer" data-cms-ui>
    {#if rect}
      <div
        class="cmsbar-tour-spot"
        style:top="{rect.top - 4}px"
        style:left="{rect.left - 4}px"
        style:width="{rect.width + 8}px"
        style:height="{rect.height + 8}px"
      ></div>
    {:else}
      <div class="cmsbar-tour-scrim"></div>
    {/if}
    <div
      bind:this={cardEl}
      class="cmsbar-tour-card"
      class:centered={!cardPos}
      style:top={cardPos ? `${cardPos.top}px` : undefined}
      style:left={cardPos ? `${cardPos.left}px` : undefined}
    >
      <div class="cmsbar-tour-cardhead">
        <h3>{step.title}</h3>
        <span class="cmsbar-tour-count">{index + 1} / {steps.length}</span>
      </div>
      <p class="cmsbar-tour-body">{step.body}</p>
      <div class="cmsbar-tour-actions">
        <button type="button" class="cmsbar-tour-skip" onclick={() => close(true)}
          >Skip tour</button
        >
        {#if index > 0}
          <button
            type="button"
            class="cmsbar-tour-back"
            onclick={() => (index -= 1)}>Back</button
          >
        {/if}
        <button
          type="button"
          class="cmsbar-tour-next"
          onclick={() => (last ? close(true) : (index += 1))}
        >
          {last ? "Done" : "Next"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cmsbar-tour-layer {
    position: fixed;
    inset: 0;
    z-index: 210;
    pointer-events: none;
    font-family:
      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .cmsbar-tour-spot {
    position: absolute;
    border-radius: 0.5rem;
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.6),
      0 0 0 9999px rgba(2, 6, 23, 0.6);
    transition:
      top 0.2s ease,
      left 0.2s ease,
      width 0.2s ease,
      height 0.2s ease;
  }
  .cmsbar-tour-scrim {
    position: absolute;
    inset: 0;
    background: rgba(2, 6, 23, 0.6);
  }
  .cmsbar-tour-card {
    position: absolute;
    width: 20rem;
    max-width: calc(100vw - 1.5rem);
    pointer-events: auto;
    border-radius: 0.75rem;
    background: rgba(15, 23, 42, 0.95);
    color: #fff;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    padding: 1rem;
  }
  .cmsbar-tour-card.centered {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .cmsbar-tour-cardhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
  }
  .cmsbar-tour-cardhead h3 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .cmsbar-tour-count {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
  }
  .cmsbar-tour-body {
    margin: 0;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.8);
  }
  .cmsbar-tour-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.875rem;
  }
  .cmsbar-tour-skip {
    margin-right: auto;
    border: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .cmsbar-tour-skip:hover {
    color: #fff;
  }
  .cmsbar-tour-back {
    border: 0;
    cursor: pointer;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.25rem 0.75rem;
  }
  .cmsbar-tour-back:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .cmsbar-tour-next {
    border: 0;
    cursor: pointer;
    border-radius: 9999px;
    background: var(--cmsbar-accent);
    color: #fff;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
  }
  .cmsbar-tour-next:hover {
    background: var(--cmsbar-accent-strong);
  }
</style>
