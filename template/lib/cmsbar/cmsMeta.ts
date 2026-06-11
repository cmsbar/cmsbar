const CMS_META_RE = /<!--\s*cms-meta:\s*(\{[^}]*\})\s*-->/;

export type CmsMeta = { pagePath?: string };

export function parseCmsMeta(body: string | null | undefined): CmsMeta {
  if (!body) return {};
  const m = CMS_META_RE.exec(body);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as CmsMeta;
  } catch {
    return {};
  }
}

export function buildCmsMetaMarker(meta: CmsMeta): string {
  return `<!-- cms-meta: ${JSON.stringify(meta)} -->`;
}
