<script lang="ts" module>
  // Block-level editor roots get the theme's .cmsbar-prose content defaults
  // (headings, lists, links survive a CSS reset). Must stay in sync with the
  // Toolbar's isBlockRoot check, which gates the block-format buttons.
  const BLOCK_TAGS = new Set(["div", "article", "section"]);

  // ── Selection/Range helpers, ported verbatim from RichText.tsx ──────────────

  export function applyClassToSelection(root: HTMLElement, className: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.className = className;
    try {
      range.surroundContents(span);
    } catch {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    sel.selectAllChildren(span);
  }

  export function findAncestorWithClass(
    root: HTMLElement,
    className: string,
  ): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    let node: Node | null = range.startContainer;
    while (node) {
      if (
        node.nodeType === 1 &&
        (node as HTMLElement).classList?.contains(className)
      ) {
        return node as HTMLElement;
      }
      if (node === root) break;
      node = node.parentNode;
    }
    return null;
  }

  export function findAncestorLink(root: HTMLElement): HTMLAnchorElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    let node: Node | null = range.startContainer;
    while (node) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === "A") {
        return node as HTMLAnchorElement;
      }
      if (node === root) break;
      node = node.parentNode;
    }
    return null;
  }

  export function unwrapElement(el: HTMLElement) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
</script>

<script lang="ts">
  // Inline rich-text editing, ported from template/components/cmsbar/RichText.tsx
  // to Svelte 5. View mode renders the saved (sanitized) HTML inert; edit mode
  // turns the same element into a contenteditable region with a floating
  // selection toolbar (h2/h3/h4, bold, italic, underline, lists, link, plus an
  // optional decorative-class button when cmsConfig.richText.decorClass is set).
  //
  // The toolbar drives the browser's execCommand + Selection/Range API exactly
  // as the React original does, then stages sanitized HTML through the store's
  // addEdit(path, ...). The same caret-preservation rule as T.svelte applies:
  // the value->DOM sync writes innerHTML only when the editor is NOT focused (and
  // focus is not parked in the toolbar's link input), so a re-render mid-edit
  // never detaches the saved selection or collapses the caret.
  //
  // The toolbar is rendered through a Svelte portal (node relocated to <body>),
  // mirroring the React <Portal>, so position:fixed coordinates are viewport-
  // relative and the panel escapes any overflow-clipping ancestor.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { isSharedPath } from "@/lib/cmsbar/shared-paths";
  import { cmsConfig } from "@/cms.config";
  import { sanitizeRichText } from "@/cmsbar/richText";
  import Toolbar from "@/cmsbar/RichTextToolbar.svelte";

  type Props = {
    path: string;
    as?: string;
    class?: string;
    fallback?: string;
  };

  let { path, as = "span", class: className, fallback = "" }: Props = $props();

  // Optional decorative class the toolbar can toggle on inline spans (empty
  // string disables the button entirely), configured per-project.
  const HAND_CLASS = cmsConfig.richText?.decorClass ?? "";

  const store = getCmsContext();

  const value = $derived((store.get(path) as string | undefined) ?? fallback);
  const editMode = $derived(store.editMode);
  const authenticated = $derived(store.cms.authenticated);
  const shared = $derived(isSharedPath(path));
  const isBlock = $derived(BLOCK_TAGS.has(as));

  let el = $state<HTMLElement | null>(null);
  let focused = $state(false);

  // Tracks the last HTML we either seeded or staged, so stage() can no-op when
  // nothing meaningful changed (mirrors lastSeenRef in RichText.tsx). Seeded by
  // the value->DOM effect below on mount; this is just the starting sentinel.
  let lastSeen = "";

  function stage(nextHtml: string) {
    const cleaned = sanitizeRichText(nextHtml, HAND_CLASS);
    if (cleaned === lastSeen) return;
    lastSeen = cleaned;
    store.addEdit(path, cleaned);
  }

  // value -> DOM sync (edit mode only). Writes innerHTML ONLY when the editor is
  // not focused and focus is not parked in the toolbar (the link input keeps a
  // live editing session whose saved Range we must not detach). Faithful copy of
  // the two RichText.tsx resync effects, collapsed into one.
  $effect(() => {
    const node = el;
    const next = value;
    if (!node) return;
    if (!editMode) return;
    if (typeof document === "undefined") return;
    if (document.activeElement === node) return;
    if (document.activeElement?.closest("[data-cms-toolbar]")) return;
    if (node.innerHTML !== next) node.innerHTML = next;
    lastSeen = next;
  });

  function onFocus() {
    focused = true;
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* unsupported on some browsers - harmless */
    }
  }

  function onBlur(e: FocusEvent) {
    // Always stage - even when focus moves into the toolbar (link input). The
    // resync effect above skips while the toolbar holds focus, so staging here
    // can no longer rewrite innerHTML mid-link-edit and detach the saved range.
    const html = (e.currentTarget as HTMLElement).innerHTML;
    stage(html);
    setTimeout(() => {
      if (document.activeElement?.closest("[data-cms-toolbar]")) return;
      focused = false;
    }, 200);
  }

  function swallow(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onAbandon() {
    if (el) stage(el.innerHTML);
    focused = false;
  }
</script>

{#if editMode}
  <svelte:element
    this={as}
    bind:this={el}
    data-cms-path={path}
    data-cms-shared={shared ? "true" : undefined}
    title={shared
      ? "Shared element - editing this changes it on every page that uses it"
      : undefined}
    class={[
      "cmsbar-richtext",
      shared && "cmsbar-richtext-shared",
      isBlock && "cmsbar-prose",
      className,
    ]}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    onfocus={onFocus}
    onblur={onBlur}
    onclickcapture={swallow}
  ></svelte:element>
  {#if focused && el}
    <Toolbar editor={el} handClass={HAND_CLASS} {onAbandon} />
  {/if}
{:else}
  <svelte:element
    this={as}
    data-cms-path={authenticated ? path : undefined}
    data-cms-shared={authenticated && shared ? "true" : undefined}
    class={[isBlock && "cmsbar-prose", className]}
  >{@html value}</svelte:element>
{/if}

<style>
  /* Edit-mode outline, mirroring RichText.tsx's ring treatment. The amber
     "shared" variant warns about site-wide content. */
  .cmsbar-richtext {
    outline: none;
    border-radius: 4px;
    padding: 0 2px;
    box-shadow: 0 0 0 1px var(--cmsbar-ring);
    transition: box-shadow 0.15s ease;
  }
  .cmsbar-richtext:hover {
    box-shadow: 0 0 0 1px var(--cmsbar-accent);
  }
  .cmsbar-richtext:focus {
    box-shadow: 0 0 0 2px var(--cmsbar-accent);
  }
  .cmsbar-richtext-shared {
    background: var(--cmsbar-shared-soft);
    box-shadow: 0 0 0 2px var(--cmsbar-shared);
  }
  .cmsbar-richtext-shared:hover,
  .cmsbar-richtext-shared:focus {
    box-shadow: 0 0 0 2px var(--cmsbar-shared-strong);
  }
</style>
