<script lang="ts">
  // SEO / social meta editor for the current page, ported from
  // template/components/cmsbar/PageMetaDrawer.tsx to Svelte 5. Reads/writes
  // pageMeta.<key>.<field> + the site-wide favicon through the store (metaKey /
  // META_PAGES from the neutral @/lib/cmsbar/page-meta). Includes the inline
  // image browser (GET /media/list?type=image), the Google + Facebook/X social
  // previews, and the character counters. The ImageField + Counter + Text +
  // Toggle React sub-components are reproduced here as snippets / local markup.

  import { cmsConfig } from "@/cms.config";
  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { metaKey, META_PAGES } from "@/lib/cmsbar/page-meta";
  import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
  import { page } from "$app/state";

  type Props = { onClose: () => void; canEdit: boolean };
  let { onClose, canEdit }: Props = $props();

  const TITLE_MAX = 60;
  const DESC_MAX = 155;

  const store = getCmsContext();
  const pathname = $derived(page.url.pathname);
  const key = $derived(metaKey(pathname));

  let socialView = $state<"fb" | "x">("fb");

  // Read helpers (string + boolean fields).
  function field(name: string): string {
    return key
      ? ((store.get(`pageMeta.${key}.${name}`) as string | undefined) ?? "")
      : "";
  }
  const noindex = $derived(
    key ? Boolean(store.get(`pageMeta.${key}.noindex`)) : false,
  );
  const favicon = $derived((store.get("favicon") as string | undefined) ?? "");

  function set(name: string, value: string | boolean) {
    if (!key) return;
    store.addEdit(`pageMeta.${key}.${name}`, value);
  }

  const title = $derived(field("title"));
  const description = $derived(field("description"));
  const ogImage = $derived(field("ogImage"));
  const ogTitle = $derived(field("ogTitle"));
  const ogDescription = $derived(field("ogDescription"));
  const canonical = $derived(field("canonical"));

  const metaPageLabels = META_PAGES.map((p) => p.label).join(", ");

  // ── Inline image browser state (one per ImageField, keyed by which field) ──
  let browsingField = $state<string | null>(null);
  let browseItems = $state<{ path: string }[] | null>(null);

  async function openBrowse(forField: string) {
    if (browsingField === forField) {
      browsingField = null;
      return;
    }
    browsingField = forField;
    if (browseItems !== null) return;
    try {
      const res = await cmsFetch("/media/list?type=image", {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        files?: { path: string }[];
      };
      browseItems = data.files ?? [];
    } catch {
      browseItems = [];
    }
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

{#snippet counter(n: number, max: number)}
  <span class="cmsbar-pm-counter" class:over={n > max}>{n} / {max}</span>
{/snippet}

{#snippet imageField(
  label: string,
  help: string,
  value: string,
  onChange: (v: string) => void,
  fieldId: string,
)}
  <div>
    <span class="cmsbar-pm-label">{label}</span>
    <div class="cmsbar-pm-imgrow">
      <div class="cmsbar-pm-thumb">
        {#if value}<img src={value} alt="" />{/if}
      </div>
      <input
        type="text"
        class="cmsbar-pm-input"
        placeholder="/images/…"
        {value}
        oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      <button
        type="button"
        class="cmsbar-pm-smallbtn"
        onclick={() => openBrowse(fieldId)}
      >
        {browsingField === fieldId ? "Close" : "Browse"}
      </button>
      {#if value}
        <button
          type="button"
          class="cmsbar-pm-smallbtn danger"
          onclick={() => onChange("")}>Clear</button
        >
      {/if}
    </div>
    <p class="cmsbar-pm-help">{help}</p>
    {#if browsingField === fieldId}
      <div class="cmsbar-pm-browse">
        {#if browseItems === null}
          <p class="cmsbar-pm-browse-msg">Loading…</p>
        {:else if browseItems.length === 0}
          <p class="cmsbar-pm-browse-msg">No images found.</p>
        {:else}
          {#each browseItems as it (it.path)}
            <button
              type="button"
              class="cmsbar-pm-tile"
              class:active={it.path === value}
              title={it.path}
              aria-label="Use this image"
              onclick={() => {
                onChange(it.path);
                browsingField = null;
              }}
            >
              <img src={it.path} alt="" />
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div use:portal class="cmsbar-pm-root" data-cms-ui>
  <div class="cmsbar-pm-scrim" role="presentation" onclick={onClose}></div>
  <div
    class="cmsbar-pm-drawer"
    role="dialog"
    aria-modal="true"
    aria-label="Page metadata"
  >
    <header class="cmsbar-pm-head">
      <div>
        <h2>Page metadata</h2>
        <p class="cmsbar-pm-sub">
          Editing: <span class="cmsbar-pm-path">{pathname}</span>
        </p>
      </div>
      <button
        type="button"
        class="cmsbar-pm-x"
        aria-label="Close"
        onclick={onClose}>&#10005;</button
      >
    </header>

    <div class="cmsbar-pm-body">
      {#if !key}
        <div class="cmsbar-pm-nokey">
          Metadata editing is available on the main pages: {metaPageLabels}.
          Course and teacher pages take their title/description from their own
          content.
        </div>
      {:else}
        <fieldset class="cmsbar-pm-fieldset" disabled={!canEdit}>
          {#if !canEdit}
            <div class="cmsbar-pm-ro">
              Viewing the live values (read-only). <strong>Start a draft</strong>
              to edit metadata.
            </div>
          {/if}

          <!-- Title -->
          <div>
            <label class="cmsbar-pm-label cmsbar-pm-label-row" for="cmsbar-pm-title">
              <span>Page title</span>
              {@render counter(title.length, TITLE_MAX)}
            </label>
            <input
              id="cmsbar-pm-title"
              type="text"
              class="cmsbar-pm-input full"
              value={title}
              oninput={(e) =>
                set("title", (e.currentTarget as HTMLInputElement).value)}
            />
            <p class="cmsbar-pm-help">Browser tab + the search-result headline.</p>
          </div>

          <!-- Description -->
          <div>
            <label
              class="cmsbar-pm-label cmsbar-pm-label-row"
              for="cmsbar-pm-desc"
            >
              <span>Meta description</span>
              {@render counter(description.length, DESC_MAX)}
            </label>
            <textarea
              id="cmsbar-pm-desc"
              rows="3"
              class="cmsbar-pm-input full"
              value={description}
              oninput={(e) =>
                set(
                  "description",
                  (e.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            <p class="cmsbar-pm-help">Summary under the title in search results.</p>
          </div>

          <!-- Social image -->
          {@render imageField(
            "Social share image (og:image)",
            "Shown when shared on Facebook/WhatsApp/Messenger. 1200×630.",
            ogImage,
            (v) => set("ogImage", v),
            "ogImage",
          )}

          <!-- noindex toggle -->
          <div class="cmsbar-pm-toggle">
            <div>
              <div class="cmsbar-pm-toggle-title">Show in search engines</div>
              <div class="cmsbar-pm-toggle-sub">
                Turn off to add noindex (hide this page from Google).
              </div>
            </div>
            <button
              type="button"
              class="cmsbar-pm-switch"
              class:on={!noindex}
              aria-pressed={!noindex}
              aria-label="Show in search engines"
              onclick={() => set("noindex", !noindex ? true : false)}
            >
              <span class="cmsbar-pm-switch-knob"></span>
            </button>
          </div>

          <!-- Advanced -->
          <details class="cmsbar-pm-advanced">
            <summary>Advanced</summary>
            <div class="cmsbar-pm-advanced-body">
              <div>
                <label class="cmsbar-pm-label" for="cmsbar-pm-ogtitle"
                  >Social title</label
                >
                <input
                  id="cmsbar-pm-ogtitle"
                  type="text"
                  class="cmsbar-pm-input full"
                  placeholder={title}
                  value={ogTitle}
                  oninput={(e) =>
                    set("ogTitle", (e.currentTarget as HTMLInputElement).value)}
                />
              </div>
              <div>
                <label class="cmsbar-pm-label" for="cmsbar-pm-ogdesc"
                  >Social description</label
                >
                <textarea
                  id="cmsbar-pm-ogdesc"
                  rows="2"
                  class="cmsbar-pm-input full"
                  placeholder={description}
                  value={ogDescription}
                  oninput={(e) =>
                    set(
                      "ogDescription",
                      (e.currentTarget as HTMLTextAreaElement).value,
                    )}
                ></textarea>
              </div>
              <div>
                <label class="cmsbar-pm-label" for="cmsbar-pm-canonical"
                  >Canonical URL (blank = auto)</label
                >
                <input
                  id="cmsbar-pm-canonical"
                  type="text"
                  class="cmsbar-pm-input full"
                  placeholder="https://…"
                  value={canonical}
                  oninput={(e) =>
                    set(
                      "canonical",
                      (e.currentTarget as HTMLInputElement).value,
                    )}
                />
              </div>
            </div>
          </details>

          <!-- Site-wide favicon -->
          <div class="cmsbar-pm-sitewide">
            <p class="cmsbar-pm-section">Site-wide (applies to every page)</p>
            {@render imageField(
              "Favicon",
              "Browser-tab icon. PNG/SVG/ICO; square (e.g. 32×32 or 512×512).",
              favicon,
              (v) => store.addEdit("favicon", v),
              "favicon",
            )}
          </div>

          <!-- Google result preview -->
          <div>
            <p class="cmsbar-pm-section">Google result</p>
            <div class="cmsbar-pm-serp">
              <div class="cmsbar-pm-serp-url">
                {cmsConfig.domain} › {key === "home" ? "" : key}
              </div>
              <div class="cmsbar-pm-serp-title">{title || "Untitled page"}</div>
              <div class="cmsbar-pm-serp-desc">
                {description || "No description set."}
              </div>
            </div>
          </div>

          <!-- Social preview -->
          <div>
            <div class="cmsbar-pm-social-head">
              <p class="cmsbar-pm-section">Social share</p>
              <div class="cmsbar-pm-segment">
                {#each ["fb", "x"] as const as v (v)}
                  <button
                    type="button"
                    class="cmsbar-pm-seg-btn"
                    class:active={socialView === v}
                    onclick={() => (socialView = v)}
                  >
                    {v === "fb" ? "Facebook" : "X / Twitter"}
                  </button>
                {/each}
              </div>
            </div>

            {#if socialView === "fb"}
              <div class="cmsbar-pm-fbcard">
                <div
                  class="cmsbar-pm-ogimg"
                  style:background-image={ogImage ? `url(${ogImage})` : undefined}
                >
                  {ogImage ? "" : "1200 × 630 image"}
                </div>
                <div class="cmsbar-pm-fbmeta">
                  <div class="cmsbar-pm-fbdomain">{cmsConfig.domain}</div>
                  <div class="cmsbar-pm-fbtitle">
                    {ogTitle || title || "Untitled page"}
                  </div>
                  <div class="cmsbar-pm-fbdesc">
                    {ogDescription || description || "No description set."}
                  </div>
                </div>
              </div>
            {:else}
              <div class="cmsbar-pm-xcard">
                <div
                  class="cmsbar-pm-ogimg"
                  style:background-image={ogImage ? `url(${ogImage})` : undefined}
                >
                  {ogImage ? "" : "Summary image"}
                </div>
                <div class="cmsbar-pm-xmeta">
                  <div class="cmsbar-pm-xtitle">
                    {ogTitle || title || "Untitled page"}
                  </div>
                  <div class="cmsbar-pm-fbdesc">
                    {ogDescription || description || "No description set."}
                  </div>
                  <div class="cmsbar-pm-xdomain">{cmsConfig.domain}</div>
                </div>
              </div>
            {/if}
          </div>
        </fieldset>
      {/if}
    </div>

    <footer class="cmsbar-pm-foot">
      {#if canEdit}
        Changes are staged in your draft - click <strong>Save</strong> in the CMS
        bar to commit them.
      {:else}
        Read-only preview - start a draft from the CMS bar to make changes.
      {/if}
      <span class="cmsbar-pm-note">
        Note: the live page&rsquo;s &lt;head&gt; updates after the draft is
        merged &amp; deployed; this panel is the preview.
      </span>
    </footer>
  </div>
</div>

<style>
  .cmsbar-pm-root {
    position: fixed;
    inset: 0;
    z-index: 150;
    font-family:
      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #0f172a;
  }
  .cmsbar-pm-scrim {
    position: absolute;
    inset: 0;
    background: rgba(8, 12, 24, 0.45);
    backdrop-filter: blur(2px);
  }
  .cmsbar-pm-drawer {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    background: #fff;
    box-shadow: -20px 0 60px -20px rgba(0, 0, 0, 0.4);
  }
  .cmsbar-pm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #e2e8f0;
    padding: 1rem 1.25rem;
  }
  .cmsbar-pm-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .cmsbar-pm-sub {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-path {
    font-weight: 500;
    color: var(--cmsbar-info);
  }
  .cmsbar-pm-x {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
    color: #94a3b8;
  }
  .cmsbar-pm-x:hover {
    color: #334155;
  }
  .cmsbar-pm-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .cmsbar-pm-foot {
    border-top: 1px solid #e2e8f0;
    padding: 0.75rem 1.25rem;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-note {
    margin-top: 0.25rem;
    display: block;
    color: #94a3b8;
  }
  .cmsbar-pm-nokey {
    border-radius: 0.5rem;
    border: 1px dashed #cbd5e1;
    background: #f8fafc;
    padding: 1rem;
    font-size: 0.875rem;
    color: #475569;
  }
  .cmsbar-pm-fieldset {
    margin: 0;
    border: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .cmsbar-pm-fieldset:disabled {
    opacity: 0.7;
  }
  .cmsbar-pm-ro {
    border-radius: 0.5rem;
    border: 1px solid #fde68a;
    background: #fffbeb;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: #92400e;
  }
  .cmsbar-pm-label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #334155;
  }
  .cmsbar-pm-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cmsbar-pm-counter {
    font-size: 11px;
    font-weight: 500;
    color: #94a3b8;
  }
  .cmsbar-pm-counter.over {
    color: #dc2626;
  }
  .cmsbar-pm-input {
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
    font-family: inherit;
  }
  .cmsbar-pm-input.full {
    width: 100%;
  }
  .cmsbar-pm-input:focus {
    border-color: var(--cmsbar-accent);
    box-shadow: 0 0 0 2px var(--cmsbar-accent-soft);
  }
  .cmsbar-pm-help {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-imgrow {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cmsbar-pm-thumb {
    height: 3rem;
    width: 3rem;
    flex: none;
    overflow: hidden;
    border-radius: 0.375rem;
    border: 1px solid #e2e8f0;
    background: #f1f5f9;
  }
  .cmsbar-pm-thumb img {
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
  .cmsbar-pm-imgrow .cmsbar-pm-input {
    min-width: 0;
    flex: 1;
  }
  .cmsbar-pm-smallbtn {
    flex: none;
    border: 1px solid #cbd5e1;
    border-radius: 0.375rem;
    background: #fff;
    cursor: pointer;
    padding: 0.5rem 0.625rem;
    font-size: 0.75rem;
    font-family: inherit;
    color: #334155;
  }
  .cmsbar-pm-smallbtn:hover {
    border-color: var(--cmsbar-accent);
    color: var(--cmsbar-accent);
  }
  .cmsbar-pm-smallbtn.danger:hover {
    border-color: #f87171;
    color: #ef4444;
  }
  .cmsbar-pm-browse {
    margin-top: 0.5rem;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
    max-height: 12rem;
    overflow-y: auto;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.5rem;
  }
  .cmsbar-pm-browse-msg {
    grid-column: span 5;
    margin: 0;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-tile {
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 0.375rem;
    border: 1px solid #e2e8f0;
    background: #f1f5f9;
    cursor: pointer;
    padding: 0;
  }
  .cmsbar-pm-tile:hover {
    border-color: var(--cmsbar-accent);
  }
  .cmsbar-pm-tile.active {
    border-color: var(--cmsbar-accent);
    box-shadow: 0 0 0 2px var(--cmsbar-accent-soft);
  }
  .cmsbar-pm-tile img {
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
  .cmsbar-pm-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.625rem 0.75rem;
  }
  .cmsbar-pm-toggle-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #334155;
  }
  .cmsbar-pm-toggle-sub {
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-switch {
    position: relative;
    flex: none;
    height: 1.5rem;
    width: 2.75rem;
    border-radius: 9999px;
    background: #cbd5e1;
    border: 0;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .cmsbar-pm-switch.on {
    background: var(--cmsbar-info);
  }
  .cmsbar-pm-switch-knob {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    height: 1.25rem;
    width: 1.25rem;
    border-radius: 9999px;
    background: #fff;
    transition: transform 0.15s ease;
  }
  .cmsbar-pm-switch.on .cmsbar-pm-switch-knob {
    transform: translateX(1.25rem);
  }
  .cmsbar-pm-advanced {
    border-top: 1px solid #e2e8f0;
    padding-top: 0.75rem;
  }
  .cmsbar-pm-advanced summary {
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--cmsbar-info);
  }
  .cmsbar-pm-advanced-body {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cmsbar-pm-sitewide {
    border-top: 1px solid #e2e8f0;
    padding-top: 0.75rem;
  }
  .cmsbar-pm-section {
    margin: 0 0 0.5rem;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
  }
  .cmsbar-pm-serp {
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
    padding: 0.75rem;
  }
  .cmsbar-pm-serp-url {
    font-size: 13px;
    color: #15803d;
  }
  .cmsbar-pm-serp-title {
    font-size: 1.125rem;
    line-height: 1.375;
    color: #1d4ed8;
  }
  .cmsbar-pm-serp-desc {
    margin-top: 0.125rem;
    font-size: 13px;
    line-height: 1.375;
    color: #475569;
  }
  .cmsbar-pm-social-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .cmsbar-pm-segment {
    display: flex;
    gap: 0.25rem;
    border-radius: 0.375rem;
    background: #f1f5f9;
    padding: 0.125rem;
  }
  .cmsbar-pm-seg-btn {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.125rem 0.5rem;
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    background: transparent;
    font-family: inherit;
  }
  .cmsbar-pm-seg-btn.active {
    background: #fff;
    color: #334155;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  .cmsbar-pm-ogimg {
    height: 10rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #e2e8f0;
    background-size: cover;
    background-position: center;
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-pm-fbcard {
    overflow: hidden;
    border-radius: 0.375rem;
    border: 1px solid #e2e8f0;
  }
  .cmsbar-pm-fbmeta {
    border-top: 1px solid #e2e8f0;
    background: #f2f3f5;
    padding: 0.5rem 0.75rem;
  }
  .cmsbar-pm-fbdomain {
    font-size: 11px;
    text-transform: uppercase;
    color: #64748b;
  }
  .cmsbar-pm-fbtitle {
    font-size: 15px;
    font-weight: 600;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmsbar-pm-fbdesc {
    font-size: 0.75rem;
    color: #64748b;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .cmsbar-pm-xcard {
    overflow: hidden;
    border-radius: 1rem;
    border: 1px solid #e2e8f0;
  }
  .cmsbar-pm-xmeta {
    padding: 0.5rem 0.75rem;
  }
  .cmsbar-pm-xtitle {
    font-size: 0.875rem;
    font-weight: 600;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmsbar-pm-xdomain {
    margin-top: 0.125rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }
</style>
