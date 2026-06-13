import { SESSION_COOKIE, verifySession } from "@/lib/cmsbar/session";
import { type CmsHandler, json } from "@/lib/cmsbar/server/http";

// Follow a Google Maps URL (often a maps.app.goo.gl short link) to its final
// place URL, extract the @lat,lng,zoom segment, and return an iframe-friendly
// embed URL. Google's "Embed a map" share dialog gives a /maps/embed?pb=...
// URL but that requires the user to use Share → Embed. Editors typically just
// copy the URL from the address bar or the share button - we make those work.

const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "google.com",
  "www.google.com",
]);

function buildEmbedFromCoords(lat: string, lng: string, zoom: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(
    `${lat},${lng}`,
  )}&z=${encodeURIComponent(zoom)}&output=embed`;
}

function buildEmbedFromQuery(q: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

// /@45.8129,15.9785,17z  or  /@45.8,15.9,17.5z  or  /@45.8,15.9,17z/data=...
const COORD_RE = /@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/;

function extractEmbed(finalUrl: string): string | null {
  try {
    const u = new URL(finalUrl);
    const m = u.pathname.match(COORD_RE) || finalUrl.match(COORD_RE);
    if (m) return buildEmbedFromCoords(m[1], m[2], m[3]);

    const q = u.searchParams.get("q");
    if (q) return buildEmbedFromQuery(q);

    // /place/<Name>/...
    const placeMatch = u.pathname.match(/^\/maps\/place\/([^/]+)/);
    if (placeMatch)
      return buildEmbedFromQuery(
        decodeURIComponent(placeMatch[1]).replace(/\+/g, " "),
      );

    return null;
  } catch {
    return null;
  }
}

export const resolveMap: CmsHandler = async (req, ctx) => {
  const session = verifySession(ctx.cookies.get(SESSION_COOKIE));
  if (!session) return json({ error: "unauthorized" }, { status: 401 });

  let url: string;
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
  } catch {
    return json({ error: "bad request" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return json({ error: "url must be http(s)" }, { status: 400 });
  }

  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return json({ error: "invalid url" }, { status: 400 });
  }
  if (!MAPS_HOSTS.has(host)) {
    return json({ error: "not a google maps url" }, { status: 400 });
  }

  // Already an embed URL - pass through.
  if (/\/maps\/embed/.test(url) || /output=embed/.test(url)) {
    return json({ embed: url });
  }

  let finalUrl = url;
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Without a UA Google sometimes serves an empty body.
        "User-Agent": "Mozilla/5.0 (compatible; CMSBar/1.0)",
      },
    });
    finalUrl = r.url;
    // If the redirect didn't pop us out of the short host, scrape the HTML
    // for a <meta http-equiv="refresh"> or canonical URL.
    if (new URL(finalUrl).hostname.replace(/^www\./, "") === host) {
      const html = await r.text();
      const meta = html.match(
        /<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>\s]+)/i,
      );
      if (meta) finalUrl = meta[1];
      const canonical = html.match(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
      );
      if (canonical) finalUrl = canonical[1];
    }
  } catch (err) {
    return json(
      {
        error: `Could not follow URL: ${
          err instanceof Error ? err.message : "fetch failed"
        }`,
      },
      { status: 502 },
    );
  }

  const embed = extractEmbed(finalUrl);
  if (!embed) {
    return json(
      {
        error:
          "Could not extract coordinates from that Google Maps URL. Open Google Maps, click Share → Embed a map, copy the URL from the iframe src and paste it here.",
        finalUrl,
      },
      { status: 422 },
    );
  }

  return json({ embed, finalUrl });
};
