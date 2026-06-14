<script lang="ts">
  // Editable text primitive, ported from template/components/cmsbar/T.tsx to
  // Svelte 5. Every editable text node renders through this component.
  //
  //   - View mode: a plain <{as}> element with the resolved string as its text.
  //     `data-cms-path` is attached only for an authenticated editor (it is the
  //     hook editor tooling keys off), exactly as the React version does. No
  //     contenteditable, so public HTML stays inert.
  //   - Edit mode (an active, editable draft): the same element gains
  //     `contenteditable`; typing stages the new value through the store's
  //     addEdit(path, ...). Enter blurs (single-line) so a stray newline never
  //     sneaks into a heading.
  //
  // S2 is plain-text only: the React T uses innerHTML to round-trip inline
  // rich-text tags, but rich text is a later Svelte phase, so we read/write
  // textContent here. The caret-preservation rule is reproduced faithfully:
  // the value->DOM sync writes textContent ONLY when the element is not focused,
  // so re-renders mid-edit never collapse the user's caret to position 0.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { cmsConfig } from "@/cms.config";

  type Props = {
    path: string;
    as?: string;
    class?: string;
    /** Fallback text when the content model has no value for `path`. */
    children?: import("svelte").Snippet;
    fallback?: string;
  };

  let { path, as = "span", class: className, fallback = "" }: Props = $props();

  const store = getCmsContext();

  // Reactive reads off the store: value re-resolves and editMode flips live.
  const value = $derived((store.get(path) as string | undefined) ?? fallback);
  const editMode = $derived(store.editMode);
  const authenticated = $derived(store.cms.authenticated);

  // Mirror of the React helper: warn the editor when a path renders site-wide.
  // (The neutral isSharedPath lives in template/components/cmsbar, which this
  // example does not copy - see the neutral-core gap note in the PR summary -
  // so the prefix check is inlined here against cmsConfig.)
  const shared = $derived.by(() => {
    for (const p of cmsConfig.sharedPrefixes) {
      if (path === p.slice(0, -1) || path.startsWith(p)) return true;
    }
    return false;
  });

  let el = $state<HTMLElement | null>(null);

  // value -> DOM sync. Only write when the node exists, is in edit mode, and is
  // NOT the active element: writing textContent on a focused contenteditable
  // resets the caret, so we leave the user's in-progress text alone and let the
  // on:input handler own it. Matches T.tsx's `document.activeElement` guards.
  $effect(() => {
    const node = el;
    const next = value;
    if (!node) return;
    if (!editMode) return;
    if (typeof document !== "undefined" && document.activeElement === node)
      return;
    if (node.textContent !== next) node.textContent = next;
  });

  function onInput(e: Event) {
    const text = (e.currentTarget as HTMLElement).textContent ?? "";
    // Single-line field: trim, matching T.tsx's non-multiline stage().
    store.addEdit(path, text.trim());
  }

  function onKeydown(e: KeyboardEvent) {
    // Single-line: Enter commits + blurs instead of inserting a newline.
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
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
    class={["cmsbar-editable", className]}
    contenteditable="true"
    role="textbox"
    tabindex="0"
    oninput={onInput}
    onkeydown={onKeydown}
  >{value}</svelte:element>
{:else}
  <svelte:element
    this={as}
    data-cms-path={authenticated ? path : undefined}
    data-cms-shared={authenticated && shared ? "true" : undefined}
    class={className}
  >{value}</svelte:element>
{/if}
