<script lang="ts">
  // Site-wide CMS settings drawer, ported from
  // template/components/cmsbar/SettingsDrawer.tsx to Svelte 5. The React
  // original is the most site-specific of the batch; this port keeps the
  // framework-neutral core: the publishing-mode display, the launch-gate
  // section (read via the neutral siteLaunchLabel/SiteLaunch helpers), and the
  // shared-highlight toggle the bar owns. Edits stage into the active draft via
  // store.addEdit, exactly like any other content edit.
  //
  // Reuses the same scoped-CSS + `portal` action conventions as MediaPicker /
  // MediaBrowser; no Tailwind, no React Portal.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { cmsConfig } from "@/cms.config";
  import { publishingMode } from "@/lib/cmsbar/config";
  import { siteLaunchLabel, type SiteLaunch } from "@/lib/cmsbar/launch";

  type Props = {
    onClose: () => void;
    canEdit: boolean;
    /** When true, also show the "Highlight shared elements" toggle (draft mode
     *  only - the bar owns the body class). */
    highlightShared?: boolean;
    onToggleHighlight?: () => void;
  };

  let {
    onClose,
    canEdit,
    highlightShared = false,
    onToggleHighlight,
  }: Props = $props();

  const store = getCmsContext();

  const DIRECT = publishingMode(cmsConfig) === "direct";

  const LAUNCH_MODES: { value: SiteLaunch["mode"]; title: string; sub: string }[] =
    [
      {
        value: "teaser",
        title: "Teaser",
        sub: "The public sees the teaser page; only logged-in editors see the site.",
      },
      {
        value: "live",
        title: "Live",
        sub: "The whole site is visible to everyone.",
      },
    ];

  const DEFAULT_LAUNCH: SiteLaunch = { mode: "live" };

  const launch = $derived(
    (store.get("launch") as SiteLaunch | undefined) ?? DEFAULT_LAUNCH,
  );
  const status = $derived(siteLaunchLabel(launch));

  function update(patch: Partial<SiteLaunch>) {
    store.addEdit("launch", { ...launch, ...patch });
  }

  // Svelte portal: relocate to <body> + lock body scroll (matches React Portal).
  function portal(node: HTMLElement) {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(node);
    return {
      destroy() {
        document.body.style.overflow = prevOverflow;
        node.remove();
      },
    };
  }
</script>

