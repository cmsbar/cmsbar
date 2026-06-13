"use client";
import { cmsConfig } from "@/cms.config";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCms } from "./ContentProvider";
import { metaKey, META_PAGES } from "@/lib/cmsbar/page-meta";
import { cn } from "@/lib/cmsbar/utils";
import { cmsFetch } from "@/lib/cmsbar/cmsFetch";

const TITLE_MAX = 60;
const DESC_MAX = 155;

export function PageMetaDrawer({
  onClose,
  canEdit,
}: {
  onClose: () => void;
  canEdit: boolean;
}) {
  const { get, addEdit } = useCms();
  const pathname = usePathname();
  const key = metaKey(pathname);
  const [socialView, setSocialView] = useState<"fb" | "x">("fb");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Read helpers (string + boolean fields).
  const field = (name: string) =>
    key ? ((get(`pageMeta.${key}.${name}`) as string | undefined) ?? "") : "";
  const noindex = key ? Boolean(get(`pageMeta.${key}.noindex`)) : false;
  const favicon = (get("favicon") as string | undefined) ?? "";

  const set = (name: string, value: string | boolean) => {
    if (!key) return;
    addEdit(`pageMeta.${key}.${name}`, value);
  };

  const title = field("title");
  const description = field("description");
  const ogImage = field("ogImage");
  const ogTitle = field("ogTitle");
  const ogDescription = field("ogDescription");
  const canonical = field("canonical");

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[150] bg-[#080c18]/45 backdrop-blur-sm"
      />
      <aside className="fixed right-0 top-0 bottom-0 z-[160] flex w-[min(560px,100%)] flex-col bg-white shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.4)]">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Page metadata
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Editing:{" "}
              <span className="font-medium text-[var(--cmsbar-info)]">
                {pathname}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!key ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Metadata editing is available on the main pages:{" "}
              {META_PAGES.map((p) => p.label).join(", ")}. Course and teacher
              pages take their title/description from their own content.
            </div>
          ) : (
            <fieldset
              disabled={!canEdit}
              className="m-0 space-y-5 border-0 p-0"
            >
              {!canEdit && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Viewing the live values (read-only).{" "}
                  <strong>Start a draft</strong> to edit metadata.
                </div>
              )}
              {/* Title */}
              <div>
                <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
                  <span>Page title</span>
                  <Counter n={title.length} max={TITLE_MAX} />
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => set("title", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent-soft)]"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Browser tab + the search-result headline.
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
                  <span>Meta description</span>
                  <Counter n={description.length} max={DESC_MAX} />
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => set("description", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent-soft)]"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Summary under the title in search results.
                </p>
              </div>

              {/* Social image */}
              <ImageField
                label="Social share image (og:image)"
                help="Shown when shared on Facebook/WhatsApp/Messenger. 1200×630."
                value={ogImage}
                onChange={(v) => set("ogImage", v)}
              />

              {/* noindex */}
              <Toggle
                title="Show in search engines"
                sub="Turn off to add noindex (hide this page from Google)."
                on={!noindex}
                onToggle={() => set("noindex", !noindex ? true : false)}
              />

              {/* Advanced */}
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--cmsbar-info)]">
                  Advanced
                </summary>
                <div className="mt-3 space-y-4">
                  <Text
                    label="Social title"
                    placeholder={title}
                    value={ogTitle}
                    onChange={(v) => set("ogTitle", v)}
                  />
                  <Text
                    label="Social description"
                    placeholder={description}
                    value={ogDescription}
                    onChange={(v) => set("ogDescription", v)}
                    textarea
                  />
                  <Text
                    label="Canonical URL (blank = auto)"
                    placeholder="https://…"
                    value={canonical}
                    onChange={(v) => set("canonical", v)}
                  />
                </div>
              </details>

              {/* Site-wide favicon */}
              <div className="border-t pt-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Site-wide (applies to every page)
                </p>
                <ImageField
                  label="Favicon"
                  help="Browser-tab icon. PNG/SVG/ICO; square (e.g. 32×32 or 512×512)."
                  value={favicon}
                  onChange={(v) => addEdit("favicon", v)}
                />
              </div>

              {/* Previews */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Google result
                </p>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[13px] text-green-700">
                    {cmsConfig.domain} › {key === "home" ? "" : key}
                  </div>
                  <div className="text-lg leading-snug text-blue-800">
                    {title || "Untitled page"}
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-slate-600">
                    {description || "No description set."}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Social share
                  </p>
                  <div className="flex gap-1 rounded-md bg-slate-100 p-0.5">
                    {(["fb", "x"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSocialView(v)}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] font-medium",
                          socialView === v
                            ? "bg-white text-slate-800 shadow-sm"
                            : "text-slate-500",
                        )}
                      >
                        {v === "fb" ? "Facebook" : "X / Twitter"}
                      </button>
                    ))}
                  </div>
                </div>

                {socialView === "fb" ? (
                  <div className="overflow-hidden rounded-md border border-slate-200">
                    <div
                      className="flex h-40 items-center justify-center bg-slate-200 bg-cover bg-center text-xs text-slate-500"
                      style={
                        ogImage
                          ? { backgroundImage: `url(${ogImage})` }
                          : undefined
                      }
                    >
                      {ogImage ? "" : "1200 × 630 image"}
                    </div>
                    <div className="border-t border-slate-200 bg-[#f2f3f5] px-3 py-2">
                      <div className="text-[11px] uppercase text-slate-500">
                        {cmsConfig.domain}
                      </div>
                      <div className="truncate text-[15px] font-semibold text-slate-900">
                        {ogTitle || title || "Untitled page"}
                      </div>
                      <div className="line-clamp-2 text-xs text-slate-500">
                        {ogDescription || description || "No description set."}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <div
                      className="flex h-40 items-center justify-center bg-slate-200 bg-cover bg-center text-xs text-slate-500"
                      style={
                        ogImage
                          ? { backgroundImage: `url(${ogImage})` }
                          : undefined
                      }
                    >
                      {ogImage ? "" : "Summary image"}
                    </div>
                    <div className="px-3 py-2">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {ogTitle || title || "Untitled page"}
                      </div>
                      <div className="line-clamp-2 text-xs text-slate-500">
                        {ogDescription || description || "No description set."}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {cmsConfig.domain}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </fieldset>
          )}
        </div>

        <footer className="border-t px-5 py-3 text-xs text-slate-500">
          {canEdit ? (
            <>
              Changes are staged in your draft - click <strong>Save</strong> in
              the CMS bar to commit them.
            </>
          ) : (
            <>
              Read-only preview - start a draft from the CMS bar to make
              changes.
            </>
          )}
          <span className="mt-1 block text-slate-400">
            Note: the live page&rsquo;s &lt;head&gt; updates after the draft is
            merged &amp; deployed; this panel is the preview.
          </span>
        </footer>
      </aside>
    </>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium",
        n > max ? "text-red-600" : "text-slate-400",
      )}
    >
      {n} / {max}
    </span>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {textarea ? (
        <textarea
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent-soft)]"
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent-soft)]"
        />
      )}
    </div>
  );
}

