"use client";

import {
  useEffect,
  useRef,
  useState,
  createElement,
  type RefObject,
} from "react";
import { useCms } from "./ContentProvider";
import { Portal } from "./Portal";
import { isSharedPath } from "./shared-paths";
import { cn } from "@/lib/cmsbar/utils";
import { cmsConfig } from "@/cms.config";

type Props = {
  path: string;
  as?: string;
  className?: string;
  fallback?: string;
} & Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "onBlur" | "dangerouslySetInnerHTML"
>;

// Optional decorative class the toolbar can toggle on inline spans,
// configured per-project (empty string disables the button entirely).
const HAND_CLASS = cmsConfig.richText?.decorClass ?? "";

function applyClassToSelection(root: HTMLElement, className: string) {
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

function findAncestorWithClass(
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

function findAncestorLink(root: HTMLElement): HTMLAnchorElement | null {
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

function unwrapElement(el: HTMLElement) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

const ALLOWED_TAGS = new Set([
  "B",
  "I",
  "U",
  "STRONG",
  "EM",
  "BR",
  "SPAN",
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "UL",
  "OL",
  "LI",
  "A",
]);
export function sanitizeRichText(html: string): string {
  return sanitize(html);
}
function sanitize(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 1) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          while (el.firstChild) el.parentNode!.insertBefore(el.firstChild, el);
          el.remove();
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const keep =
            (el.tagName === "SPAN" && attr.name === "class") ||
            (el.tagName === "A" && attr.name === "href");
          if (!keep) el.removeAttribute(attr.name);
        }
        if (
          el.tagName === "SPAN" &&
          (!HAND_CLASS || el.getAttribute("class") !== HAND_CLASS)
        ) {
          while (el.firstChild) el.parentNode!.insertBefore(el.firstChild, el);
          el.remove();
          continue;
        }
        // Validate and normalise anchor href
        if (el.tagName === "A") {
          const href = el.getAttribute("href") ?? "";
          if (/^https?:/.test(href)) {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          } else if (!/^(mailto:|\/|#)/.test(href)) {
            // Strip dangerous protocols (javascript:, data:, etc.)
            el.removeAttribute("href");
          }
        }
        walk(el);
      } else if (child.nodeType !== 3 && child.nodeType !== 1) {
        child.parentNode?.removeChild(child);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function RichText({
  path,
  as = "span",
  className,
  fallback,
  ...rest
}: Props) {
  const { get, editMode, cms, addEdit } = useCms();
  const value = (get(path) as string | undefined) ?? fallback ?? "";
  const ref = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);

  const lastSeenRef = useRef<string>(value);

  useEffect(() => {
    if (!editMode) return;
    if (!ref.current) return;
    if (document.activeElement === ref.current) return;
    if (ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    lastSeenRef.current = value;
  }, [value, editMode]);

  useEffect(() => {
    if (!editMode) return;
    if (!ref.current) return;
    if (ref.current.innerHTML === value) return;
    if (document.activeElement === ref.current) return;
    ref.current.innerHTML = value;
    lastSeenRef.current = value;
  }, [editMode, value]);

  const stage = (nextHtml: string) => {
    const cleaned = sanitize(nextHtml);
    if (cleaned === lastSeenRef.current) return;
    lastSeenRef.current = cleaned;
    addEdit(path, cleaned);
  };

  if (!editMode) {
    return createElement(as, {
      className,
      ...rest,
      ...(cms.authenticated && {
        "data-cms-path": path,
        "data-cms-shared": isSharedPath(path) ? "true" : undefined,
      }),
      dangerouslySetInnerHTML: { __html: value },
    });
  }

  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const editProps: React.HTMLAttributes<HTMLElement> & {
    contentEditable?: boolean;
    suppressContentEditableWarning?: boolean;
    "data-cms-path"?: string;
    "data-cms-shared"?: string;
    ref?: React.Ref<HTMLElement>;
    dangerouslySetInnerHTML?: { __html: string };
  } = {
    ...rest,
    ref,
    contentEditable: true,
    suppressContentEditableWarning: true,
    "data-cms-path": path,
    "data-cms-shared": isSharedPath(path) ? "true" : undefined,
    title: isSharedPath(path)
      ? "Shared element - editing this changes it on every page that uses it"
      : undefined,
    className: cn(
      "outline-none transition-shadow rounded",
      isSharedPath(path)
        ? "ring-2 ring-[var(--cmsbar-shared)] bg-[var(--cmsbar-shared-soft)] hover:ring-[var(--cmsbar-shared-strong)] focus:ring-2 focus:ring-[var(--cmsbar-shared-strong)]"
        : "ring-1 ring-dashed ring-[var(--cmsbar-ring)] hover:ring-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent)]",
      "px-0.5",
      className,
    ),
    onClickCapture: swallow,
    onFocus: () => {
      setFocused(true);
      try {
        document.execCommand("defaultParagraphSeparator", false, "p");
      } catch {
        /* unsupported on some browsers - harmless */
      }
    },
    onBlur: (e) => {
      const html = (e.currentTarget as HTMLElement).innerHTML;
      stage(html);
      setTimeout(() => {
        if (document.activeElement?.closest("[data-cms-toolbar]")) return;
        setFocused(false);
      }, 200);
    },
  };

  return (
    <>
      {createElement(as, editProps)}
      {focused && (
        <Portal>
          <Toolbar editorRef={ref} />
        </Portal>
      )}
    </>
  );
}

export function RichTextToolbar({
  editorRef,
}: {
  editorRef: RefObject<HTMLElement | null>;
}) {
  return <Toolbar editorRef={editorRef} />;
}

function Toolbar({ editorRef }: { editorRef: RefObject<HTMLElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    hand: false,
    block: "p",
    ul: false,
    ol: false,
    linkHref: null as string | null, // null = cursor not inside a link
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  const isBlockRoot = (() => {
    const tag = editorRef.current?.tagName;
    return tag === "DIV" || tag === "ARTICLE" || tag === "SECTION";
  })();

  useEffect(() => {
    const updatePos = () => {
      const el = editorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    };
    const updateActive = () => {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      const rawBlock = String(document.queryCommandValue("formatBlock") || "")
        .toLowerCase()
        .replace(/[<>]/g, "");
      const block = ["h1", "h2", "h3", "h4", "p"].includes(rawBlock)
        ? rawBlock
        : "p";
      const anchor = findAncestorLink(root);
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        hand: !!findAncestorWithClass(root, HAND_CLASS),
        block,
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
        linkHref: anchor ? (anchor.getAttribute("href") ?? "") : null,
      });
    };
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
  }, [editorRef]);

  const exec = (cmd: string, value?: string) => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported */
    }
    document.execCommand(cmd, false, value);
  };

  const setBlock = (tag: "p" | "h2" | "h3" | "h4") =>
    exec("formatBlock", `<${tag}>`);

  const toggleHand = () => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;
    const ancestor = findAncestorWithClass(root, HAND_CLASS);
    if (ancestor === root) return;
    if (ancestor) {
      unwrapElement(ancestor);
    } else if (!collapsed) {
      applyClassToSelection(root, HAND_CLASS);
    }
    setActive((a) => ({ ...a, hand: !a.hand }));
  };

  const openLink = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    const currentHref = active.linkHref ?? "";
    setLinkHref(currentHref);
    setLinkOpen((prev) => {
      if (!prev) setTimeout(() => linkInputRef.current?.focus(), 50);
      return !prev;
    });
  };

  const applyLink = () => {
    const href = linkHref.trim();
    if (!href) return;
    const root = editorRef.current;
    if (!root) return;

    root.focus();
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    const existingAnchor = findAncestorLink(root);
    if (existingAnchor) {
      existingAnchor.setAttribute("href", href);
      if (href.startsWith("http")) {
        existingAnchor.setAttribute("target", "_blank");
        existingAnchor.setAttribute("rel", "noopener noreferrer");
      } else {
        existingAnchor.removeAttribute("target");
        existingAnchor.removeAttribute("rel");
      }
    } else if (savedRangeRef.current && !savedRangeRef.current.collapsed) {
      exec("createLink", href);
      const newAnchor = findAncestorLink(root);
      if (newAnchor && href.startsWith("http")) {
        newAnchor.setAttribute("target", "_blank");
        newAnchor.setAttribute("rel", "noopener noreferrer");
      }
    }

    setLinkOpen(false);
  };

  const removeLink = () => {
    exec("unlink");
    setLinkOpen(false);
  };

  if (!pos) return null;

  const btn = "px-2 py-1 text-xs font-medium rounded hover:bg-white/10";
  const activeCls =
    "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent)]";
  const top = Math.max(8, pos.y - 44);

  return (
    <div
      data-cms-toolbar
      style={{
        position: "fixed",
        left: pos.x,
        top,
        transform: "translateX(-50%)",
      }}
      className="z-[120] flex flex-col rounded-lg bg-slate-900/95 text-white shadow-lg backdrop-blur"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 px-1 py-1">
        <button
          type="button"
          className={cn(btn, "font-bold", active.bold && activeCls)}
          onClick={() => exec("bold")}
          title="Bold (Cmd/Ctrl+B)"
        >
          B
        </button>
        <button
          type="button"
          className={cn(btn, "italic", active.italic && activeCls)}
          onClick={() => exec("italic")}
          title="Italic (Cmd/Ctrl+I)"
        >
          I
        </button>
        <button
          type="button"
          className={cn(btn, "underline", active.underline && activeCls)}
          onClick={() => exec("underline")}
          title="Underline (Cmd/Ctrl+U)"
        >
          U
        </button>
        {HAND_CLASS && (
          <>
            <span className="mx-1 h-4 w-px bg-white/20" />
            <button
              type="button"
              className={cn(
                btn,
                HAND_CLASS,
                "text-base",
                active.hand && activeCls,
              )}
              onClick={toggleHand}
              title="Toggle hand-font on selection"
            >
              Hand
            </button>
          </>
        )}
        {isBlockRoot && (
          <>
            <span className="mx-1 h-4 w-px bg-white/20" />
            <button
              type="button"
              className={cn(btn, active.block === "p" && activeCls)}
              onClick={() => setBlock("p")}
              title="Paragraph"
            >
              P
            </button>
            <button
              type="button"
              className={cn(
                btn,
                "font-bold",
                active.block === "h2" && activeCls,
              )}
              onClick={() => setBlock("h2")}
              title="Heading 2"
            >
              H2
            </button>
            <button
              type="button"
              className={cn(
                btn,
                "font-bold",
                active.block === "h3" && activeCls,
              )}
              onClick={() => setBlock("h3")}
              title="Heading 3"
            >
              H3
            </button>
            <button
              type="button"
              className={cn(
                btn,
                "font-bold",
                active.block === "h4" && activeCls,
              )}
              onClick={() => setBlock("h4")}
              title="Heading 4"
            >
              H4
            </button>
            <span className="mx-1 h-4 w-px bg-white/20" />
            <button
              type="button"
              className={cn(btn, active.ul && activeCls)}
              onClick={() => exec("insertUnorderedList")}
              title="Bulleted list"
            >
              • List
            </button>
            <button
              type="button"
              className={cn(btn, active.ol && activeCls)}
              onClick={() => exec("insertOrderedList")}
              title="Numbered list"
            >
              1. List
            </button>
          </>
        )}
        <span className="mx-1 h-4 w-px bg-white/20" />
        <button
          type="button"
          className={cn(btn, "text-white/70")}
          onClick={() => exec("removeFormat")}
          title="Clear formatting"
        >
          Clear
        </button>
        <span className="mx-1 h-4 w-px bg-white/20" />
        <button
          type="button"
          className={cn(
            btn,
            (active.linkHref !== null || linkOpen) && activeCls,
          )}
          onClick={openLink}
          title={
            active.linkHref !== null ? "Edit link" : "Add link to selection"
          }
        >
          Link
        </button>
      </div>

      {linkOpen && (
        <div className="flex items-center gap-1 border-t border-white/20 px-2 py-1.5">
          <input
            ref={linkInputRef}
            type="url"
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="https://..."
            className="min-w-[220px] flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-[var(--cmsbar-accent)]"
          />
          <button
            type="button"
            className={cn(
              btn,
              "bg-[var(--cmsbar-accent)] text-white hover:bg-[var(--cmsbar-accent-strong)]",
            )}
            onClick={applyLink}
          >
            Apply
          </button>
          {active.linkHref !== null && (
            <button
              type="button"
              className={cn(btn, "text-red-400 hover:text-red-300")}
              onClick={removeLink}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
