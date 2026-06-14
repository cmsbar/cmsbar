// Rich-text sanitization + selection/range helpers, ported from the React
// template/components/cmsbar/RichText.tsx (and the already-correct
// examples/sveltekit/src/cmsbar/{richText.ts,RichText.svelte}).
//
// Lives in a plain .ts module (not a .vue component) for two reasons:
//   1. it can be unit-tested under jsdom without compiling an SFC, and
//   2. RichText.vue AND RichTextToolbar.vue both need the selection helpers -
//      keeping them here avoids an SFC<->SFC circular import (the Svelte version
//      exported them from RichText.svelte and had Toolbar import back from it,
//      which Vue's SFC module graph does not handle as gracefully).
//
// Everything here uses the DOM (document/window/Selection/Range) exactly like the
// React original, so it must only run in the browser (the editor is client-only)
// or under jsdom in tests.

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

/**
 * Sanitize editor-produced HTML to the rich-text allow-list.
 *
 * @param html  raw contenteditable innerHTML
 * @param handClass  the configured decorative class (cmsConfig.richText.decorClass);
 *   empty string disables the decorative <span> entirely. Passed in (not imported)
 *   to keep this module config-agnostic and trivially testable.
 */
export function sanitizeRichText(html: string, handClass = ""): string {
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
          (!handClass || el.getAttribute("class") !== handClass)
        ) {
          while (el.firstChild) el.parentNode!.insertBefore(el.firstChild, el);
          el.remove();
          continue;
        }
        // Validate and normalise anchor href.
        if (el.tagName === "A") {
          const href = el.getAttribute("href") ?? "";
          if (/^https?:/.test(href)) {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          } else if (!/^(mailto:|\/|#)/.test(href)) {
            // Strip dangerous protocols (javascript:, data:, etc.).
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

// ── Selection/Range helpers, ported verbatim from RichText.tsx ────────────────

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
