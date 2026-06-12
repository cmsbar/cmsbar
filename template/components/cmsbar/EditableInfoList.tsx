"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { useCms } from "./ContentProvider";
import { ICON_NAMES, getIcon } from "./icon-registry";
import { cn } from "@/lib/cmsbar/utils";

export type InfoItem = { icon: string; label: string; value: string };
type Item = InfoItem;

type Props = {
  path: string;
  iconBoxClass?: string;
  className?: string;
  iconSize?: number;
  valueClass?: string;
  labelClass?: string;
  swapOrder?: boolean;
  variant?: "default" | "footer";
};

export function EditableInfoList({
  path,
  iconBoxClass,
  className,
  iconSize,
  valueClass,
  labelClass,
  swapOrder,
  variant = "default",
}: Props) {
  const { get, editMode, addEdit } = useCms();
  const items = ((get(path) as Item[] | undefined) ?? []) as Item[];

  // Drag-to-reorder state (editor only). Declared unconditionally so hook order
  // is stable across the editMode/!editMode branches below.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const update = (next: Item[]) => addEdit(path, next);

  const move = (from: number, to: number) => {
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
  };

  const resolvedIconSize = iconSize ?? (variant === "footer" ? 18 : 24);

  if (!editMode) {
    return (
      <div className={className ?? "space-y-6"}>
        {items.map((it, i) => {
          const icon = createElement(getIcon(it.icon), {
            size: resolvedIconSize,
          });
          if (variant === "footer") {
            const isEmail = it.value.includes("@");
            const isPhone = /^[\d\s+\-()]+$/.test(it.value.trim());
            const content = isEmail ? (
              <a href={`mailto:${it.value}`} className="hover:underline">
                {it.value}
              </a>
            ) : isPhone ? (
              <a
                href={`tel:${it.value.replace(/\s/g, "")}`}
                className="hover:underline"
              >
                {it.value}
              </a>
            ) : (
              it.value
            );
            return (
              <div
                key={i}
                className={`flex gap-3 ${it.label ? "items-start" : "items-center"}`}
              >
                <span className="shrink-0 text-[var(--cmsbar-icon)]">
                  {icon}
                </span>
                <span>
                  {content}
                  {it.label && (
                    <>
                      <br />
                      <span className="text-xs text-slate-500">
                        ({it.label})
                      </span>
                    </>
                  )}
                </span>
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-4">
              <div className={cn("p-2 rounded-lg", iconBoxClass)}>{icon}</div>
              <div>
                <p
                  className={labelClass ?? "text-sm text-slate-500 font-medium"}
                >
                  {it.label}
                </p>
                <p className={valueClass ?? "text-slate-800 font-bold"}>
                  {it.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={className ?? "space-y-6"}>
      {items.map((it, i) => (
        <EditableRow
          key={i}
          item={it}
          iconBoxClass={iconBoxClass}
          iconSize={resolvedIconSize}
          valueClass={valueClass}
          labelClass={labelClass}
          swapOrder={swapOrder}
          dragging={dragIndex === i}
          dragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
          onDragStartRow={() => setDragIndex(i)}
          onDragOverRow={() => {
            if (overIndex !== i) setOverIndex(i);
          }}
          onDropRow={() => {
            if (dragIndex !== null) move(dragIndex, i);
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragEndRow={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
          onChange={(patch) => {
            const next = items.slice();
            next[i] = { ...next[i], ...patch };
            update(next);
          }}
          onDelete={() => {
            const next = items.slice();
            next.splice(i, 1);
            update(next);
          }}
        />
      ))}
      <button
        type="button"
        onClick={() =>
          update([...items, { icon: "Clock", label: "Label", value: "Value" }])
        }
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-[var(--cmsbar-info)] hover:text-[var(--cmsbar-info)] text-slate-500 rounded-xl py-3 text-sm font-medium transition-colors"
      >
        <Plus size={16} /> Add item
      </button>
    </div>
  );
}

function EditableRow({
  item,
  iconBoxClass,
  iconSize = 24,
  valueClass,
  labelClass,
  swapOrder,
  dragging,
  dragOver,
  onDragStartRow,
  onDragOverRow,
  onDropRow,
  onDragEndRow,
  onChange,
  onDelete,
}: {
  item: Item;
  iconBoxClass?: string;
  iconSize?: number;
  valueClass?: string;
  labelClass?: string;
  swapOrder?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onDragStartRow: () => void;
  onDragOverRow: () => void;
  onDropRow: () => void;
  onDragEndRow: () => void;
  onChange: (patch: Partial<Item>) => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [pickerOpen]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverRow();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropRow();
      }}
      className={cn(
        "relative flex items-start gap-3 group rounded-lg ring-1 ring-dashed ring-blue-300/50 p-1 transition-colors",
        dragging && "opacity-40",
        dragOver && "ring-2 ring-[var(--cmsbar-info)] bg-[var(--cmsbar-info)]/5",
      )}
    >
      <button
        type="button"
        draggable
        onDragStart={onDragStartRow}
        onDragEnd={onDragEndRow}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="shrink-0 self-center cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none"
      >
        <GripVertical size={16} />
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "p-2 rounded-lg relative",
            iconBoxClass,
            pickerOpen && "ring-2 ring-[var(--cmsbar-info)]",
          )}
          title="Change icon"
        >
          {createElement(getIcon(item.icon), { size: iconSize })}
          <span className="absolute -bottom-1 -right-1 bg-[var(--cmsbar-info)] text-white rounded-full w-4 h-4 inline-flex items-center justify-center text-[9px] leading-none">
            ✎
          </span>
        </button>
        {pickerOpen && (
          <div
            ref={pickerRef}
            className="absolute z-20 top-full mt-2 left-0 bg-slate-900 text-white p-3 rounded-xl shadow-2xl w-64"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
              Choose an icon
            </p>
            <div className="grid grid-cols-6 gap-1">
              {ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange({ icon: name });
                    setPickerOpen(false);
                  }}
                  title={name}
                  className={cn(
                    "w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-white/10",
                    name === item.icon &&
                      "bg-white/20 ring-2 ring-[var(--cmsbar-info)]",
                  )}
                >
                  {createElement(getIcon(name), { size: 18 })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {swapOrder ? (
          <>
            <InlineEditable
              value={item.value}
              onCommit={(v) => onChange({ value: v })}
              className={valueClass ?? "text-slate-800 font-bold"}
            />
            {item.label && (
              <InlineEditable
                value={item.label}
                onCommit={(v) => onChange({ label: v })}
                className={labelClass ?? "text-sm text-slate-500 font-medium"}
              />
            )}
          </>
        ) : (
          <>
            <InlineEditable
              value={item.label}
              onCommit={(v) => onChange({ label: v })}
              className={labelClass ?? "text-sm text-slate-500 font-medium"}
            />
            <InlineEditable
              value={item.value}
              onCommit={(v) => onChange({ value: v })}
              className={valueClass ?? "text-slate-800 font-bold"}
            />
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Remove item"
        className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 bg-white text-slate-500 hover:text-red-500 rounded-full border border-slate-200 w-6 h-6 inline-flex items-center justify-center shadow-sm"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function InlineEditable({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => {
        const next = (e.currentTarget.textContent ?? "").trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
      className={cn(
        "block outline-none rounded px-0.5",
        "ring-1 ring-dashed ring-[var(--cmsbar-ring)] hover:ring-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent)]",
        className,
      )}
    />
  );
}
