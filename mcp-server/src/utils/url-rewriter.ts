export interface UrlMapping {
  sourceUrl: string;
  destUrl: string;
}

export interface RewriteResult {
  content: string;
  replacements: Array<{ original: string; replacement: string; count: number }>;
  totalReplacements: number;
}

/**
 * Rewrite URLs in HTML/text content using explicit mappings and path-based substitution.
 *
 * Processing order:
 * 1. Explicit URL mappings (longest first to avoid partial matches)
 * 2. Path-based substitution (sourceSitePath → destSitePath) for remaining references
 */
export function rewriteUrls(
  content: string,
  urlMap: UrlMapping[],
  sourceSitePath?: string,
  destSitePath?: string,
): RewriteResult {
  const replacements: RewriteResult['replacements'] = [];
  let result = content;

  // 1. Apply explicit URL mappings (longest first)
  const sorted = [...urlMap].sort((a, b) => b.sourceUrl.length - a.sourceUrl.length);
  for (const { sourceUrl, destUrl } of sorted) {
    if (!sourceUrl || sourceUrl === destUrl) continue;
    // Also try URL-encoded and decoded variants
    // Try decoded and encoded variants to handle both directions:
    // - decoded: sourceUrl="/foo/My%20Page" → decoded="/foo/My Page" matches literal spaces in content
    // - encoded: sourceUrl="/foo/My Page" → encoded="/foo/My%20Page" matches percent-encoded content
    // If sourceUrl is already encoded, encodeURI may double-encode (%20→%2520) but that variant
    // simply won't match anything in the content, so it's harmless.
    const variants = new Set([sourceUrl, decodeURIComponent(sourceUrl), encodeURI(sourceUrl)]);
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      const matches = result.match(re);
      if (matches && matches.length > 0) {
        result = result.replace(re, destUrl);
        replacements.push({ original: variant, replacement: destUrl, count: matches.length });
      }
    }
  }

  // 2. Path-based substitution
  if (sourceSitePath && destSitePath && sourceSitePath !== destSitePath) {
    const srcPath = sourceSitePath.replace(/\/$/, '');
    const dstPath = destSitePath.replace(/\/$/, '');

    // Try with trailing slash first (more specific), then without
    for (const suffix of ['/', '']) {
      const from = srcPath + suffix;
      const to = dstPath + suffix;
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      const matches = result.match(re);
      if (matches && matches.length > 0) {
        result = result.replace(re, to);
        replacements.push({ original: from, replacement: to, count: matches.length });
      }
    }
  }

  const totalReplacements = replacements.reduce((sum, r) => sum + r.count, 0);
  return { content: result, replacements, totalReplacements };
}
