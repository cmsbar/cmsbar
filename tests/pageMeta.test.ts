import { describe, it, expect } from "vitest";
import {
  resolvePageMeta,
  EMPTY_PAGE_META,
  type PageMetaEntry,
} from "@/lib/cmsbar/page-meta-core";

// Deterministic, offline: resolvePageMeta is pure - it takes a CMS pageMeta
// entry plus the page's hardcoded fallback and returns a framework-neutral
// object. No content file, config, or network is touched.

function entry(over: Partial<PageMetaEntry> = {}): PageMetaEntry {
  return { ...EMPTY_PAGE_META, ...over };
}

describe("resolvePageMeta", () => {
  it("falls back to the hardcoded title/description when the entry is empty", () => {
    const r = resolvePageMeta(entry(), {
      title: "Home - My Site",
      description: "Default home description.",
    });
    expect(r).toEqual({
      title: "Home - My Site",
      description: "Default home description.",
      // og* mirror the resolved title/description when not set explicitly.
      ogTitle: "Home - My Site",
      ogDescription: "Default home description.",
    });
    // No optional fields when the entry omits them.
    expect(r.ogImage).toBeUndefined();
    expect(r.canonical).toBeUndefined();
    expect(r.robots).toBeUndefined();
  });

  it("prefers CMS values over the fallback and fills og* from the resolved title/desc", () => {
    const r = resolvePageMeta(
      entry({ title: "About Us", description: "Who we are." }),
      { title: "About - Fallback", description: "Fallback desc." },
    );
    expect(r.title).toBe("About Us");
    expect(r.description).toBe("Who we are.");
    expect(r.ogTitle).toBe("About Us");
    expect(r.ogDescription).toBe("Who we are.");
  });

  it("uses explicit og fields, image, and canonical when present", () => {
    const r = resolvePageMeta(
      entry({
        title: "Pricing",
        description: "Plans and prices.",
        ogTitle: "Pricing - OG",
        ogDescription: "OG description.",
        ogImage: "/images/og-pricing.png",
        canonical: "https://example.com/pricing",
      }),
      { title: "Pricing - Fallback", description: "Fallback desc." },
    );
    expect(r).toEqual({
      title: "Pricing",
      description: "Plans and prices.",
      ogTitle: "Pricing - OG",
      ogDescription: "OG description.",
      ogImage: "/images/og-pricing.png",
      canonical: "https://example.com/pricing",
    });
  });

  it("emits robots index:false,follow:false only when noindex is set", () => {
    const withNoindex = resolvePageMeta(entry({ noindex: true }), {
      title: "Hidden",
      description: "Not indexed.",
    });
    expect(withNoindex.robots).toEqual({ index: false, follow: false });

    const withoutNoindex = resolvePageMeta(entry({ noindex: false }), {
      title: "Visible",
      description: "Indexed.",
    });
    expect(withoutNoindex.robots).toBeUndefined();
  });
});
