// Site-wide launch gate, shared by the middleware (who sees the teaser vs the
// real site) and the CMS Settings drawer (status label). A logged-in editor
// always sees the real site (to build/preview); the public sees the real site
// only once the mode is "live".
//
// To use it, your content JSON needs a top-level `launch: { mode }` key and
// your middleware should rewrite to a teaser page when `!isSiteLive(...)` -
// see middleware.example.ts in the CMSBar template.

/** `teaser` → public sees the teaser, only logged-in editors see the site;
 *  `live` → everyone sees the site. */
export type SiteLaunch = {
  mode: "teaser" | "live";
};

/**
 * Should the full site (not the teaser) render for a given viewer?
 * `isLoggedIn` = a CMS editor session is active.
 */
export function isSiteLive(
  launch: SiteLaunch | undefined,
  isLoggedIn: boolean,
): boolean {
  if (isLoggedIn) return true;
  return (launch?.mode ?? "live") === "live";
}

/** Short human label describing the *public* launch state (for the CMS bar). */
export function siteLaunchLabel(launch: SiteLaunch | undefined): {
  tone: "live" | "teaser";
  text: string;
} {
  if ((launch?.mode ?? "live") === "live")
    return { tone: "live", text: "Live - the public sees the site." };
  return {
    tone: "teaser",
    text: "Teaser - the public sees the teaser; only editors see the site.",
  };
}