<div use:portal class="cmsbar-drawer-root" data-cms-ui>
  <div
    class="cmsbar-drawer-scrim"
    role="presentation"
    onclick={onClose}
  ></div>
  <div
    class="cmsbar-drawer"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
  >
    <header class="cmsbar-drawer-head">
      <div>
        <h2>⚙️ Settings</h2>
        <p class="cmsbar-drawer-sub">Site settings</p>
      </div>
      <button
        type="button"
        class="cmsbar-drawer-x"
        aria-label="Close"
        onclick={onClose}>&#10005;</button
      >
    </header>

    <div class="cmsbar-drawer-body">
      {#if !canEdit}
        <div class="cmsbar-ro-note">
          Read-only preview of the current values. Start a draft to edit.
        </div>
      {/if}

      <!-- Publishing mode (framework-neutral, read-only display) -->
      <section class="cmsbar-card">
        <div class="cmsbar-card-head">
          <h3>📤 Publishing</h3>
          <p>How saves reach the live site</p>
        </div>
        <div class="cmsbar-card-pad">
          <div
            class="cmsbar-status-row"
            class:live={DIRECT}
            class:teaser={!DIRECT}
          >
            {DIRECT
              ? "Direct - saves commit straight to the live branch (no review)."
              : "Review - saves open a draft PR for approval before going live."}
          </div>
        </div>
      </section>

      <!-- Site launch gate -->
      <section class="cmsbar-card">
        <div class="cmsbar-card-head">
          <h3>🚀 Site launch</h3>
          <p>Who sees the site, and who sees the teaser</p>
        </div>
        <fieldset class="cmsbar-card-pad cmsbar-fieldset" disabled={!canEdit}>
          <div
            class="cmsbar-status-row"
            class:live={status.tone === "live"}
            class:teaser={status.tone === "teaser"}
          >
            {status.text}
          </div>

          <div class="cmsbar-radio-stack">
            {#each LAUNCH_MODES as m (m.value)}
              {@const active = launch.mode === m.value}
              <button
                type="button"
                class="cmsbar-radio"
                class:active
                aria-pressed={active}
                onclick={() => update({ mode: m.value })}
              >
                <span class="cmsbar-radio-dot" class:active>
                  {#if active}<span class="cmsbar-radio-fill"></span>{/if}
                </span>
                <span>
                  <span class="cmsbar-radio-title">{m.title}</span>
                  <span class="cmsbar-radio-sub">{m.sub}</span>
                </span>
              </button>
            {/each}
          </div>
        </fieldset>
      </section>

      <!-- Shared-element highlight (the bar owns the body class; offered here too) -->
      {#if onToggleHighlight}
        <section class="cmsbar-card">
          <div class="cmsbar-card-head">
            <h3>🔗 Shared elements</h3>
            <p>Highlight content that appears on more than one page</p>
          </div>
          <div class="cmsbar-card-pad">
            <button
              type="button"
              class="cmsbar-toggle-row"
              aria-pressed={highlightShared}
              onclick={onToggleHighlight}
            >
              <span>
                <span class="cmsbar-radio-title">Highlight shared elements</span>
                <span class="cmsbar-radio-sub">
                  Outlines every element rendered on multiple pages.
                </span>
              </span>
              <span class="cmsbar-switch" class:on={highlightShared}>
                <span class="cmsbar-switch-knob"></span>
              </span>
            </button>
          </div>
        </section>
      {/if}
    </div>

    <footer class="cmsbar-drawer-foot">
      {#if canEdit}
        Changes stage into your draft. Click <strong>Save</strong> in the CMS bar
        to commit them.
      {:else}
        Read-only. Start a draft to edit.
      {/if}
    </footer>
  </div>
</div>

<style>
  .cmsbar-drawer-root {
    position: fixed;
    inset: 0;
    z-index: 150;
    font-family:
      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #0f172a;
  }
  .cmsbar-drawer-scrim {
    position: absolute;
    inset: 0;
    background: rgba(8, 12, 24, 0.45);
    backdrop-filter: blur(2px);
  }
  .cmsbar-drawer {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: min(520px, 100%);
    background: #fff;
    box-shadow: -20px 0 60px -20px rgba(0, 0, 0, 0.4);
  }
  .cmsbar-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #e2e8f0;
    padding: 1rem 1.25rem;
  }
  .cmsbar-drawer-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .cmsbar-drawer-sub {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-drawer-x {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
    color: #94a3b8;
  }
  .cmsbar-drawer-x:hover {
    color: #334155;
  }
  .cmsbar-drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cmsbar-drawer-foot {
    border-top: 1px solid #e2e8f0;
    padding: 0.75rem 1.25rem;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-ro-note {
    border-radius: 0.5rem;
    border: 1px solid #fde68a;
    background: #fffbeb;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: #92400e;
  }
  .cmsbar-card {
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
  }
  .cmsbar-card-head {
    border-bottom: 1px solid #f1f5f9;
    padding: 0.75rem 1rem;
  }
  .cmsbar-card-head h3 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .cmsbar-card-head p {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-card-pad {
    padding: 1rem;
  }
  .cmsbar-fieldset {
    margin: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cmsbar-fieldset:disabled {
    opacity: 0.6;
  }
  .cmsbar-status-row {
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .cmsbar-status-row.live {
    border-color: #a7f3d0;
    background: #ecfdf5;
    color: #065f46;
  }
  .cmsbar-status-row.teaser {
    border-color: #fde68a;
    background: #fffbeb;
    color: #92400e;
  }
  .cmsbar-radio-stack {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cmsbar-radio {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.625rem 0.75rem;
    background: #fff;
    cursor: pointer;
    font: inherit;
  }
  .cmsbar-radio:hover {
    border-color: #cbd5e1;
  }
  .cmsbar-radio.active {
    border-color: var(--cmsbar-info);
    background: var(--cmsbar-info-soft);
    box-shadow: 0 0 0 1px var(--cmsbar-info);
  }
  .cmsbar-radio-dot {
    margin-top: 0.125rem;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 1rem;
    width: 1rem;
    border-radius: 9999px;
    border: 1px solid #cbd5e1;
  }
  .cmsbar-radio-dot.active {
    border-color: var(--cmsbar-info);
  }
  .cmsbar-radio-fill {
    height: 0.5rem;
    width: 0.5rem;
    border-radius: 9999px;
    background: var(--cmsbar-info);
  }
  .cmsbar-radio-title {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: #1e293b;
  }
  .cmsbar-radio-sub {
    display: block;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .cmsbar-switch {
    position: relative;
    flex: none;
    height: 1.5rem;
    width: 2.75rem;
    border-radius: 9999px;
    background: #cbd5e1;
    transition: background 0.15s ease;
  }
  .cmsbar-switch.on {
    background: var(--cmsbar-shared-strong);
  }
  .cmsbar-switch-knob {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    height: 1.25rem;
    width: 1.25rem;
    border-radius: 9999px;
    background: #fff;
    transition: transform 0.15s ease;
  }
  .cmsbar-switch.on .cmsbar-switch-knob {
    transform: translateX(1.25rem);
  }
</style>
