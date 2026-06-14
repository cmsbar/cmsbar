import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";

import "./styles/app.css";
import { getContent } from "@/lib/content";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { CmsBar } from "@/components/cmsbar/CmsBar";
import { ReactRouterCmsHost } from "@/cmsbar/ReactRouterCmsHost";
import { getServerSession } from "@/cmsbar/getServerSession";

// Server half of the host wiring: read the session cookie off the Request to
// build initialCms, and hand the bundled content to the provider. getContent()
// is an import-time JSON read, so it runs cleanly here on the server and the
// result serializes to the client via loaderData.
export function loader({ request }: Route.LoaderArgs) {
  return {
    initialCms: getServerSession(request),
    content: getContent(),
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <ReactRouterCmsHost apiBase="/api/cms">
      <ContentProvider
        content={loaderData.content}
        initialCms={loaderData.initialCms}
      >
        <Outlet />
        <CmsBar />
      </ContentProvider>
    </ReactRouterCmsHost>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
