// TanStack Start (TanStack Router) host. Wrap the CMS subtree (ContentProvider +
// page + CmsBar) with this in src/routes/__root.tsx to give the neutral CMS
// primitives the three things they need from a host: the live pathname, soft
// navigation, and an image component. They read those from a HostProvider via
// useHost(); with no host wired, DOM defaults keep everything working - this
// adapter only *improves* it (reactive pathname + soft nav).
//
// It is the TanStack Start counterpart of the template's NextCmsHost.tsx and the
// React Router example's ReactRouterCmsHost.tsx.

import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HostProvider, DomImage } from "@/components/cmsbar/host";

export function TanStackCmsHost({
  children,
  apiBase = "/api/cms",
}: {
  children: ReactNode;
  apiBase?: string;
}) {
  const pathname = useLocation({ select: (l) => l.pathname });
  const navigate = useNavigate();
  return (
    <HostProvider
      value={{
        pathname,
        // `to` accepts any string href; the editor only ever navigates to
        // first-party in-app paths, so a plain string nav is exactly right.
        navigate: (href) => {
          void navigate({ to: href });
        },
        // TanStack Start has no built-in optimizing image component, so the
        // neutral plain-<img> default is exactly right here.
        Image: DomImage,
        apiBase,
      }}
    >
      {children}
    </HostProvider>
  );
}
