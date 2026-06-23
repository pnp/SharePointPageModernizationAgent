import * as cheerio from 'cheerio';
import type { ClassicPageBundle } from '../types/classic.js';

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.css', '.js',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);
const CSS_EXTS = new Set(['.css']);
const JS_EXTS = new Set(['.js']);
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.eot', '.otf']);

export interface DiscoveredAsset {
  url: string;
  absoluteUrl: string;
  type: 'image' | 'css' | 'js' | 'font' | 'document' | 'other';
  source: string;
}

export interface AssetInventory {
  assets: DiscoveredAsset[];
  totalCount: number;
  byType: Record<string, number>;
  crossTenantAssets: DiscoveredAsset[];
  sameTenantAssets: DiscoveredAsset[];
}

function getExtension(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const lastDot = clean.lastIndexOf('.');
  if (lastDot < 0) return '';
  return clean.substring(lastDot).toLowerCase();
}

function classifyType(url: string): DiscoveredAsset['type'] {
  const ext = getExtension(url);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (CSS_EXTS.has(ext)) return 'css';
  if (JS_EXTS.has(ext)) return 'js';
  if (FONT_EXTS.has(ext)) return 'font';
  if (ASSET_EXTENSIONS.has(ext)) return 'document';
  return 'other';
}

function resolveUrl(url: string, siteOrigin: string, sitePath: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('#')) {
    return null;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${siteOrigin}${url}`;
  // Relative URL — resolve against site path
  return `${siteOrigin}${sitePath}/${url}`;
}

function isAssetUrl(url: string): boolean {
  const ext = getExtension(url);
  return ASSET_EXTENSIONS.has(ext);
}

/** Extract asset URLs from HTML string using cheerio. */
function extractFromHtml(html: string, sourceLabel: string, siteOrigin: string, sitePath: string): DiscoveredAsset[] {
  if (!html || html.length < 5) return [];
  const assets: DiscoveredAsset[] = [];
  const seen = new Set<string>();

  const $ = cheerio.load(html, { xml: { xmlMode: false } });

  // <img src>, <script src>, <link href>, <a href> (for document links)
  const attrSelectors: Array<{ selector: string; attr: string }> = [
    { selector: 'img[src]', attr: 'src' },
    { selector: 'script[src]', attr: 'src' },
    { selector: 'link[href]', attr: 'href' },
    { selector: '[data-imageurl]', attr: 'data-imageurl' },
    { selector: '[data-src]', attr: 'data-src' },
  ];

  for (const { selector, attr } of attrSelectors) {
    $(selector).each((_i, el) => {
      const raw = $(el).attr(attr);
      if (!raw) return;
      const abs = resolveUrl(raw, siteOrigin, sitePath);
      if (!abs || !isAssetUrl(abs)) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      assets.push({ url: raw, absoluteUrl: abs, type: classifyType(abs), source: sourceLabel });
    });
  }

  // <a href> for documents only (not .aspx pages)
  $('a[href]').each((_i, el) => {
    const raw = $(el).attr('href');
    if (!raw) return;
    const ext = getExtension(raw);
    if (!ext || ext === '.aspx' || ext === '.html' || ext === '.htm') return;
    const abs = resolveUrl(raw, siteOrigin, sitePath);
    if (!abs || !isAssetUrl(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    assets.push({ url: raw, absoluteUrl: abs, type: classifyType(abs), source: sourceLabel });
  });

  // Inline style background-image: url(...)
  $('[style]').each((_i, el) => {
    const style = $(el).attr('style') || '';
    const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let m;
    while ((m = urlRe.exec(style)) !== null) {
      const raw = m[1];
      const abs = resolveUrl(raw, siteOrigin, sitePath);
      if (!abs || !isAssetUrl(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      assets.push({ url: raw, absoluteUrl: abs, type: classifyType(abs), source: sourceLabel });
    }
  });

  return assets;
}

/**
 * Discover all referenced assets in a classic page bundle.
 * Returns a structured inventory classified by type and cross-tenant status.
 */
export function discoverAssets(
  bundle: ClassicPageBundle,
  sourceSiteUrl: string,
  destSiteUrl?: string,
): AssetInventory {
  const siteOrigin = new URL(sourceSiteUrl).origin;
  const sitePath = new URL(sourceSiteUrl).pathname.replace(/\/$/, '');
  const destHost = destSiteUrl ? new URL(destSiteUrl).hostname : null;
  const sourceHost = new URL(sourceSiteUrl).hostname;

  const allAssets: DiscoveredAsset[] = [];
  const seen = new Set<string>();

  function addAssets(newAssets: DiscoveredAsset[]) {
    for (const asset of newAssets) {
      if (seen.has(asset.absoluteUrl)) continue;
      seen.add(asset.absoluteUrl);
      allAssets.push(asset);
    }
  }

  // Scan wikiHtml
  if (bundle.wikiHtml) {
    addAssets(extractFromHtml(bundle.wikiHtml, 'wikiHtml', siteOrigin, sitePath));
  }

  // Scan wiki zones
  if (bundle.wikiZones) {
    for (const zone of bundle.wikiZones) {
      if (zone.html) {
        addAssets(extractFromHtml(zone.html, 'wikiZone', siteOrigin, sitePath));
      }
    }
  }

  // Scan publishing fields that contain HTML
  if (bundle.publishingFields) {
    const htmlFields = ['PublishingPageContent', 'PublishingPageImage', 'PublishingRollupImage', 'SummaryLinks'];
    for (const field of htmlFields) {
      const val = bundle.publishingFields[field];
      if (val && val.length > 10) {
        addAssets(extractFromHtml(val, `publishingField:${field}`, siteOrigin, sitePath));
      }
    }
  }

  // Scan publishing layout HTML
  if (bundle.publishingLayoutHtml) {
    addAssets(extractFromHtml(bundle.publishingLayoutHtml, 'publishingLayout', siteOrigin, sitePath));
  }

  // Scan web part resolved HTML
  if (bundle.webParts) {
    for (const wp of bundle.webParts) {
      if (wp.resolvedHtml) {
        const label = `webPart:${wp.typeName || wp.title || 'unknown'}`;
        addAssets(extractFromHtml(wp.resolvedHtml, label, siteOrigin, sitePath));
      }
    }
  }

  // Classify cross-tenant vs same-tenant
  const crossTenantAssets: DiscoveredAsset[] = [];
  const sameTenantAssets: DiscoveredAsset[] = [];
  for (const asset of allAssets) {
    if (destHost && destHost !== sourceHost) {
      const assetHost = new URL(asset.absoluteUrl).hostname;
      if (assetHost === sourceHost) {
        crossTenantAssets.push(asset);
      } else {
        sameTenantAssets.push(asset);
      }
    } else {
      sameTenantAssets.push(asset);
    }
  }

  const byType: Record<string, number> = {};
  for (const asset of allAssets) {
    byType[asset.type] = (byType[asset.type] || 0) + 1;
  }

  return {
    assets: allAssets,
    totalCount: allAssets.length,
    byType,
    crossTenantAssets,
    sameTenantAssets,
  };
}
