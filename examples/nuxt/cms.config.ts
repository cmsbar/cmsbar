// ── CMSBar configuration ────────────────────────────────────────────────────
// This file is yours. Everything project-specific about CMSBar lives here;
// the CMSBar code under lib/cmsbar reads this and nothing else. No secrets
// here - tokens and credentials go in .env.
//
// Imported by the neutral core as "@/cms.config", which Nuxt's "@" -> rootDir
// alias resolves to THIS file (cms.config.ts at the project root), for both the
// SSR build and the Nitro catch-all API route.
import { defineCmsConfig } from "./lib/cmsbar/config";

export const cmsConfig = defineCmsConfig({
  // Short machine-safe id. Namespaces the cookie + local storage, so two
  // CMSBar sites never collide in one browser.
  namespace: "demo",

  siteName: "CMSBar Nuxt example",
  domain: "example.com",

  // The JSON file all editable content lives in (repo-relative).
  contentFile: "content/site-content.json",

  // Folders editors may upload to / delete from. First entry is the default.
  mediaFolders: ["public/images", "public/media"],

  // Nuxt serves static assets from `public/` (the default mediaRoot), so a file
  // at public/images/x.jpg is served at /images/x.jpg. Left as the default; the
  // CMS media code uses it for repo paths, the fs media list, and the image
  // proxy.
  mediaRoot: "public",

  // One draft = one `<branchPrefix><slug>` branch = one PR.
  branchPrefix: "cms/",

  // GitHub label a reviewer adds to lock a draft as approved (read-only).
  approvedLabel: "cmsbar approved",

  // Content-path prefixes that render on more than one page. Editors see
  // these highlighted in the "shared" color as a warning.
  sharedPrefixes: ["site.", "nav.", "header.", "footer.", "contact."],

  // Your static pages: draft naming + the per-page SEO drawer.
  pages: [{ key: "home", path: "/", label: "Home" }],

  richText: {
    // Optional decorative class the rich-text toolbar can toggle on inline
    // spans (e.g. a handwriting font). Empty string disables the button.
    decorClass: "",
  },
});