function Toggle({
  title,
  sub,
  on,
  onToggle,
}: {
  title: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
      <div>
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        <div className="text-xs text-slate-500">{sub}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={cn(
          "relative h-6 w-11 flex-none rounded-full transition-colors",
          on ? "bg-[var(--cmsbar-info)]" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            on && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}

// Path input with a thumbnail preview and an inline image browser
// (filesystem-listed from public/images).
function ImageField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [items, setItems] = useState<{ path: string }[] | null>(null);

  useEffect(() => {
    if (!browsing || items !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await cmsFetch("/media/list?type=image", {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          files?: { path: string }[];
        };
        if (!cancelled) setItems(data.files ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browsing, items]);

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 flex-none overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <input
          type="text"
          value={value}
          placeholder="/images/…"
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--cmsbar-accent)] focus:ring-2 focus:ring-[var(--cmsbar-accent-soft)]"
        />
        <button
          type="button"
          onClick={() => setBrowsing((b) => !b)}
          className="flex-none rounded-md border border-slate-300 px-2.5 py-2 text-xs hover:border-[var(--cmsbar-accent)] hover:text-[var(--cmsbar-accent)]"
        >
          {browsing ? "Close" : "Browse"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex-none rounded-md border border-slate-300 px-2.5 py-2 text-xs hover:border-red-400 hover:text-red-500"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{help}</p>
      {browsing && (
        <div className="mt-2 grid max-h-48 grid-cols-5 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {items === null && (
            <p className="col-span-5 text-xs text-slate-500">Loading…</p>
          )}
          {items?.length === 0 && (
            <p className="col-span-5 text-xs text-slate-500">
              No images found.
            </p>
          )}
          {items?.map((it) => (
            <button
              key={it.path}
              type="button"
              title={it.path}
              onClick={() => {
                onChange(it.path);
                setBrowsing(false);
              }}
              className={cn(
                "aspect-square overflow-hidden rounded border",
                it.path === value
                  ? "border-[var(--cmsbar-accent)] ring-2 ring-[var(--cmsbar-accent-soft)]"
                  : "border-slate-200 hover:border-[var(--cmsbar-accent)]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.path}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
