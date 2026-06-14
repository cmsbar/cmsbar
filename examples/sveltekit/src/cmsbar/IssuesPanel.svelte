<script lang="ts">
  // Per-page issue panel, ported from template/components/cmsbar/IssuesPanel.tsx
  // to Svelte 5. Two tabs:
  //   - New issue: title + WYSIWYG details + priority + scope, plus "pin an
  //     element" mode that lets the editor click a [data-cms-path] element on
  //     the page to attach it to the report; POSTs /issues.
  //   - Issues: filterable/sortable list of cms-bar issues; PATCH /issues/:n to
  //     change status.
  // Issue data + reload + addIssue are owned by the bar's IssuesButton and
  // passed in as props (so the badge count and the panel share one list).
  // Rendered through the same Svelte portal as the other modals.

  import { getCmsContext } from "@/cmsbar/content.svelte";
  import { cmsFetch } from "@/lib/cmsbar/cmsFetch";
  import {
    PRIORITIES,
    visibleOnPage,
    type IssuePriority,
    type IssueScope,
    type IssueStatus,
    type ParsedIssue,
  } from "@/lib/cmsbar/backend/issues";
  import { mdToHtml, htmlToMd, type MdFormat } from "@/cmsbar/issuesMarkdown";

  type Pinned = { path: string; shared: boolean };

  type Props = {
    onClose: () => void;
    pathname: string;
    issues: ParsedIssue[];
    loading: boolean;
    refreshing?: boolean;
    error: string | null;
    reload: () => Promise<void>;
    addIssue: (issue: ParsedIssue) => void;
  };

  let {
    onClose,
    pathname,
    issues,
    loading,
    refreshing = false,
    error,
    reload,
    addIssue,
  }: Props = $props();

  const store = getCmsContext();
  const cms = $derived(store.cms);

  const PRIO_DOT: Record<IssuePriority, string> = {
    high: "🔴",
    medium: "🟡",
    low: "🟢",
  };
  const PRIO_RANK: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };
  const STATUS_BADGE: Record<IssueStatus, { label: string; cls: string }> = {
    open: { label: "● open", cls: "open" },
    "in-progress": { label: "◑ in progress", cls: "inprog" },
    closed: { label: "✓ closed", cls: "closed" },
  };

  let tab = $state<"new" | "list">("new");

  // ── Pin mode ──────────────────────────────────────────────────────────
  let pinning = $state(false);
  let pinned = $state<Pinned | null>(null);

  $effect(() => {
    document.body.classList.toggle("cms-pinning", pinning);
    return () => document.body.classList.remove("cms-pinning");
  });

  $effect(() => {
    if (!pinning) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("[data-cms-path]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      pinned = {
        path: el.getAttribute("data-cms-path") || "",
        shared: el.getAttribute("data-cms-shared") === "true",
      };
      pinning = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinning = false;
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  });

  // ── New-issue form ────────────────────────────────────────────────────
  let title = $state("");
  let details = $state("");
  let priority = $state<IssuePriority>("medium");
  let everyPage = $state(false);
  let editorIssue = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  const inDraftMode = $derived(!!cms.draft);
  // Scope: "editor" overrides all; a pinned shared element forces "shared";
  // otherwise the "affects every page" choice decides between page and shared.
  const scope = $derived<IssueScope>(
    editorIssue ? "editor" : pinned?.shared || everyPage ? "shared" : "page",
  );
  const contentDisabled = $derived(editorIssue);

  async function submit() {
    if (!title.trim()) return;
    submitting = true;
    submitError = null;
    try {
      const res = await cmsFetch("/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          details: details.trim(),
          priority,
          scope,
          page: pathname,
          pageUrl: window.location.href,
          elementPath: pinned?.path,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { issue: ParsedIssue };
      addIssue(data.issue);
      title = "";
      details = "";
      pinned = null;
      everyPage = false;
      editorIssue = false;
      priority = "medium";
      await reload();
      tab = "list";
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }

  async function changeStatus(n: number, status: IssueStatus) {
    try {
      const res = await cmsFetch(`/issues/${n}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch {
      /* surfaced via the list error on next reload */
    }
  }

  // ── Issue-list view state ─────────────────────────────────────────────
  let scopeFilter = $state<"page" | "all">("page");
  let statuses = $state<Set<IssueStatus>>(new Set(["open", "in-progress"]));
  let sort = $state<"priority" | "recent">("priority");
  let expanded = $state<number | null>(null);

  function toggleStatus(s: IssueStatus) {
    const next = new Set(statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    statuses = next;
  }

  const visible = $derived.by(() => {
    let list = issues.filter((i) => statuses.has(i.status));
    if (scopeFilter === "page")
      list = list.filter((i) => visibleOnPage(i, pathname));
    if (sort === "priority") {
      list = [...list].sort(
        (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority],
      );
    }
    return list;
  });

  function scopeTag(i: ParsedIssue): string {
    return i.scope === "shared"
      ? "🔗 shared · all pages"
      : i.scope === "toolbar"
        ? "🧰 toolbar · all pages"
        : i.scope === "editor"
          ? "🛠 CMS editor"
          : `📄 ${i.page ?? pathname}`;
  }

  // ── WYSIWYG details editor (contenteditable) ──────────────────────────
  const TOOLBAR_BTNS: {
    type: MdFormat;
    label: string;
    title: string;
    mono?: boolean;
  }[] = [
    { type: "bold", label: "B", title: "Bold", mono: true },
    { type: "italic", label: "I", title: "Italic", mono: true },
    { type: "heading", label: "H", title: "Heading" },
    { type: "quote", label: "❝", title: "Blockquote" },
    { type: "link", label: "🔗", title: "Link" },
    { type: "ul", label: "•-", title: "Unordered list" },
    { type: "ol", label: "1.", title: "Ordered list", mono: true },
    { type: "checklist", label: "☐", title: "Checklist" },
  ];
  const DIVIDER_BEFORE: Partial<Record<MdFormat, true>> = {
    heading: true,
    link: true,
    ul: true,
  };

  let editorEl = $state<HTMLDivElement | null>(null);
  let lastMd = "";
  let skipSync = false;
  let isEmpty = $state(true);
  let active = $state<Record<MdFormat, boolean>>({
    bold: false,
    italic: false,
    heading: false,
    quote: false,
    link: false,
    ul: false,
    ol: false,
    checklist: false,
  });

  // Link-insertion bar
  let showLinkBar = $state(false);
  let linkUrl = $state("");
  let linkInputEl = $state<HTMLInputElement | null>(null);
  let savedRange: Range | null = null;

  function closestEl(node: Node | null | undefined): Element | null {
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element);
  }
  function closestLi(): HTMLLIElement | null {
    return (
      (closestEl(window.getSelection()?.anchorNode)?.closest(
        "li",
      ) as HTMLLIElement) ?? null
    );
  }
  function placeCaret(node: Node, offset: number) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function updateActive() {
    const el = editorEl;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    if (!el.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    const block = String(document.queryCommandValue("formatBlock") || "")
      .toLowerCase()
      .replace(/[<>]/g, "");
    const li = closestLi();
    const isTask = !!li?.classList.contains("task-item");
    const inUl = document.queryCommandState("insertUnorderedList");
    active = {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      heading: /^h[1-6]$/.test(block),
      quote: block === "blockquote",
      ol: document.queryCommandState("insertOrderedList"),
      ul: inUl && !isTask,
      checklist: isTask,
      link: !!closestEl(sel.anchorNode)?.closest("a"),
    };
  }

  // Init + selection sync. Runs once the editor node mounts.
  $effect(() => {
    const el = editorEl;
    if (!el) return;
    el.innerHTML = mdToHtml(details) || "<p><br></p>";
    document.execCommand("defaultParagraphSeparator", false, "p");
    lastMd = details;
    isEmpty = !details.trim();

    const handler = () => updateActive();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  });

  // Sync external value changes (form reset after submit).
  $effect(() => {
    const v = details;
    if (skipSync) return;
    if (v === lastMd) return;
    const el = editorEl;
    if (!el) return;
    el.innerHTML = mdToHtml(v) || "<p><br></p>";
    lastMd = v;
    isEmpty = !v.trim();
  });

  function fireChange() {
    const el = editorEl;
    if (!el) return;
    const md = htmlToMd(el.innerHTML);
    lastMd = md;
    skipSync = true;
    isEmpty = !md.trim();
    details = md;
    updateActive();
    requestAnimationFrame(() => {
      skipSync = false;
    });
  }

  function exec(cmd: string, arg?: string) {
    const el = editorEl;
    if (!el) return;
    el.focus();
    document.execCommand(cmd, false, arg);
    fireChange();
  }

  function handleLinkBtn() {
    const sel = window.getSelection();
    if (sel?.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
    linkUrl = "https://";
    showLinkBar = true;
    requestAnimationFrame(() => linkInputEl?.focus());
  }

  function commitLink() {
    const div = editorEl;
    if (!div) {
      showLinkBar = false;
      return;
    }
    const url = linkUrl.trim();
    if (!url || url === "https://") {
      showLinkBar = false;
      div.focus();
      return;
    }
    div.focus();
    const sel = window.getSelection();
    if (savedRange) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange);
    }
    document.execCommand("createLink", false, url);
    showLinkBar = false;
    fireChange();
  }

  function applyFormat(type: MdFormat) {
    switch (type) {
      case "bold":
        exec("bold");
        break;
      case "italic":
        exec("italic");
        break;
      case "heading":
        exec("formatBlock", active.heading ? "p" : "h2");
        break;
      case "quote":
        exec("formatBlock", active.quote ? "p" : "blockquote");
        break;
      case "ul":
        exec("insertUnorderedList");
        break;
      case "ol":
        exec("insertOrderedList");
        break;
      case "link":
        handleLinkBtn();
        break;
      case "checklist": {
        const li = closestLi();
        if (li?.classList.contains("task-item")) {
          li.classList.remove("task-item");
          delete li.dataset.task;
          delete li.dataset.checked;
        } else {
          exec("insertUnorderedList");
          const newLi = closestLi();
          if (newLi) {
            newLi.classList.add("task-item");
            newLi.dataset.task = "true";
            newLi.dataset.checked = "false";
          }
        }
        fireChange();
        break;
      }
    }
  }

  function onEditorKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      const bq = closestEl(sel?.anchorNode)?.closest(
        "blockquote",
      ) as HTMLElement | null;
      if (bq && range?.collapsed) {
        e.preventDefault();
        if ((bq.textContent ?? "").trim() === "") {
          const p = document.createElement("p");
          p.appendChild(document.createElement("br"));
          bq.replaceWith(p);
          placeCaret(p, 0);
        } else {
          const next = document.createElement("blockquote");
          next.appendChild(document.createElement("br"));
          bq.after(next);
          placeCaret(next, 0);
        }
        fireChange();
        return;
      }
      const li = closestLi();
      if (li?.classList.contains("task-item")) {
        setTimeout(() => {
          const newLi = closestLi();
          if (newLi && newLi !== li) {
            newLi.classList.add("task-item");
            newLi.dataset.task = "true";
            newLi.dataset.checked = "false";
            fireChange();
          }
        }, 0);
      }
    }
    if (e.key === "Escape" && showLinkBar) {
      showLinkBar = false;
      editorEl?.focus();
    }
  }

  function onEditorClick(e: MouseEvent) {
    const li = (e.target as HTMLElement).closest?.(
      "li.task-item",
    ) as HTMLElement | null;
    if (!li) return;
    const rect = li.getBoundingClientRect();
    if (e.clientX - rect.left <= 22) {
      li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
      fireChange();
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

<div use:portal class="cmsbar-ip-portal" data-cms-ui>
  {#if pinning}
    <div class="cmsbar-ip-pinhint">
      🎯 Click a blue-outlined element to pin it.
      <button type="button" onclick={() => (pinning = false)}>cancel</button>
    </div>
  {/if}

  <div
    class="cmsbar-ip-overlay"
    class:hidden={pinning}
    role="presentation"
    onclick={onClose}
  >
    <div
      class="cmsbar-ip-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Issues"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape" && !showLinkBar) onClose();
      }}
    >
      <div class="cmsbar-ip-head">
        <div class="cmsbar-ip-tabs">
          <button
            type="button"
            class="cmsbar-ip-tab"
            class:active={tab === "new"}
            onclick={() => (tab = "new")}>＋ New issue</button
          >
          <button
            type="button"
            class="cmsbar-ip-tab"
            class:active={tab === "list"}
            onclick={() => (tab = "list")}
          >
            Issues <span class="cmsbar-ip-dim">({issues.length})</span>
          </button>
        </div>
        <button
          type="button"
          class="cmsbar-ip-x"
          aria-label="Close"
          onclick={onClose}>&#10005;</button
        >
      </div>

      {#if tab === "new"}
        <!-- ── New issue ──────────────────────────────────────────────── -->
        <div class="cmsbar-ip-form">
          <label
            class="cmsbar-ip-editorchk"
            class:on={editorIssue}
            class:draftmode={inDraftMode}
          >
            <input
              type="checkbox"
              checked={editorIssue}
              onchange={(e) =>
                (editorIssue = (e.currentTarget as HTMLInputElement).checked)}
            />
            <span>
              🛠 About the CMS editor / toolbar
              {#if inDraftMode && !editorIssue}
                <span class="cmsbar-ip-editing">← you're editing</span>
              {/if}
            </span>
          </label>

          <div class="cmsbar-ip-context" class:dim={contentDisabled}>
            <div class="cmsbar-ip-context-label">📍 Context</div>
            <div class="cmsbar-ip-context-row">
              <span class="cmsbar-ip-muted">Page</span>
              <span class="cmsbar-ip-strong">{pathname}</span>
            </div>
            <div class="cmsbar-ip-context-row gap">
              <span class="cmsbar-ip-muted">Element</span>
              <span class="cmsbar-ip-mono">
                {pinned ? pinned.path : "- none pinned -"}
              </span>
            </div>
            {#if pinned}
              <div class="cmsbar-ip-pinned">
                <span class="cmsbar-ip-pintag" class:shared={pinned.shared}>
                  {pinned.shared
                    ? "🔗 shared - shows on every page"
                    : "📄 this page only"}
                </span>
              </div>
            {/if}
            <div class="cmsbar-ip-context-actions">
              <button
                type="button"
                class="cmsbar-ip-link"
                disabled={contentDisabled}
                onclick={() => (pinning = true)}
              >
                🎯 {pinned ? "Pin a different element" : "Pin an element"}
              </button>
              {#if pinned}
                <button
                  type="button"
                  class="cmsbar-ip-link gray"
                  onclick={() => (pinned = null)}>clear</button
                >
              {/if}
            </div>
          </div>

          <label class="cmsbar-ip-field">
            <span class="cmsbar-ip-fieldlabel">Title</span>
            <input
              class="cmsbar-ip-input"
              placeholder="Short summary of the problem"
              value={title}
              oninput={(e) =>
                (title = (e.currentTarget as HTMLInputElement).value)}
            />
          </label>

          <div class="cmsbar-ip-field">
            <span class="cmsbar-ip-fieldlabel">Details</span>
            <!-- WYSIWYG details editor -->
            <div class="cmsbar-ip-editor">
              <div class="cmsbar-ip-toolbar" data-cms-toolbar>
                {#if showLinkBar}
                  <div class="cmsbar-ip-linkbar">
                    <span class="cmsbar-ip-linkicon">🔗</span>
                    <input
                      bind:this={linkInputEl}
                      type="url"
                      class="cmsbar-ip-linkinput"
                      placeholder="https://"
                      bind:value={linkUrl}
                      onkeydown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitLink();
                        }
                        if (e.key === "Escape") {
                          showLinkBar = false;
                          editorEl?.focus();
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="cmsbar-ip-linkgo"
                      onmousedown={(e) => {
                        e.preventDefault();
                        commitLink();
                      }}>Insert</button
                    >
                    <button
                      type="button"
                      class="cmsbar-ip-linkx"
                      onmousedown={(e) => {
                        e.preventDefault();
                        showLinkBar = false;
                        editorEl?.focus();
                      }}>&#10005;</button
                    >
                  </div>
                {:else}
                  {#each TOOLBAR_BTNS as btn (btn.type)}
                    {#if DIVIDER_BEFORE[btn.type]}
                      <span class="cmsbar-ip-tbdiv"></span>
                    {/if}
                    <button
                      type="button"
                      class="cmsbar-ip-tbbtn"
                      class:mono={btn.mono}
                      class:active={active[btn.type]}
                      title={btn.title}
                      aria-pressed={active[btn.type]}
                      onmousedown={(e) => {
                        e.preventDefault();
                        applyFormat(btn.type);
                      }}>{btn.label}</button
                    >
                  {/each}
                {/if}
              </div>
              <div class="cmsbar-ip-editarea">
                {#if isEmpty}
                  <p class="cmsbar-ip-placeholder">
                    What's wrong, and what did you expect?
                  </p>
                {/if}
                <div
                  bind:this={editorEl}
                  class="cmsbar-ip-contenteditable cmsbar-prose"
                  contenteditable="true"
                  role="textbox"
                  tabindex="0"
                  aria-multiline="true"
                  aria-label="Issue details"
                  oninput={fireChange}
                  onkeydown={onEditorKeyDown}
                  onclick={onEditorClick}
                  onmouseup={updateActive}
                  onfocus={updateActive}
                ></div>
              </div>
            </div>
          </div>

          <div class="cmsbar-ip-field">
            <span class="cmsbar-ip-fieldlabel">Priority</span>
            <div class="cmsbar-ip-prio">
              {#each PRIORITIES as p (p)}
                <button
                  type="button"
                  class="cmsbar-ip-priobtn"
                  class:active={priority === p}
                  onclick={() => (priority = p)}>{PRIO_DOT[p]} {p}</button
                >
              {/each}
            </div>
          </div>

          <label
            class="cmsbar-ip-everypage"
            class:dim={contentDisabled || pinned?.shared}
          >
            <input
              type="checkbox"
              disabled={contentDisabled || pinned?.shared}
              checked={scope === "shared"}
              onchange={(e) =>
                (everyPage = (e.currentTarget as HTMLInputElement).checked)}
            />
            Affects every page (shared / toolbar)
          </label>

          {#if submitError}
            <div class="cmsbar-ip-submiterr">{submitError}</div>
          {/if}

          <div class="cmsbar-ip-formactions">
            <button type="button" class="cmsbar-ip-cancel" onclick={onClose}
              >Cancel</button
            >
            <button
              type="button"
              class="cmsbar-ip-submit"
              disabled={submitting || !title.trim()}
              onclick={submit}
            >
              {submitting ? "Creating…" : "Create issue →"}
            </button>
          </div>

          <p class="cmsbar-ip-formnote">
            Creates a GitHub issue labelled <code>cms-bar</code> + priority +
            scope. Page issues get <code>cms-page:{pathname}</code>;
            shared/toolbar issues get <code>cms-scope:shared</code> and surface
            on every page.
          </p>
        </div>
      {:else}
        <!-- ── Issue list ─────────────────────────────────────────────── -->
        <div class="cmsbar-ip-list">
          <div class="cmsbar-ip-filters">
            <div class="cmsbar-ip-filterrow">
              <span class="cmsbar-ip-muted">Show</span>
              <div class="cmsbar-ip-segment">
                {#each ["page", "all"] as const as s (s)}
                  <button
                    type="button"
                    class="cmsbar-ip-segbtn"
                    class:active={scopeFilter === s}
                    onclick={() => (scopeFilter = s)}
                    >{s === "page" ? "This page" : "All"}</button
                  >
                {/each}
              </div>
              <span class="cmsbar-ip-muted push">Sort</span>
              <select
                class="cmsbar-ip-select"
                value={sort}
                onchange={(e) =>
                  (sort = (e.currentTarget as HTMLSelectElement).value as
                    | "priority"
                    | "recent")}
              >
                <option value="priority">Priority</option>
                <option value="recent">Most recent</option>
              </select>
            </div>
            <div class="cmsbar-ip-statusrow">
              {#each ["open", "in-progress", "closed"] as const as s (s)}
                <button
                  type="button"
                  class="cmsbar-ip-statusbtn"
                  class:active={statuses.has(s)}
                  onclick={() => toggleStatus(s)}>{STATUS_BADGE[s].label}</button
                >
              {/each}
            </div>
          </div>

          <div class="cmsbar-ip-rows">
            {#if refreshing && !loading}
              <p class="cmsbar-ip-refreshing">Refreshing…</p>
            {/if}
            {#if loading}
              <p class="cmsbar-ip-emptymsg">Loading…</p>
            {:else if error}
              <p class="cmsbar-ip-errmsg">Couldn't load issues: {error}</p>
            {:else if visible.length === 0}
              <p class="cmsbar-ip-emptymsg">No issues match these filters.</p>
            {:else}
              {#each visible as i (i.number)}
                {@const isOpen = expanded === i.number}
                <div class="cmsbar-ip-row">
                  <div
                    class="cmsbar-ip-rowhead"
                    role="button"
                    tabindex="0"
                    onclick={() => (expanded = isOpen ? null : i.number)}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        expanded = isOpen ? null : i.number;
                      }
                    }}
                  >
                    <span>{PRIO_DOT[i.priority]}</span>
                    <div class="cmsbar-ip-rowmain">
                      <div class="cmsbar-ip-rowtitle">
                        <span class="cmsbar-ip-rowname">{i.title}</span>
                        <span class="cmsbar-ip-rownum">#{i.number}</span>
                      </div>
                      <div class="cmsbar-ip-rowmeta">
                        {#if i.elementPath}<span class="cmsbar-ip-mono"
                            >{i.elementPath} · </span
                          >{/if}{scopeTag(i)}
                      </div>
                    </div>
                    <span class="cmsbar-ip-status {STATUS_BADGE[i.status].cls}">
                      {STATUS_BADGE[i.status].label}
                    </span>
                  </div>
                  {#if isOpen}
                    {@const desc = i.body.split("---")[0].trim()}
                    <div class="cmsbar-ip-rowbody">
                      {#if desc}
                        <p class="cmsbar-ip-rowdesc">{desc}</p>
                      {:else}
                        <p class="cmsbar-ip-rownodesc">no description</p>
                      {/if}
                      <div class="cmsbar-ip-rowactions">
                        {#if i.status !== "in-progress" && i.status !== "closed"}
                          <button
                            type="button"
                            class="cmsbar-ip-rowbtn"
                            onclick={() => changeStatus(i.number, "in-progress")}
                            >◑ Mark in progress</button
                          >
                        {/if}
                        {#if i.status !== "closed"}
                          <button
                            type="button"
                            class="cmsbar-ip-rowbtn"
                            onclick={() => changeStatus(i.number, "closed")}
                            >✓ Close</button
                          >
                        {:else}
                          <button
                            type="button"
                            class="cmsbar-ip-rowbtn"
                            onclick={() => changeStatus(i.number, "open")}
                            >↺ Reopen</button
                          >
                        {/if}
                        <a
                          href={i.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          class="cmsbar-ip-rowbtn">Open in GitHub ↗</a
                        >
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          <div class="cmsbar-ip-listfoot">
            {scopeFilter === "page"
              ? `${visible.length} shown · ${pathname} + site-wide`
              : `${visible.length} shown · all pages`}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .cmsbar-ip-portal {
    font-family:
      ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #0f172a;
  }
  .cmsbar-ip-pinhint {
    position: fixed;
    bottom: 6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 210;
    border-radius: 9999px;
    background: #2563eb;
    color: #fff;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  }
  .cmsbar-ip-pinhint button {
    margin-left: 0.5rem;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
  }
  .cmsbar-ip-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    justify-content: flex-end;
    background: rgba(0, 0, 0, 0.4);
  }
  .cmsbar-ip-overlay.hidden {
    display: none;
  }
  .cmsbar-ip-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    max-width: 28rem;
    background: #fff;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  }
  .cmsbar-ip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #e2e8f0;
    padding: 0.75rem 1.25rem;
  }
  .cmsbar-ip-tabs {
    display: flex;
    gap: 0.25rem;
    border-radius: 0.5rem;
    background: #f1f5f9;
    padding: 0.25rem;
    font-size: 0.875rem;
  }
  .cmsbar-ip-tab {
    border: 0;
    cursor: pointer;
    border-radius: 0.375rem;
    padding: 0.25rem 0.75rem;
    font-weight: 500;
    color: #64748b;
    background: transparent;
    font: inherit;
  }
  .cmsbar-ip-tab.active {
    background: #fff;
    color: #0f172a;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  .cmsbar-ip-dim {
    color: #94a3b8;
  }
  .cmsbar-ip-x {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 1.125rem;
    color: #94a3b8;
  }
  .cmsbar-ip-x:hover {
    color: #334155;
  }

  /* New-issue form */
  .cmsbar-ip-form {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cmsbar-ip-editorchk {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: #64748b;
    cursor: pointer;
  }
  .cmsbar-ip-editorchk.draftmode {
    border-color: #ddd6fe;
    background: rgba(245, 243, 255, 0.5);
  }
  .cmsbar-ip-editorchk.on {
    border-color: #a78bfa;
    background: #f5f3ff;
    color: #5b21b6;
  }
  .cmsbar-ip-editing {
    margin-left: 0.375rem;
    font-size: 10px;
    font-weight: 500;
    color: #8b5cf6;
  }
  .cmsbar-ip-context {
    border-radius: 0.5rem;
    background: #f8fafc;
    padding: 0.75rem;
    font-size: 0.875rem;
    box-shadow: inset 0 0 0 1px #e2e8f0;
  }
  .cmsbar-ip-context.dim {
    opacity: 0.4;
  }
  .cmsbar-ip-context-label {
    margin-bottom: 0.375rem;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
  }
  .cmsbar-ip-context-row {
    display: flex;
    justify-content: space-between;
  }
  .cmsbar-ip-context-row.gap {
    margin-top: 0.25rem;
    gap: 0.75rem;
  }
  .cmsbar-ip-muted {
    color: #64748b;
  }
  .cmsbar-ip-strong {
    font-weight: 500;
  }
  .cmsbar-ip-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    color: #334155;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmsbar-ip-pinned {
    margin-top: 0.5rem;
  }
  .cmsbar-ip-pintag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 0.25rem;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--cmsbar-accent-soft);
    color: var(--cmsbar-accent);
  }
  .cmsbar-ip-pintag.shared {
    background: #fef3c7;
    color: #92400e;
  }
  .cmsbar-ip-context-actions {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.75rem;
  }
  .cmsbar-ip-link {
    border: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    color: #2563eb;
  }
  .cmsbar-ip-link:hover {
    text-decoration: underline;
  }
  .cmsbar-ip-link:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  .cmsbar-ip-link.gray {
    color: #64748b;
  }
  .cmsbar-ip-field {
    display: block;
    font-size: 0.875rem;
  }
  .cmsbar-ip-fieldlabel {
    font-weight: 500;
    color: #475569;
  }
  .cmsbar-ip-input {
    margin-top: 0.25rem;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
    font-family: inherit;
  }
  .cmsbar-ip-input:focus {
    box-shadow: 0 0 0 2px var(--cmsbar-accent);
  }
  .cmsbar-ip-prio {
    margin-top: 0.375rem;
    display: flex;
    gap: 0.5rem;
  }
  .cmsbar-ip-priobtn {
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    text-transform: capitalize;
    background: #fff;
    cursor: pointer;
    font-family: inherit;
  }
  .cmsbar-ip-priobtn.active {
    border-color: var(--cmsbar-accent);
    background: var(--cmsbar-accent-soft);
    box-shadow: 0 0 0 2px var(--cmsbar-accent);
  }
  .cmsbar-ip-everypage {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #475569;
  }
  .cmsbar-ip-everypage.dim {
    color: #94a3b8;
  }
  .cmsbar-ip-submiterr {
    border-radius: 0.375rem;
    background: #fef2f2;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: #b91c1c;
  }
  .cmsbar-ip-formactions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }
  .cmsbar-ip-cancel {
    border: 0;
    background: transparent;
    cursor: pointer;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: #64748b;
    font: inherit;
  }
  .cmsbar-ip-cancel:hover {
    color: #1e293b;
  }
  .cmsbar-ip-submit {
    border: 0;
    cursor: pointer;
    border-radius: 0.375rem;
    background: var(--cmsbar-accent);
    color: #fff;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
  }
  .cmsbar-ip-submit:hover:not(:disabled) {
    background: var(--cmsbar-accent-strong);
  }
  .cmsbar-ip-submit:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .cmsbar-ip-formnote {
    border-top: 1px solid #e2e8f0;
    padding-top: 0.75rem;
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: #94a3b8;
  }
  .cmsbar-ip-formnote code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* WYSIWYG editor */
  .cmsbar-ip-editor {
    margin-top: 0.25rem;
  }
  .cmsbar-ip-toolbar {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    border: 1px solid #cbd5e1;
    border-bottom: 0;
    border-radius: 0.375rem 0.375rem 0 0;
    background: #f8fafc;
    padding: 0.25rem 0.375rem;
    min-height: 2rem;
  }
  .cmsbar-ip-tbdiv {
    margin: 0 0.25rem;
    height: 0.875rem;
    width: 1px;
    flex-shrink: 0;
    background: #cbd5e1;
  }
  .cmsbar-ip-tbbtn {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.75rem;
    color: #475569;
    background: transparent;
    font-family: inherit;
  }
  .cmsbar-ip-tbbtn:hover {
    background: #e2e8f0;
  }
  .cmsbar-ip-tbbtn.mono {
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .cmsbar-ip-tbbtn.active {
    background: var(--cmsbar-accent);
    color: #fff;
  }
  .cmsbar-ip-linkbar {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 0.375rem;
  }
  .cmsbar-ip-linkicon {
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .cmsbar-ip-linkinput {
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: 0.25rem;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    outline: none;
    font-family: inherit;
  }
  .cmsbar-ip-linkinput:focus {
    box-shadow: 0 0 0 1px #3b82f6;
  }
  .cmsbar-ip-linkgo {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    background: #2563eb;
    color: #fff;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
  }
  .cmsbar-ip-linkgo:hover {
    background: #1d4ed8;
  }
  .cmsbar-ip-linkx {
    border: 0;
    background: transparent;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.125rem 0.25rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .cmsbar-ip-linkx:hover {
    background: #e2e8f0;
  }
  .cmsbar-ip-editarea {
    position: relative;
  }
  .cmsbar-ip-placeholder {
    pointer-events: none;
    position: absolute;
    left: 0.75rem;
    top: 0.5rem;
    margin: 0;
    font-size: 0.875rem;
    color: #94a3b8;
    user-select: none;
  }
  .cmsbar-ip-contenteditable {
    min-height: 8rem;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0 0 0.375rem 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
  }
  .cmsbar-ip-contenteditable:focus {
    box-shadow: 0 0 0 2px var(--cmsbar-accent);
  }

  /* Issue list */
  .cmsbar-ip-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }
  .cmsbar-ip-filters {
    border-bottom: 1px solid #e2e8f0;
    padding: 0.75rem 1.25rem;
    font-size: 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cmsbar-ip-filterrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cmsbar-ip-segment {
    display: flex;
    border-radius: 0.375rem;
    background: #f1f5f9;
    padding: 0.125rem;
  }
  .cmsbar-ip-segbtn {
    border: 0;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: #64748b;
    background: transparent;
    font-family: inherit;
  }
  .cmsbar-ip-segbtn.active {
    background: #fff;
    color: #0f172a;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  .push {
    margin-left: auto;
  }
  .cmsbar-ip-select {
    border: 1px solid #cbd5e1;
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-family: inherit;
  }
  .cmsbar-ip-statusrow {
    display: flex;
    gap: 0.375rem;
  }
  .cmsbar-ip-statusbtn {
    border: 1px solid #cbd5e1;
    cursor: pointer;
    border-radius: 9999px;
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    color: #64748b;
    background: #fff;
    font-family: inherit;
  }
  .cmsbar-ip-statusbtn.active {
    border-color: #0f172a;
    background: #0f172a;
    color: #fff;
  }
  .cmsbar-ip-rows {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
  }
  .cmsbar-ip-rows > * + * {
    border-top: 1px solid #e2e8f0;
  }
  .cmsbar-ip-refreshing {
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    padding: 0.375rem 1.25rem;
    text-align: center;
    font-size: 0.75rem;
    color: #94a3b8;
    margin: 0;
  }
  .cmsbar-ip-emptymsg {
    padding: 2rem;
    text-align: center;
    font-size: 0.875rem;
    color: #94a3b8;
    margin: 0;
  }
  .cmsbar-ip-errmsg {
    padding: 1.25rem;
    font-size: 0.875rem;
    color: #dc2626;
    margin: 0;
  }
  .cmsbar-ip-row {
    padding: 0.75rem 1.25rem;
  }
  .cmsbar-ip-row:hover {
    background: #f8fafc;
  }
  .cmsbar-ip-rowhead {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }
  .cmsbar-ip-rowmain {
    min-width: 0;
    flex: 1;
  }
  .cmsbar-ip-rowtitle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cmsbar-ip-rowname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: #1e293b;
  }
  .cmsbar-ip-rownum {
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .cmsbar-ip-rowmeta {
    margin-top: 0.125rem;
    font-size: 11px;
    color: #64748b;
  }
  .cmsbar-ip-status {
    white-space: nowrap;
    font-size: 0.75rem;
  }
  .cmsbar-ip-status.open {
    color: #059669;
  }
  .cmsbar-ip-status.inprog {
    color: #2563eb;
  }
  .cmsbar-ip-status.closed {
    color: #94a3b8;
  }
  .cmsbar-ip-rowbody {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #475569;
  }
  .cmsbar-ip-rowdesc {
    margin: 0 0 0.5rem;
    white-space: pre-wrap;
  }
  .cmsbar-ip-rownodesc {
    margin: 0 0 0.5rem;
    font-style: italic;
    color: #94a3b8;
  }
  .cmsbar-ip-rowactions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .cmsbar-ip-rowbtn {
    border: 1px solid #cbd5e1;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    background: #fff;
    color: #334155;
    text-decoration: none;
    font-family: inherit;
  }
  .cmsbar-ip-rowbtn:hover {
    background: #f1f5f9;
  }
  .cmsbar-ip-listfoot {
    border-top: 1px solid #e2e8f0;
    padding: 0.625rem 1.25rem;
    font-size: 0.75rem;
    color: #64748b;
  }
</style>
