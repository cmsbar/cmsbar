<script lang="ts" module>
  export type InfoItem = { icon: string; label: string; value: string };
</script>

<script lang="ts">
  // A repeatable list/block - the "Informacije" block - ported from
  // template/components/cmsbar/EditableInfoList.tsx to Svelte 5. Each item has an
  // icon, a label and a value.
  //
  //   - View mode: a plain list. The "footer" variant linkifies email/phone
  //     values and renders the label as a parenthetical; the default variant is
  //     an icon box + label + value stack.
  //   - Edit mode (active draft): per-item inline-editable label/value fields,
  //     an icon picker (the curated 12-icon set), a per-row delete, a drag
  //     handle to reorder, and an "Add item" button. Every mutation writes the
  //     whole array back through the store's addEdit(path, ...).
  //
  // Icons: the React original imports lucide-react (React-only). This port reuses
  // the existing inline-SVG icon registry (icons.svelte.ts) - the same lucide
  // node arrays rendered through Icon.svelte - so the icon vocabulary stays in
  // lockstep with the React app without a lucide-svelte dependency. ICON_NAMES,
  // getIconNode and the chrome glyphs (grip/plus/x) all come from there.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { isSharedPath } from "@/lib/cmsbar/shared-paths";
  import {
    ICON_NAMES,
    getIconNode,
    GRIP_VERTICAL,
    PLUS,
    X_MARK,
  } from "@/cmsbar/icons.svelte";
  import Icon from "@/cmsbar/Icon.svelte";

  type Props = {
    path: string;
    class?: string;
    iconSize?: number;
    swapOrder?: boolean;
    variant?: "default" | "footer";
  };

  let {
    path,
    class: className,
    iconSize,
    swapOrder = false,
    variant = "default",
  }: Props = $props();

  const store = getCmsContext();

  const items = $derived(((store.get(path) as InfoItem[] | undefined) ?? []) as InfoItem[]);
  const editMode = $derived(store.editMode);
  const authenticated = $derived(store.cms.authenticated);
  const shared = $derived(isSharedPath(path));
  const resolvedIconSize = $derived(iconSize ?? (variant === "footer" ? 18 : 24));

  // Drag-to-reorder state (editor only).
  let dragIndex = $state<number | null>(null);
  let overIndex = $state<number | null>(null);

  // Per-row icon-picker open state, keyed by row index.
  let pickerIndex = $state<number | null>(null);

  function update(next: InfoItem[]) {
    store.addEdit(path, next);
  }

  function move(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= items.length ||
      to >= items.length
    )
      return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update(next);
  }

  function patchItem(i: number, patch: Partial<InfoItem>) {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    update(next);
  }

  function removeItem(i: number) {
    const next = items.slice();
    next.splice(i, 1);
    update(next);
  }

  function addItem() {
    update([...items, { icon: "Clock", label: "Label", value: "Value" }]);
  }

  function isEmail(v: string) {
    return v.includes("@");
  }
  function isPhone(v: string) {
    return /^[\d\s+\-()]+$/.test(v.trim());
  }

  // Inline-editable commit: write trimmed textContent back when it changed.
  // The blur-only writer mirrors InlineEditable in the React original; the
  // value -> DOM reseed lives in the {@const} + bind below via reseedIfIdle.
  function commitField(
    node: HTMLElement,
    i: number,
    field: "label" | "value",
  ) {
    const nextText = (node.textContent ?? "").trim();
    if (nextText !== items[i][field]) patchItem(i, { [field]: nextText });
  }

  // value -> DOM sync for an inline-editable field. Seeds textContent and
  // resyncs only while the node is unfocused, so a re-render mid-edit never
  // collapses the caret (same rule as T.svelte / RichText.svelte).
  function inlineField(node: HTMLElement, getValue: () => string) {
    $effect(() => {
      const next = getValue();
      if (document.activeElement === node) return;
      if (node.textContent !== next) node.textContent = next;
    });
  }

  function onFieldKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  }
</script>

