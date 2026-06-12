// CMSBar configuration contract. The project-owned `cms.config.ts` at the
// repo root exports a `cmsConfig` built with `defineCmsConfig`. Everything
// project-specific lives there; CMSBar code reads it and nothing else.
//
// This module must stay dependency-free and isomorphic (no node:, no React):
// it is imported from client components, server routes, and middleware alike.

export type CmsPage = {
  /** Slug used as the `pageMeta.<key>` content key. */
  key: string;
  /** Exact pathname of the page ("/", "/about", …). */
  path: string;
  /** Human label shown to editors (draft titles, page-meta drawer). */
  label: string;
};

export type CmsTourStep = {
  /** Stable id for the step (used as the React key). */
  id: string;
  /** Short heading shown at the top of the tour card. */
  title: string;
  /** One or two friendly sentences of plain text. */
  body: string;
  /**
   * CSS selector of the element to spotlight (e.g.
   * '[data-cms-path="hero.title"]'). Omitted - or absent from the DOM, as
   * with edit-mode-only UI while no draft is open - the card renders centered
   * with no spotlight, so write the body to tell the user what to click.
   */
  target?: string;
  /** Side of the target to place the card on. Default "bottom". */
  placement?: "top" | "bottom" | "left" | "right";
};

export type CmsConfig = {
  /**
   * Short machine-safe id for this site (lowercase, no spaces). Namespaces
   * the session cookie, localStorage keys, and the IndexedDB database, so
   * two CMSBar sites on one machine never collide.
   */
  namespace: string;
  /** Display name of the site, shown in editor chrome. */
  siteName: string;
  /** Public domain (no protocol) - used in the SERP preview. */
  domain: string;
  /** Repo path of the content JSON file the editor edits. */
  contentFile: string;
  /**
   * Repo folders (relative to repo root) that editors may upload to, delete
   * from, and browse. The first entry is the default upload target.
   */
  mediaFolders: string[];
  /** Git branch prefix for drafts. One draft = one `<prefix><slug>` branch. */
  branchPrefix: string;
  /**
   * GitHub label that locks a draft PR as "approved" (read-only). Can be
   * overridden per-deploy with the CMS_APPROVED_LABEL env var.
   */
  approvedLabel: string;
  /**
   * Content-path prefixes that render on more than one page (nav, footer,
   * contact info…). Editors see these with the "shared" highlight color.
   */
  sharedPrefixes: string[];
  /** The static pages of the site, used for draft names and per-page SEO. */
  pages: CmsPage[];
  richText?: {
    /**
     * Optional decorative CSS class the rich-text toolbar can toggle on
     * inline spans (e.g. a handwriting font class). Empty disables the
     * toolbar button and strips the class on sanitize.
     */
    decorClass?: string;
  };
  tour?: {
    /** Ordered onboarding steps walked through by `<CmsTour/>`. */
    steps: CmsTourStep[];
    /**
     * Open the tour automatically the first time an authenticated editor
     * loads the site (tracked per browser via localStorage). Editors can
     * always relaunch it from the bar's "✦ Guide" button.
     */
    autoStart?: boolean;
  };
};

export function defineCmsConfig(config: CmsConfig): CmsConfig {
  if (!/^[a-z][a-z0-9_-]*$/.test(config.namespace)) {
    throw new Error(
      `cmsConfig.namespace must be lowercase alphanumeric ("${config.namespace}" given)`,
    );
  }
  return config;
}
