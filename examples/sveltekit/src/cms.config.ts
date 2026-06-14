// ── CMSBar configuration ────────────────────────────────────────────────────
// This file is yours. Everything project-specific about CMSBar lives here;
// the CMSBar code under lib/cmsbar reads this and nothing else. No secrets
// here - tokens and credentials go in .env.
//
// Imported everywhere as "@/cms.config", which the "@/*" -> "./src/*" alias
// (kit.alias in svelte.config.js) resolves to THIS file (src/cms.config.ts),
// for both the SSR build and the catch-all API endpoint.
import { defineCmsConfig } from "./lib/cmsbar/config";

export const cmsConfig = defineCmsConfig({
  // Short machine-safe id. Namespaces the cookie + local storage, so two
  // CMSBar sites never collide in one browser.
  namespace: "demo",

  siteName: "CMSBar SvelteKit example",
  domain: "example.com",

  // The JSON file all editable content lives in (repo-relative).
  contentFile: "src/content/site-content.json",

  // Folders editors may upload to / delete from. First entry is the default.
  mediaFolders: ["static/images", "static/media"],

  // SvelteKit serves static assets from `static/` (not Next's `public/`). The
  // CMS media code reads this so repo paths, the fs media list, and the image
  // proxy all line up with where SvelteKit actually serves files from.
  mediaRoot: "static",

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
