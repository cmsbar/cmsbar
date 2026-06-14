// Rich-text sanitization, ported verbatim from the React
// template/components/cmsbar/RichText.tsx sanitize()/sanitizeRichText().
//
// Lives in a plain .ts module (not the .svelte component) so it can be imported
// by the component AND unit-tested in isolation under jsdom without compiling a
// Svelte file. Behaviour is identical to the React original: an allow-list of
// tags, attribute stripping (keep only SPAN@class === HAND_CLASS and A@href),
// dangerous-protocol href stripping, and http(s) anchors get target/rel.
//
// Uses the DOM (document.createElement("template")) exactly like the React
// version, so it must only run in the browser (the editor is client-only) or
// under jsdom in tests.

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
