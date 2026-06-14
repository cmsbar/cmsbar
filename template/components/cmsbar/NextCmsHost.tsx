"use client";
// Next.js App Router host. Wrap the CMS subtree (ContentProvider + page +
// CmsBar) with this in your root layout to get soft navigation, optimized
// next/image, and the live pathname. This is the only Next-coupled client
// glue - everything it provides has a DOM default in host.tsx.

import { usePathname, useRouter } from "next/navigation";
import NextImage, { type ImageProps } from "next/image";
import type { ReactNode } from "react";
import { HostProvider, type CmsImageProps } from "./host";

function NextImageAdapter(props: CmsImageProps) {
  return <NextImage {...(props as unknown as ImageProps)} />;
}

export function NextCmsHost({
  children,
  apiBase,
}: {
  children: ReactNode;
  apiBase?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <HostProvider
      value={{
        pathname,
        navigate: (href) => router.push(href),
        Image: NextImageAdapter,
        apiBase,
      }}
    >
      {children}
    </HostProvider>
  );
}
