// Markdown ↔ HTML conversion for the IssuesPanel's WYSIWYG details editor,
// ported verbatim from the helpers in template/components/cmsbar/IssuesPanel.tsx.
// Pure DOM/string transforms (no framework), so they live in a plain module the
// component imports and the test suite can exercise directly.

export type MdFormat =
  | "bold"
  | "italic"
  | "heading"
  | "quote"
  | "link"
  | "ul"
  | "ol"
  | "checklist";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(text: string): string {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function mdToHtml(md: string): string {
  if (!md.trim()) return "";
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`);
      i++;
      continue;
    }
    if (/^- \[[ x]\] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- \[[ x]\] /.test(lines[i])) {
        const checked = lines[i][3] === "x";
        items.push(
          `<li class="task-item" data-task="true" data-checked="${checked}">${inlineMd(
            lines[i].slice(6),
          )}</li>`,
        );
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        /^- /.test(lines[i]) &&
        !/^- \[/.test(lines[i])
      ) {
        items.push(`<li>${inlineMd(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\d+\. /, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  return out.join("");
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  const inner = () => nodesToMd(node.childNodes);
  const style = node.getAttribute("style") ?? "";
  switch (tag) {
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `_${inner()}_`;
    case "a":
      return `[${inner()}](${node.getAttribute("href") ?? ""})`;
    case "h1":
    case "h2":
    case "h3":
      return `## ${inner()}\n`;
    case "blockquote":
      return `> ${inner().trim()}\n`;
    case "br":
      return "\n";
    case "p":
      return `${inner()}\n`;
    case "div": {
      const c = inner();
      return c.trim() ? (c.endsWith("\n") ? c : c + "\n") : "";
    }
    case "ul": {
      const items: string[] = [];
      node.querySelectorAll(":scope > li").forEach((li) => {
        const el = li as HTMLElement;
        const isTask =
          el.classList.contains("task-item") || el.dataset.task === "true";
        const checked = el.dataset.checked === "true";
        const txt = nodesToMd(li.childNodes).trim();
        items.push(isTask ? `- [${checked ? "x" : " "}] ${txt}` : `- ${txt}`);
      });
      return items.join("\n") + "\n";
    }
    case "ol": {
      const items: string[] = [];
      let n = 1;
      node.querySelectorAll(":scope > li").forEach((li) => {
        items.push(`${n++}. ${nodesToMd(li.childNodes).trim()}`);
      });
      return items.join("\n") + "\n";
    }
    case "li":
      return ""; // consumed by ul/ol handler
    case "span": {
      let t = inner();
      if (style.includes("font-weight") && /bold|700/.test(style))
        t = `**${t}**`;
      if (style.includes("font-style") && style.includes("italic"))
        t = `_${t}_`;
      return t;
    }
    default:
      return inner();
  }
}

function nodesToMd(nodes: NodeList): string {
  let r = "";
  for (const n of nodes) r += nodeToMd(n);
  return r;
}

export function htmlToMd(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return nodesToMd(div.childNodes)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
