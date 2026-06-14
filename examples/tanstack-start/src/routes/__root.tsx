/// <reference types="vite/client" />
// The TanStack Start host wiring (root route). This is the Start counterpart of
// the React Router example's app/root.tsx and the template's Next layout.tsx.
//
// - The `loader` runs on the server for the initial request: it calls the
//   getServerSession server fn (which reads the session cookie off the incoming
//   Request) to build `initialCms`, and reads the bundled content. getContent()
//   is an import-time JSON read, so it serializes cleanly via loader data.
// - The component renders the document shell and wraps <Outlet/> + <CmsBar/> in
//   <ContentProvider> inside <TanStackCmsHost> - the exact same assembly model
//   as every other host.
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "@/styles/app.css?url";
import { getContent } from "@/lib/content";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { CmsBar } from "@/components/cmsbar/CmsBar";
import { TanStackCmsHost } from "@/cmsbar/TanStackCmsHost";
import { getServerSession } from "@/cmsbar/getServerSession";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CMSBar runs in this TanStack Start host" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: async () => ({
    initialCms: await getServerSession(),
    content: getContent(),
  }),
  component: RootComponent,
});

function RootComponent() {
  const { initialCms, content } = Route.useLoaderData();
  return (
    <RootDocument>
      <TanStackCmsHost apiBase="/api/cms">
        <ContentProvider content={content} initialCms={initialCms}>
          <Outlet />
          <CmsBar />
        </ContentProvider>
      </TanStackCmsHost>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
