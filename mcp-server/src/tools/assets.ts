import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { discoverAssets } from '../utils/asset-discovery.js';
import { rewriteUrls } from '../utils/url-rewriter.js';
import { downloadFileBuffer, uploadFileBuffer } from '../sharepoint/rest-client.js';
import { extractClassicPageBundle } from './extract.js';
import { logger } from '../utils/logger.js';

export function registerAssetTools(server: McpServer): void {
  // ── discover_page_assets ──

  server.tool(
    'discover_page_assets',
    'Scan a classic page for all referenced assets (images, CSS, JS, documents). Returns a structured inventory with cross-tenant classification.',
    {
      siteUrl: z.string().describe('Source SharePoint site URL'),
      pageName: z.string().describe('Page file name (e.g., Home.aspx) or library-qualified path (e.g., Pages/Home.aspx)'),
      destSiteUrl: z.string().optional().describe('Destination site URL. If provided, assets are classified as cross-tenant or same-tenant.'),
    },
    async ({ siteUrl, pageName, destSiteUrl }) => {
      try {
        const bundle = await extractClassicPageBundle(siteUrl, pageName);
        const inventory = discoverAssets(bundle, siteUrl, destSiteUrl);
        return { content: [{ type: 'text' as const, text: JSON.stringify(inventory, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('discover_page_assets failed', { error: message });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
      }
    },
  );

  // ── migrate_assets ──

  server.tool(
    'migrate_assets',
    'Download assets from a source SharePoint site and upload them to the destination site. Returns a URL mapping (source → destination) for use with rewrite_urls.',
    {
      sourceSiteUrl: z.string().describe('Source SharePoint site URL'),
      destSiteUrl: z.string().describe('Destination SharePoint site URL'),
      assets: z.array(z.object({
        sourceUrl: z.string().describe('Full URL or server-relative path of the asset on the source'),
        destFolder: z.string().optional().describe('Destination folder server-relative path (default: /sites/{siteName}/SiteAssets)'),
        destFilename: z.string().optional().describe('Destination filename (default: same as source)'),
      })).describe('Array of assets to migrate'),
    },
    async ({ sourceSiteUrl, destSiteUrl, assets }) => {
      try {
      const destSitePath = new URL(destSiteUrl).pathname.replace(/\/$/, '');
      const defaultFolder = `${destSitePath}/SiteAssets`;
      const results: Array<{ sourceUrl: string; destUrl: string; success: boolean; error?: string }> = [];

      for (const asset of assets) {
        const folder = asset.destFolder || defaultFolder;
        const filename = asset.destFilename || decodeURIComponent(asset.sourceUrl.split('/').pop() || 'unknown');

        try {
          logger.info('Migrating asset', { source: asset.sourceUrl, dest: `${folder}/${filename}` });
          const buffer = await downloadFileBuffer(sourceSiteUrl, asset.sourceUrl);
          const destUrl = await uploadFileBuffer(destSiteUrl, folder, filename, buffer);
          results.push({ sourceUrl: asset.sourceUrl, destUrl, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('Asset migration failed', { source: asset.sourceUrl, error: message });
          results.push({ sourceUrl: asset.sourceUrl, destUrl: '', success: false, error: message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ results, summary: { total: results.length, succeeded, failed } }, null, 2),
        }],
      };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('migrate_assets failed', { error: message });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
      }
    },
  );

  // ── rewrite_urls ──

  server.tool(
    'rewrite_urls',
    'Rewrite URLs in HTML or text content from source site paths to destination site paths. Use after migrating assets to update all references.',
    {
      content: z.string().describe('HTML or text content containing URLs to rewrite'),
      urlMap: z.array(z.object({
        sourceUrl: z.string().describe('Original URL (absolute or server-relative)'),
        destUrl: z.string().describe('New URL at the destination'),
      })).describe('URL mappings from migrate_assets output'),
      sourceSitePath: z.string().optional().describe('Source site server-relative path (e.g., /teams/source) for path-based rewriting'),
      destSitePath: z.string().optional().describe('Destination site server-relative path (e.g., /sites/dest) for path-based rewriting'),
    },
    async ({ content, urlMap, sourceSitePath, destSitePath }) => {
      const result = rewriteUrls(content, urlMap, sourceSitePath, destSitePath);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
