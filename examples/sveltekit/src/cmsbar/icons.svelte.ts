// Inline-SVG icon registry for the Svelte CMSBar primitives, mirroring
// template/components/cmsbar/icon-registry.ts.
//
// The React template registry maps names -> lucide-react components. lucide-react
// is React-only, so rather than add a Svelte icon dependency this module embeds
// the exact lucide node arrays (path/circle/rect/... primitives, copied verbatim
// from lucide's source) and renders them through the Icon.svelte component. The
// rendered SVG is byte-for-byte the lucide glyph (same viewBox, stroke, paths),
// so the editor's icon vocabulary stays in lockstep with the React app.
//
// Parity contract with icon-registry.ts:
//   - ICON_NAMES: same ordered set of names (Clock first = the add-item default,
//     and getIcon's fallback).
//   - getIconNode(name): the lucide node array for that name (Clock fallback).
// The curated set is intentionally limited to the same 12 icons the React app
// uses, plus the three chrome glyphs (GripVertical/Plus/X) the list UI needs.

/** A single lucide SVG child: [tag, attributes]. Matches lucide's __iconNode. */
export type IconNode = [tag: string, attrs: Record<string, string | number>][];

// The 12 curated picker icons. Node arrays copied verbatim from lucide-react's
// dist (icons/<name>.js __iconNode), minus the per-node `key` (React-only).
export const ICONS: Record<string, IconNode> = {
  Clock: [
    ["path", { d: "M12 6v6l4 2" }],
    ["circle", { cx: "12", cy: "12", r: "10" }],
  ],
  Calendar: [
    ["path", { d: "M8 2v4" }],
    ["path", { d: "M16 2v4" }],
    ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2" }],
    ["path", { d: "M3 10h18" }],
  ],
  Baby: [
    ["path", { d: "M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" }],
    ["path", { d: "M15 12h.01" }],
    [
      "path",
      {
        d: "M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1",
      },
    ],
    ["path", { d: "M9 12h.01" }],
  ],
  MapPin: [
    [
      "path",
      {
        d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
      },
    ],
    ["circle", { cx: "12", cy: "10", r: "3" }],
  ],
  Navigation: [["polygon", { points: "3 11 22 2 13 21 11 13 3 11" }]],
  Car: [
    [
      "path",
      {
        d: "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",
      },
    ],
    ["circle", { cx: "7", cy: "17", r: "2" }],
    ["path", { d: "M9 17h6" }],
    ["circle", { cx: "17", cy: "17", r: "2" }],
  ],
  Sparkles: [
    [
      "path",
      {
        d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
      },
    ],
    ["path", { d: "M20 2v4" }],
    ["path", { d: "M22 4h-4" }],
    ["circle", { cx: "4", cy: "20", r: "2" }],
  ],
  Mail: [
    ["path", { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" }],
    ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }],
  ],
  Phone: [
    [
      "path",
      {
        d: "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",
      },
    ],
  ],
  Award: [
    [
      "path",
      {
        d: "m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",
      },
    ],
    ["circle", { cx: "12", cy: "8", r: "6" }],
  ],
  Facebook: [
    [
      "path",
      {
        d: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
      },
    ],
  ],
  Instagram: [
    ["rect", { width: "20", height: "20", x: "2", y: "2", rx: "5", ry: "5" }],
    ["path", { d: "M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" }],
    ["line", { x1: "17.5", x2: "17.51", y1: "6.5", y2: "6.5" }],
  ],
};

/** Picker icon names, in registry order. Mirrors icon-registry.ts ICON_NAMES. */
export const ICON_NAMES = Object.keys(ICONS);

/** Resolve a content icon name to its node array; fall back to Clock (matches
 *  the React getIcon's `?? Clock` default). */
export function getIconNode(name: string): IconNode {
  return ICONS[name] ?? ICONS.Clock;
}

// ── Chrome glyphs ────────────────────────────────────────────────────────────
// Used by the list UI itself (not pickable as content icons), so they live
// outside ICONS/ICON_NAMES, mirroring the React file's separate lucide imports.

export const GRIP_VERTICAL: IconNode = [
  ["circle", { cx: "9", cy: "12", r: "1" }],
  ["circle", { cx: "9", cy: "5", r: "1" }],
  ["circle", { cx: "9", cy: "19", r: "1" }],
  ["circle", { cx: "15", cy: "12", r: "1" }],
  ["circle", { cx: "15", cy: "5", r: "1" }],
  ["circle", { cx: "15", cy: "19", r: "1" }],
];

export const PLUS: IconNode = [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "M12 5v14" }],
];

export const X_MARK: IconNode = [
  ["path", { d: "M18 6 6 18" }],
  ["path", { d: "m6 6 12 12" }],
];
