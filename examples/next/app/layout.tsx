import "./globals.css";
import { cookies } from "next/headers";
import { getContent } from "@/lib/content";
import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { ContentProvider } from "@/components/cmsbar/ContentProvider";
import { NextCmsHost } from "@/components/cmsbar/NextCmsHost";
import { CmsBar } from "@/components/cmsbar/CmsBar";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  const initialCms = session
    ? { authenticated: true, user: session.user, draft: session.draft }
    : { authenticated: false };
  return (
    <html lang="en">
      <body>
        <NextCmsHost>
          <ContentProvider content={getContent()} initialCms={initialCms}>
            {children}
            <CmsBar />
          </ContentProvider>
        </NextCmsHost>
      </body>
    </html>
  );
}
