"use client";

import { useEffect, useRef, useState, createElement } from "react";
import { useCms } from "./ContentProvider";
import { Portal } from "./Portal";
import { RichTextToolbar, sanitizeRichText } from "./RichText";
import { isSharedPath } from "./shared-paths";
import { cn } from "@/lib/cmsbar/utils";

type Props = {
  path: string;
  as?: string;
  className?: string;
  fallback?: string;
  multiline?: boolean;
} & Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "onBlur" | "dangerouslySetInnerHTML"
>;

// Every editable text node renders via this component. View mode uses
// dangerouslySetInnerHTML so that any inline formatting tags (<b>/<i>/<u>/
// a configured decor class) saved by the rich-text editor render as
// formatted output. Plain strings render identically to plain text.
export function T({
  path,
  as = "span",
  className,
  fallback,
  multiline,
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
    // Focus parked in the toolbar (e.g. the link input) means an editing
    // session is live; rewriting innerHTML would detach the saved selection.
    if (document.activeElement?.closest("[data-cms-toolbar]")) return;
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
    if (document.activeElement?.closest("[data-cms-toolbar]")) return;
    ref.current.innerHTML = value;
    lastSeenRef.current = value;
  }, [editMode, value]);

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

  const stage = (nextHtml: string) => {
    const cleaned = sanitizeRichText(nextHtml);
    const finalVal = multiline ? cleaned : cleaned.trim();
    if (finalVal === lastSeenRef.current) return;
    lastSeenRef.current = finalVal;
    if (finalVal !== value) addEdit(path, finalVal);
  };

  const editProps: React.HTMLAttributes<HTMLElement> & {
    contentEditable?: boolean;
    suppressContentEditableWarning?: boolean;
    "data-cms-path"?: string;
    "data-cms-shared"?: string;
    ref?: React.Ref<HTMLElement>;
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
    onFocus: () => setFocused(true),
    onBlur: (e) => {
      const html = (e.currentTarget as HTMLElement).innerHTML;
      stage(html);
      setTimeout(() => {
        if (document.activeElement?.closest("[data-cms-toolbar]")) return;
        setFocused(false);
      }, 200);
    },
    onKeyDown: (e) => {
      if (!multiline && e.key === "Enter") {
        e.preventDefault();
        (e.currentTarget as HTMLElement).blur();
      }
    },
  };

  return (
    <>
      {createElement(as, editProps)}
      {focused && (
        <Portal>
          <RichTextToolbar
            editorRef={ref}
            onAbandon={() => {
              if (ref.current) stage(ref.current.innerHTML);
              setFocused(false);
            }}
          />
        </Portal>
      )}
    </>
  );
}
