"use client";
// The client host seam. The CMS primitives are framework-neutral except for
// three things a host provides: the current pathname, soft navigation, and an
// image component. They read those from a HostProvider via useHost(); with no
// host wired, DOM defaults (window.location + a plain <img>) keep everything
// working - adapters only *improve* it (soft nav, next/image optimization).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { setCmsApiBase } from "@/lib/cmsbar/cmsFetch";

// A minimal image-prop surface compatible with both next/image and a plain
// <img>. Hosts map it onto their framework's image component. No index
// signature on purpose - it would collapse Omit<CmsImageProps, "src"> (used by
// EditableImage) down to the index type and erase every field's real type.
export interface CmsImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  loading?: "eager" | "lazy";
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  className?: string;
  style?: CSSProperties;
  onError?: (e: unknown) => void;
}

// STABLE CONTRACT (frozen 2026-06-14, validated by @cms/next + the React Router
// host). Adapters implement this; changing it is a breaking change. Add optional
// fields rather than altering existing ones.
export interface CmsClientHost {
  /** Current path, reactive. */
  pathname: string;
  /** Soft navigation when the host supports it; full load otherwise. */
  navigate: (href: string) => void;
  /** Image component - next/image in @cms/next, a plain <img> by default. */
  Image: ComponentType<CmsImageProps>;
  /** Base for the CMS API (and the image proxy). */
  apiBase: string;
}

// Plain <img> default: drop next-only props a DOM <img> would reject, and
// honor `fill` by absolutely filling the positioned parent (like next/image).
export function DomImage({
  src,
  alt,
  width,
  height,
  fill,
  // intentionally dropped for a DOM <img>:
  sizes: _sizes,
  priority: _priority,
  quality: _quality,
  className,
  style,
  loading,
  onError,
  ...rest
}: CmsImageProps) {
  const resolvedStyle: CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...style,
      }
    : style;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={loading}
      className={className}
      style={resolvedStyle}
      onError={onError as never}
      {...(rest as Record<string, unknown>)}
    />
  );
}

function domPathname(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

export const DEFAULT_CLIENT_HOST: CmsClientHost = {
  pathname: domPathname(),
  navigate: (href) => {
    if (typeof window !== "undefined") window.location.href = href;
  },
  Image: DomImage,
  apiBase: "/api/cms",
};

const HostCtx = createContext<CmsClientHost | null>(null);

/** Read the active client host (DOM defaults when no HostProvider is mounted). */
export function useHost(): CmsClientHost {
  return useContext(HostCtx) ?? DEFAULT_CLIENT_HOST;
}

/**
 * Wraps the CMS subtree (and the editable page content) with a client host.
 * Pass a partial `value` from a framework adapter; anything omitted falls back
 * to the DOM default. With no `value` at all you still get a working host with
 * popstate-reactive pathname - the zero-adapter SPA case.
 */
export function HostProvider({
  value,
  children,
}: {
  value?: Partial<CmsClientHost>;
  children: ReactNode;
}) {
  const [domPath, setDomPath] = useState(domPathname);
  const hostPathname = value?.pathname;
  useEffect(() => {
    if (hostPathname !== undefined) return; // host drives the path; skip popstate
    const on = () => setDomPath(window.location.pathname);
    window.addEventListener("popstate", on);
    setDomPath(window.location.pathname);
    return () => window.removeEventListener("popstate", on);
  }, [hostPathname]);

  const apiBase = value?.apiBase ?? DEFAULT_CLIENT_HOST.apiBase;
  // Keep the module-level cmsFetch base in sync so non-hook callers agree.
  useEffect(() => {
    setCmsApiBase(apiBase);
  }, [apiBase]);

  const host: CmsClientHost = {
    pathname: hostPathname ?? domPath,
    navigate: value?.navigate ?? DEFAULT_CLIENT_HOST.navigate,
    Image: value?.Image ?? DEFAULT_CLIENT_HOST.Image,
    apiBase,
  };
  return <HostCtx.Provider value={host}>{children}</HostCtx.Provider>;
}
