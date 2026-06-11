// Your content schema + the bundled content. This file is yours: as your
// site grows, the JSON grows with it. `SiteContent` is inferred from the
// JSON itself, so the type follows the file - replace it with an explicit
// interface when you want stricter guarantees.
//
// Next.js inlines the JSON import; rebuilds pick up edits committed via the
// CMS (a merged CMS PR redeploys with the new content baked in).

import contentJson from "../content/site-content.json";

export type SiteContent = typeof contentJson;

export const content: SiteContent = contentJson;

export function getContent(): SiteContent {
  return content;
}

export { resolvePath, setPath } from "./cmsbar/paths";
