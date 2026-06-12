"use client";

import { useState } from "react";
import { cn } from "@/lib/cmsbar/utils";

/** Parse an object-position string ("50% 30%") into percentages; center default. */
export function parsePos(s: string | undefined): { x: number; y: number } {
  const m = (s ?? "").match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}
export const clampPct = (n: number) =>
  Math.max(0, Math.min(100, Math.round(n)));

/** Click-to-set focal point overlay - crosshair marker, live coords pill and
 *  X/Y axis locks. Renders absolutely inside a relatively-positioned wrapper;
 *  shared by EditableImage and EditableMedia (image kind). */
export function FocalPointOverlay({
  position,
  onSet,
}: {
  position: { x: number; y: number };
  onSet: (x: number, y: number) => void;
}) {
  const [lockX, setLockX] = useState(false);
  const [lockY, setLockY] = useState(false);
  const pos = position;

  return (
    <div
      data-cms-ui
      className="pointer-events-auto absolute inset-0 z-[95] cursor-crosshair"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        // Locked axes keep their current value so you can slide along one
        // direction only (e.g. lock Y to pan strictly left↔right).
        const x = lockX
          ? pos.x
          : clampPct(((e.clientX - r.left) / r.width) * 100);
        const y = lockY
          ? pos.y
          : clampPct(((e.clientY - r.top) / r.height) * 100);
        onSet(x, y);
      }}
    >
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--cmsbar-accent)]/70 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      />
      {/* Control strip - live coords + axis locks. Clicks here must NOT
          move the focal point, so they stop propagation. */}
      <div
        data-cms-ui
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="absolute left-1/2 top-2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/75 px-2 py-1 text-[11px] font-medium text-white"
      >
        <span className="font-mono tabular-nums">
          {pos.x}% {pos.y}%
        </span>
        <span className="h-3 w-px bg-white/25" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLockX((v) => !v);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 hover:bg-white/15",
            lockX && "bg-[var(--cmsbar-accent)]",
          )}
          title="Lock the horizontal (X) position"
        >
          ↔ X
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLockY((v) => !v);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 hover:bg-white/15",
            lockY && "bg-[var(--cmsbar-accent)]",
          )}
          title="Lock the vertical (Y) position"
        >
          ↕ Y
        </button>
      </div>
    </div>
  );
}
