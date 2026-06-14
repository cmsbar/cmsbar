<script lang="ts">
  // Floating selection toolbar for RichText.svelte, ported from the Toolbar
  // sub-component of template/components/cmsbar/RichText.tsx. Tracks the editor's
  // viewport position (so it floats above the active region) and the current
  // selection's formatting state (via document.queryCommandState /
  // queryCommandValue + the Selection/Range ancestor walks), then drives the
  // same execCommand actions: bold/italic/underline, an optional decorative-span
  // toggle, block formats (P/H2/H3/H4) and lists for block roots, clear
  // formatting, and a link add/edit/remove panel that preserves the saved Range
  // across the input's focus excursion. Rendered through a Svelte portal so its
  // position:fixed coordinates are viewport-relative.

  import {
    applyClassToSelection,
    findAncestorWithClass,
    findAncestorLink,
    unwrapElement,
  } from "@/cmsbar/RichText.svelte";

  type Props = {
    editor: HTMLElement;
    handClass: string;
    /**
     * Focus left the toolbar for somewhere outside the editor too. The editor's
     * own blur fired earlier (skipped, focus was toolbar-bound) - the host must
     * stage its content now or edits made before opening the panel are lost.
     */
    onAbandon?: () => void;
  };

  let { editor, handClass, onAbandon }: Props = $props();

  let pos = $state<{ x: number; y: number } | null>(null);
  let active = $state({
    bold: false,
    italic: false,
    underline: false,
    hand: false,
    block: "p",
    ul: false,
    ol: false,
    linkHref: null as string | null, // null = cursor not inside a link
  });

  let linkOpen = $state(false);
  let linkHref = $state("");
  let linkInput = $state<HTMLInputElement | null>(null);
  let savedRange: Range | null = null;

  const isBlockRoot = $derived(
    editor.tagName === "DIV" ||
      editor.tagName === "ARTICLE" ||
      editor.tagName === "SECTION",
  );

  function updatePos() {
    const rect = editor.getBoundingClientRect();
    pos = { x: rect.left + rect.width / 2, y: rect.top };
  }

  function updateActive() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (!editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    const rawBlock = String(document.queryCommandValue("formatBlock") || "")
      .toLowerCase()
      .replace(/[<>]/g, "");
    const block = ["h1", "h2", "h3", "h4", "p"].includes(rawBlock)
      ? rawBlock
      : "p";
    const anchor = findAncestorLink(editor);
    active = {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      hand: !!(handClass && findAncestorWithClass(editor, handClass)),
      block,
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
      linkHref: anchor ? (anchor.getAttribute("href") ?? "") : null,
    };
  }

  $effect(() => {
    updatePos();
    updateActive();
    document.addEventListener("selectionchange", updateActive);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("selectionchange", updateActive);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  });

  function exec(cmd: string, value?: string) {
    editor.focus();
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported */
    }
    document.execCommand(cmd, false, value);
  }

  function setBlock(tag: "p" | "h2" | "h3" | "h4") {
    exec("formatBlock", `<${tag}>`);
  }

  function toggleHand() {
    editor.focus();
    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;
    const ancestor = findAncestorWithClass(editor, handClass);
    if (ancestor === editor) return;
    if (ancestor) {
      unwrapElement(ancestor);
    } else if (!collapsed) {
      applyClassToSelection(editor, handClass);
    }
    active = { ...active, hand: !active.hand };
  }

  function openLink() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
    linkHref = active.linkHref ?? "";
    const wasOpen = linkOpen;
    linkOpen = !wasOpen;
    if (!wasOpen) setTimeout(() => linkInput?.focus(), 50);
  }

  function applyLink() {
    const href = linkHref.trim();
    if (!href) return;

    // If a re-render rewrote the editor's innerHTML since the range was saved,
    // its nodes are detached; restoring it would give a collapsed selection and
    // silently skip createLink. Close the panel instead.
    if (savedRange && !savedRange.startContainer.isConnected) {
      linkOpen = false;
      return;
    }

    editor.focus();
    const sel = window.getSelection();
    if (sel && savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    const existingAnchor = findAncestorLink(editor);
    if (existingAnchor) {
      existingAnchor.setAttribute("href", href);
      if (href.startsWith("http")) {
        existingAnchor.setAttribute("target", "_blank");
        existingAnchor.setAttribute("rel", "noopener noreferrer");
      } else {
        existingAnchor.removeAttribute("target");
        existingAnchor.removeAttribute("rel");
      }
    } else if (savedRange && !savedRange.collapsed) {
      exec("createLink", href);
      const newAnchor = findAncestorLink(editor);
      if (newAnchor && href.startsWith("http")) {
        newAnchor.setAttribute("target", "_blank");
        newAnchor.setAttribute("rel", "noopener noreferrer");
      }
    }

    linkOpen = false;
  }

  function removeLink() {
    exec("unlink");
    linkOpen = false;
  }

  function onLinkKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyLink();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Refocus the editor BEFORE the input unmounts - an element removed while
      // focused fires no blur, which would orphan the toolbar and skip the
      // container's abandon handling.
      editor.focus();
      linkOpen = false;
    }
  }

  function onToolbarBlur(e: FocusEvent) {
    // Focus left the toolbar (link input / tab-out) for somewhere outside the
    // editor: the editing session is over. Close the panel and let the host
    // stage + dismiss, instead of orphaning a floating toolbar.
    const next = e.relatedTarget as HTMLElement | null;
    const current = e.currentTarget as HTMLElement;
    if (
      next &&
      (current.contains(next) || next === editor || editor.contains(next))
    ) {
      return;
    }
    linkOpen = false;
    onAbandon?.();
  }

  // Svelte portal: relocate the node to <body> on mount, restore on destroy.
  // Equivalent to the React <Portal>.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#if pos}
  <div
    use:portal
    data-cms-toolbar
    class="cmsbar-rt-toolbar"
    style:left="{pos.x}px"
    style:top="{Math.max(8, pos.y - 44)}px"
    onmousedown={(e) => e.preventDefault()}
    onfocusout={onToolbarBlur}
    role="toolbar"
    tabindex="-1"
  >
    <div class="cmsbar-rt-row">
      <button
        type="button"
        class={["cmsbar-rt-btn cmsbar-rt-b", active.bold && "is-active"]}
        onclick={() => exec("bold")}
        title="Bold (Cmd/Ctrl+B)"
      >
        B
      </button>
      <button
        type="button"
        class={["cmsbar-rt-btn cmsbar-rt-i", active.italic && "is-active"]}
        onclick={() => exec("italic")}
        title="Italic (Cmd/Ctrl+I)"
      >
        I
      </button>
      <button
        type="button"
        class={["cmsbar-rt-btn cmsbar-rt-u", active.underline && "is-active"]}
        onclick={() => exec("underline")}
        title="Underline (Cmd/Ctrl+U)"
      >
        U
      </button>

      {#if handClass}
        <span class="cmsbar-rt-sep"></span>
        <button
          type="button"
          class={["cmsbar-rt-btn", handClass, active.hand && "is-active"]}
          onclick={toggleHand}
          title="Toggle decorative font on selection"
        >
          Hand
        </button>
      {/if}

      {#if isBlockRoot}
        <span class="cmsbar-rt-sep"></span>
        <button
          type="button"
          class={["cmsbar-rt-btn", active.block === "p" && "is-active"]}
          onclick={() => setBlock("p")}
          title="Paragraph"
        >
          P
        </button>
        <button
          type="button"
          class={["cmsbar-rt-btn cmsbar-rt-b", active.block === "h2" && "is-active"]}
          onclick={() => setBlock("h2")}
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          class={["cmsbar-rt-btn cmsbar-rt-b", active.block === "h3" && "is-active"]}
          onclick={() => setBlock("h3")}
          title="Heading 3"
        >
          H3
        </button>
        <button
          type="button"
          class={["cmsbar-rt-btn cmsbar-rt-b", active.block === "h4" && "is-active"]}
          onclick={() => setBlock("h4")}
          title="Heading 4"
        >
          H4
        </button>
        <span class="cmsbar-rt-sep"></span>
        <button
          type="button"
          class={["cmsbar-rt-btn", active.ul && "is-active"]}
          onclick={() => exec("insertUnorderedList")}
          title="Bulleted list"
        >
          • List
        </button>
        <button
          type="button"
          class={["cmsbar-rt-btn", active.ol && "is-active"]}
          onclick={() => exec("insertOrderedList")}
          title="Numbered list"
        >
          1. List
        </button>
      {/if}

      <span class="cmsbar-rt-sep"></span>
      <button
        type="button"
        class="cmsbar-rt-btn cmsbar-rt-muted"
        onclick={() => exec("removeFormat")}
        title="Clear formatting"
      >
        Clear
      </button>

      <span class="cmsbar-rt-sep"></span>
      <button
        type="button"
        class={[
          "cmsbar-rt-btn",
          (active.linkHref !== null || linkOpen) && "is-active",
        ]}
        onclick={openLink}
        title={active.linkHref !== null ? "Edit link" : "Add link to selection"}
      >
        Link
      </button>
    </div>

    {#if linkOpen}
      <div class="cmsbar-rt-linkrow">
        <input
          bind:this={linkInput}
          type="url"
          bind:value={linkHref}
          onkeydown={onLinkKeydown}
          onmousedown={(e) => e.stopPropagation()}
          placeholder="https://..."
          class="cmsbar-rt-linkinput"
        />
        <button
          type="button"
          class="cmsbar-rt-btn cmsbar-rt-apply"
          onclick={applyLink}
        >
          Apply
        </button>
        {#if active.linkHref !== null}
          <button
            type="button"
            class="cmsbar-rt-btn cmsbar-rt-remove"
            onclick={removeLink}
          >
            Remove
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Plain-CSS reproduction of the React toolbar's Tailwind chrome (dark
     rounded panel, small pill buttons, accent active state). */
  .cmsbar-rt-toolbar {
    position: fixed;
    z-index: 120;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    border-radius: 0.5rem;
    background: rgba(15, 23, 42, 0.95); /* slate-900/95 */
    color: #fff;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    font-family:
      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .cmsbar-rt-row {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem;
  }
  .cmsbar-rt-btn {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    background: transparent;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    font-family: inherit;
    line-height: 1.1;
  }
  .cmsbar-rt-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .cmsbar-rt-btn.is-active {
    background: var(--cmsbar-accent);
    color: #fff;
  }
  .cmsbar-rt-btn.is-active:hover {
    background: var(--cmsbar-accent);
  }
  .cmsbar-rt-b {
    font-weight: 700;
  }
  .cmsbar-rt-i {
    font-style: italic;
  }
  .cmsbar-rt-u {
    text-decoration: underline;
  }
  .cmsbar-rt-muted {
    color: rgba(255, 255, 255, 0.7);
  }
  .cmsbar-rt-sep {
    margin: 0 0.25rem;
    width: 1px;
    height: 1rem;
    background: rgba(255, 255, 255, 0.2);
  }
  .cmsbar-rt-linkrow {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    padding: 0.375rem 0.5rem;
  }
  .cmsbar-rt-linkinput {
    min-width: 220px;
    flex: 1;
    border: 0;
    border-radius: 0.25rem;
    background: #1e293b; /* slate-800 */
    color: #fff;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    outline: none;
    font-family: inherit;
  }
  .cmsbar-rt-linkinput:focus {
    box-shadow: 0 0 0 1px var(--cmsbar-accent);
  }
  .cmsbar-rt-apply {
    background: var(--cmsbar-accent);
    color: #fff;
  }
  .cmsbar-rt-apply:hover {
    background: var(--cmsbar-accent-strong);
  }
  .cmsbar-rt-remove {
    color: #f87171; /* red-400 */
  }
  .cmsbar-rt-remove:hover {
    color: #fca5a5;
    background: rgba(255, 255, 255, 0.1);
  }
</style>
