import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default. The CMSBar root loader reads the session
  // cookie on the server to build initialCms, so SSR must stay on.
  ssr: true,
} satisfies Config;
