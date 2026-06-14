// React Router (framework mode) host. Wrap the CMS subtree (ContentProvider +
// page + CmsBar) with this in app/root.tsx to give the neutral CMS primitives
// the three things they need from a host: the live pathname, soft navigation,
// and an image component. This is the only RR-coupled client glue - everything
// it provides has a DOM default in the neutral host seam (@/components/cmsbar/host).
//
// It is the React Router counterpart of the template's NextCmsHost.tsx.

import { useLocation, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { HostProvider, DomImage } from "@/components/cmsbar/host";

export function ReactRouterCmsHost({
  children,
  apiBase = "/api/cms",
}: {
  children: ReactNode;
  apiBase?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <HostProvider
      value={{
        pathname: location.pathname,
        navigate: (href) => navigate(href),
        // React Router has no built-in optimizing image component, so the
        // neutral plain-<img> default is exactly right here.
        Image: DomImage,
        apiBase,
      }}
    >
      {children}
    </HostProvider>
  );
}
