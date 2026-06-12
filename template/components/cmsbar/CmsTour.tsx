"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cmsConfig } from "@/cms.config";
import { Portal } from "./Portal";
import { cn } from "@/lib/cmsbar/utils";

// Guided onboarding tour ("navigator"). Renders nothing unless the project
// configures `cmsConfig.tour`. Opens automatically once per browser when
// `tour.autoStart` is set, and imperatively whenever anyone dispatches
// `window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT))` - the bar's
// "✦ Guide" pill does exactly that. A window event (rather than lifted
// state) keeps CmsBar's three render branches untouched.

export const TOUR_OPEN_EVENT = "cmsbar:tour:open";

/** Set once the editor finishes or skips the tour; gates autoStart. */
const DONE_LS_KEY = `cmsbar:tour-done:${cmsConfig.namespace}`;
/**
 * Mid-tour steps ask the user to click things that reload the page ("New
 * draft", "Save"). Remember the step per tab so the tour resumes where it
 * was instead of restarting from the welcome card.
 */
const STEP_SS_KEY = `cmsbar:tour-step:${cmsConfig.namespace}`;

const MARGIN = 12;

export function CmsTour() {
  const steps = cmsConfig.tour?.steps ?? [];
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // Viewport rect of the current step's target; null = centered card, no spotlight.
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const cardRef = useRef<HTMLDivElement>(null);

  // Imperative open (bar button). Always restarts from the first step.
  useEffect(() => {
    const onOpen = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(TOUR_OPEN_EVENT, onOpen);
  }, []);

  // Auto-open on first visit, and resume any in-flight tour across the page
  // reloads its own steps cause ("New draft", Save→preview both remount us).
  // Resume must NOT be gated on autoStart/done: a replayed tour (done-key
  // already set) hits the same reloads and would otherwise die mid-step.
  useEffect(() => {
    if (steps.length === 0) return;
    try {
      const saved = sessionStorage.getItem(STEP_SS_KEY);
      if (saved !== null) {
        const n = Number(saved);
        setIndex(
          Number.isInteger(n) ? Math.min(Math.max(n, 0), steps.length - 1) : 0,
        );
        setOpen(true);
        return;
      }
      if (!cmsConfig.tour?.autoStart) return;
      if (localStorage.getItem(DONE_LS_KEY)) return;
    } catch {
      /* storage unavailable - fall through to autoStart without resume */
      if (!cmsConfig.tour?.autoStart) return;
    }
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = (markDone: boolean) => {
    setOpen(false);
    setIndex(0);
    try {
      sessionStorage.removeItem(STEP_SS_KEY);
      if (markDone) localStorage.setItem(DONE_LS_KEY, "1");
    } catch {
      /* storage unavailable */
    }
  };

  const step = open ? steps[index] : undefined;

  // Track the target's rect; recompute on scroll/resize. Capture-phase scroll
  // listener (same trick as RichText's toolbar) so nested scroll containers
  // are covered too.
  useEffect(() => {
    if (!step) return;
    try {
      sessionStorage.setItem(STEP_SS_KEY, String(index));
    } catch {
      /* storage unavailable */
    }
    let el: Element | null = null;
    if (step.target) {
      try {
        el = document.querySelector(step.target);
      } catch {
        // Invalid selector in the site's tour config must not crash the page.
        el = null;
      }
    }
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const update = () => {
      const r = el.getBoundingClientRect();
      // Hidden targets (display:none) report a zero rect - treat as missing.
      setRect(r.width || r.height ? r : null);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [step, index]);

  // Place the card next to the target (clamped to the viewport) once it has
  // rendered and can be measured. Layout effect so the first paint is placed.
  useLayoutEffect(() => {
    if (!step) return;
    if (!rect) {
      setCardPos(null);
      return;
    }
    const card = cardRef.current;
    if (!card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let top: number;
    let left: number;
    switch (step.placement ?? "bottom") {
      case "top":
        top = rect.top - ch - MARGIN;
        left = rect.left + rect.width / 2 - cw / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.left - cw - MARGIN;
        break;
      case "right":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.right + MARGIN;
        break;
      default:
        top = rect.bottom + MARGIN;
        left = rect.left + rect.width / 2 - cw / 2;
    }
    setCardPos({
      top: Math.min(Math.max(top, MARGIN), window.innerHeight - ch - MARGIN),
      left: Math.min(Math.max(left, MARGIN), window.innerWidth - cw - MARGIN),
    });
  }, [step, rect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape aimed at another surface (link-input, dialogs, text fields)
      // closes that surface, not the tour.
      const t = e.target as HTMLElement | null;
      if (
        t?.closest?.("input, textarea, [contenteditable], [data-cms-toolbar]")
      ) {
        return;
      }
      close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    <Portal>
      {/* pointer-events-none lets the user click the spotlit element (the tour
          asks them to); only the card itself captures clicks. data-cms-ui so
          the CMS click-capture logic ignores the layer. */}
      <div data-cms-ui className="fixed inset-0 z-[210] pointer-events-none">
        {rect ? (
          <div
            className="absolute rounded-lg ring-2 ring-white/60 transition-all duration-200"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
              boxShadow: "0 0 0 9999px rgba(2,6,23,0.6)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-slate-950/60" />
        )}
        <div
          ref={cardRef}
          className={cn(
            "absolute w-80 max-w-[calc(100vw-1.5rem)] pointer-events-auto rounded-xl bg-slate-900/95 text-white shadow-2xl backdrop-blur p-4",
            !cardPos && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          )}
          style={cardPos ?? undefined}
        >
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <h3 className="text-sm font-semibold">{step.title}</h3>
            <span className="text-xs text-white/50 shrink-0">
              {index + 1} / {steps.length}
            </span>
          </div>
          <p className="text-sm text-white/80">{step.body}</p>
          <div className="flex items-center gap-2 mt-3.5">
            <button
              onClick={() => close(true)}
              className="text-xs text-white/50 hover:text-white mr-auto"
            >
              Skip tour
            </button>
            {index > 0 && (
              <button
                onClick={() => setIndex(index - 1)}
                className="rounded-full bg-white/10 hover:bg-white/20 text-xs px-3 py-1"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? close(true) : setIndex(index + 1))}
              className="rounded-full bg-[var(--cmsbar-accent)] hover:bg-[var(--cmsbar-accent-strong)] text-white text-xs font-semibold px-3 py-1"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