{#if !editMode}
  <div
    class={["cmsbar-info", className]}
    data-cms-path={authenticated ? path : undefined}
    data-cms-shared={authenticated && shared ? "true" : undefined}
  >
    {#each items as it, i (i)}
      {#if variant === "footer"}
        <div class="cmsbar-info-foot {it.label ? 'is-start' : 'is-center'}">
          <span class="cmsbar-info-foot-icon">
            <Icon node={getIconNode(it.icon)} size={resolvedIconSize} />
          </span>
          <span>
            {#if isEmail(it.value)}
              <a href={`mailto:${it.value}`} class="cmsbar-info-link">{it.value}</a>
            {:else if isPhone(it.value)}
              <a href={`tel:${it.value.replace(/\s/g, "")}`} class="cmsbar-info-link"
                >{it.value}</a
              >
            {:else}
              {it.value}
            {/if}
            {#if it.label}
              <br />
              <span class="cmsbar-info-foot-label">({it.label})</span>
            {/if}
          </span>
        </div>
      {:else}
        <div class="cmsbar-info-row">
          <div class="cmsbar-info-iconbox">
            <Icon node={getIconNode(it.icon)} size={resolvedIconSize} />
          </div>
          <div>
            <p class="cmsbar-info-label">{it.label}</p>
            <p class="cmsbar-info-value">{it.value}</p>
          </div>
        </div>
      {/if}
    {/each}
  </div>
{:else}
  <div
    class={["cmsbar-info", className]}
    data-cms-path={path}
    data-cms-shared={shared ? "true" : undefined}
  >
    {#each items as it, i (i)}
      <div
        class={[
          "cmsbar-info-edit",
          dragIndex === i && "is-dragging",
          overIndex === i && dragIndex !== null && dragIndex !== i && "is-over",
        ]}
        role="listitem"
        ondragover={(e) => {
          e.preventDefault();
          if (overIndex !== i) overIndex = i;
        }}
        ondrop={(e) => {
          e.preventDefault();
          if (dragIndex !== null) move(dragIndex, i);
          dragIndex = null;
          overIndex = null;
        }}
      >
        <button
          type="button"
          draggable="true"
          ondragstart={() => (dragIndex = i)}
          ondragend={() => {
            dragIndex = null;
            overIndex = null;
          }}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          class="cmsbar-info-grip"
        >
          <Icon node={GRIP_VERTICAL} size={16} />
        </button>

        <div class="cmsbar-info-pickwrap">
          <button
            type="button"
            onclick={() => (pickerIndex = pickerIndex === i ? null : i)}
            class={["cmsbar-info-iconbtn", pickerIndex === i && "is-open"]}
            title="Change icon"
          >
            <Icon node={getIconNode(it.icon)} size={resolvedIconSize} />
            <span class="cmsbar-info-iconbadge">✎</span>
          </button>
          {#if pickerIndex === i}
            <div class="cmsbar-info-picker" data-cms-ui>
              <p class="cmsbar-info-picker-title">Choose an icon</p>
              <div class="cmsbar-info-picker-grid">
                {#each ICON_NAMES as name (name)}
                  <button
                    type="button"
                    onclick={() => {
                      patchItem(i, { icon: name });
                      pickerIndex = null;
                    }}
                    title={name}
                    class={["cmsbar-info-picker-cell", name === it.icon && "is-selected"]}
                  >
                    <Icon node={getIconNode(name)} size={18} />
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="cmsbar-info-fields">
          {#if swapOrder}
            <span
              {@attach (node) => inlineField(node, () => items[i].value)}
              contenteditable="true"
              role="textbox"
              tabindex="0"
              class="cmsbar-editable cmsbar-info-field cmsbar-info-value"
              onblur={(e) => commitField(e.currentTarget, i, "value")}
              onkeydown={onFieldKeydown}
            ></span>
            {#if it.label}
              <span
                {@attach (node) => inlineField(node, () => items[i].label)}
                contenteditable="true"
                role="textbox"
                tabindex="0"
                class="cmsbar-editable cmsbar-info-field cmsbar-info-label"
                onblur={(e) => commitField(e.currentTarget, i, "label")}
                onkeydown={onFieldKeydown}
              ></span>
            {/if}
          {:else}
            <span
              {@attach (node) => inlineField(node, () => items[i].label)}
              contenteditable="true"
              role="textbox"
              tabindex="0"
              class="cmsbar-editable cmsbar-info-field cmsbar-info-label"
              onblur={(e) => commitField(e.currentTarget, i, "label")}
              onkeydown={onFieldKeydown}
            ></span>
            <span
              {@attach (node) => inlineField(node, () => items[i].value)}
              contenteditable="true"
              role="textbox"
              tabindex="0"
              class="cmsbar-editable cmsbar-info-field cmsbar-info-value"
              onblur={(e) => commitField(e.currentTarget, i, "value")}
              onkeydown={onFieldKeydown}
            ></span>
          {/if}
        </div>

        <button
          type="button"
          onclick={() => removeItem(i)}
          title="Remove item"
          aria-label="Remove item"
          class="cmsbar-info-delete"
        >
          <Icon node={X_MARK} size={14} />
        </button>
      </div>
    {/each}

    <button type="button" onclick={addItem} class="cmsbar-info-add">
      <Icon node={PLUS} size={16} /> Add item
    </button>
  </div>
{/if}

<style>
  .cmsbar-info {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ── View: default variant ──────────────────────────────────────────────── */
  .cmsbar-info-row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .cmsbar-info-iconbox {
    padding: 0.5rem;
    border-radius: 0.5rem;
    color: var(--cmsbar-icon);
  }
  .cmsbar-info-label {
    margin: 0;
    font-size: 0.875rem;
    color: #64748b; /* slate-500 */
    font-weight: 500;
  }
  .cmsbar-info-value {
    margin: 0;
    color: #1e293b; /* slate-800 */
    font-weight: 700;
  }

  /* ── View: footer variant ───────────────────────────────────────────────── */
  .cmsbar-info-foot {
    display: flex;
    gap: 0.75rem;
  }
  .cmsbar-info-foot.is-start {
    align-items: flex-start;
  }
  .cmsbar-info-foot.is-center {
    align-items: center;
  }
  .cmsbar-info-foot-icon {
    flex-shrink: 0;
    color: var(--cmsbar-icon);
  }
  .cmsbar-info-foot-label {
    font-size: 0.75rem;
    color: #64748b;
  }
  .cmsbar-info-link {
    text-decoration: none;
  }
  .cmsbar-info-link:hover {
    text-decoration: underline;
  }

  /* ── Edit: rows ─────────────────────────────────────────────────────────── */
  .cmsbar-info-edit {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    border-radius: 0.5rem;
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.5); /* dashed-ish blue-300 */
    padding: 0.25rem;
    transition:
      box-shadow 0.15s ease,
      opacity 0.15s ease;
  }
  .cmsbar-info-edit.is-dragging {
    opacity: 0.4;
  }
  .cmsbar-info-edit.is-over {
    box-shadow: 0 0 0 2px var(--cmsbar-info);
    background: var(--cmsbar-info-soft);
  }
  .cmsbar-info-grip {
    flex-shrink: 0;
    align-self: center;
    cursor: grab;
    border: 0;
    background: transparent;
    color: #cbd5e1; /* slate-300 */
    padding: 0;
    touch-action: none;
  }
  .cmsbar-info-grip:active {
    cursor: grabbing;
  }
  .cmsbar-info-grip:hover {
    color: #64748b;
  }

  /* Icon picker. */
  .cmsbar-info-pickwrap {
    position: relative;
  }
  .cmsbar-info-iconbtn {
    position: relative;
    padding: 0.5rem;
    border-radius: 0.5rem;
    border: 0;
    cursor: pointer;
    background: transparent;
    color: var(--cmsbar-icon);
  }
  .cmsbar-info-iconbtn.is-open {
    box-shadow: 0 0 0 2px var(--cmsbar-info);
  }
  .cmsbar-info-iconbadge {
    position: absolute;
    bottom: -0.25rem;
    right: -0.25rem;
    background: var(--cmsbar-info);
    color: #fff;
    border-radius: 9999px;
    width: 1rem;
    height: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    line-height: 1;
  }
  .cmsbar-info-picker {
    position: absolute;
    z-index: 20;
    top: 100%;
    margin-top: 0.5rem;
    left: 0;
    background: rgba(15, 23, 42, 1); /* slate-900 */
    color: #fff;
    padding: 0.75rem;
    border-radius: 0.75rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    width: 16rem;
  }
  .cmsbar-info-picker-title {
    margin: 0 0 0.5rem;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8; /* slate-400 */
  }
  .cmsbar-info-picker-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.25rem;
  }
  .cmsbar-info-picker-cell {
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    cursor: pointer;
    background: transparent;
    color: #fff;
    border-radius: 0.375rem;
  }
  .cmsbar-info-picker-cell:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .cmsbar-info-picker-cell.is-selected {
    background: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 0 2px var(--cmsbar-info);
  }

  /* Inline-editable fields. */
  .cmsbar-info-fields {
    flex: 1;
    min-width: 0;
  }
  .cmsbar-info-field {
    display: block;
  }

  /* Delete button. */
  .cmsbar-info-delete {
    position: absolute;
    top: -0.5rem;
    right: -0.5rem;
    opacity: 0;
    transition: opacity 0.15s ease;
    background: #fff;
    color: #64748b;
    border: 1px solid #e2e8f0; /* slate-200 */
    border-radius: 9999px;
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }
  .cmsbar-info-edit:hover .cmsbar-info-delete {
    opacity: 1;
  }
  .cmsbar-info-delete:hover {
    color: #ef4444; /* red-500 */
  }

  /* Add-item button. */
  .cmsbar-info-add {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 2px dashed #cbd5e1; /* slate-300 */
    background: transparent;
    color: #64748b;
    border-radius: 0.75rem;
    padding: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .cmsbar-info-add:hover {
    border-color: var(--cmsbar-info);
    color: var(--cmsbar-info);
  }
</style>
