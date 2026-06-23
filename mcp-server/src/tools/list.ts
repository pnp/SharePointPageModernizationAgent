import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { get } from '../sharepoint/rest-client.js';
import { logger } from '../utils/logger.js';

interface SPPageItem {
  Id: number;
  Title?: string;
  FileLeafRef: string;
  WikiField?: string;
  Modified?: string;
  ContentType?: { Name?: string };
  Author?: { Title?: string; EMail?: string };
  ServerRelativeUrl?: string;
  File?: { ServerRelativeUrl?: string };
}

interface PageListEntry {
  pageName: string;
  title: string;
  library: 'SitePages' | 'Pages';
  pageType: 'wiki' | 'webpart' | 'publishing' | 'modern';
  id: number;
  modified: string | null;
  author: string | null;
  serverRelativeUrl: string | null;
}

function detectPageType(
  item: SPPageItem,
  library: 'SitePages' | 'Pages',
): 'wiki' | 'webpart' | 'publishing' | 'modern' {
  // Pages library items are publishing pages
  if (library === 'Pages') {
    return 'publishing';
  }

  // Wiki pages have a WikiField
  if (item.WikiField != null) {
    return 'wiki';
  }

  // Heuristic: modern pages typically have ContentType "Site Page" or "Repost Page"
  const ctName = item.ContentType?.Name ?? '';
  if (ctName === 'Site Page' || ctName === 'Repost Page') {
    return 'modern';
  }

  // Default to webpart page for SitePages items without WikiField
  return 'webpart';
}

async function queryLibrary(
  siteUrl: string,
  listTitle: string,
  library: 'SitePages' | 'Pages',
  includeModernPages: boolean,
): Promise<PageListEntry[]> {
  // WikiField only exists on SitePages, not Pages (publishing)
  const baseFields = [
    'Id',
    'Title',
    'FileLeafRef',
    'Modified',
    'ContentType/Name',
    'Author/Title',
    'Author/EMail',
    'File/ServerRelativeUrl',
  ];

  const selectFields = library === 'SitePages'
    ? [...baseFields, 'WikiField'].join(',')
    : baseFields.join(',');

  const apiPath = `web/lists/getbytitle('${listTitle}')/items?$select=${selectFields}&$expand=ContentType,Author,File&$top=5000`;

  const result = await get<{ value: SPPageItem[] }>(siteUrl, apiPath);
  const items = result.value ?? [];

  const entries: PageListEntry[] = [];
  for (const item of items) {
    const pageType = detectPageType(item, library);

    // Skip modern pages unless explicitly requested
    if (pageType === 'modern' && !includeModernPages) {
      continue;
    }

    entries.push({
      pageName: item.FileLeafRef,
      title: item.Title ?? item.FileLeafRef,
      library,
      pageType,
      id: item.Id,
      modified: item.Modified ?? null,
      author: item.Author?.Title ?? null,
      serverRelativeUrl: item.File?.ServerRelativeUrl ?? null,
    });
  }

  return entries;
}

export function registerListPagesTool(server: McpServer): void {
  server.tool(
    'list_site_pages',
    'List all pages in a SharePoint site. Queries SitePages and/or Pages libraries and returns page metadata including type classification (wiki, webpart, publishing, modern).',
    {
      siteUrl: z.string().describe('SharePoint site URL (e.g., https://contoso.sharepoint.com/sites/team)'),
      library: z.enum(['SitePages', 'Pages', 'both']).default('both').describe('Which library to query (default: both)'),
      includeModernPages: z.boolean().default(false).describe('Include modern pages in the results (default: false)'),
    },
    async ({ siteUrl, library, includeModernPages }) => {
      try {
        const normalizedSiteUrl = siteUrl.replace(/\/$/, '');
        logger.info('Listing site pages', { siteUrl: normalizedSiteUrl, library, includeModernPages });

        const allPages: PageListEntry[] = [];
        const libraries: Record<string, { queried: boolean; count: number; error?: string }> = {};

        // Query SitePages
        if (library === 'SitePages' || library === 'both') {
          try {
            const pages = await queryLibrary(normalizedSiteUrl, 'Site Pages', 'SitePages', includeModernPages);
            allPages.push(...pages);
            libraries['SitePages'] = { queried: true, count: pages.length };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('Could not query SitePages library', { error: message });
            libraries['SitePages'] = { queried: true, count: 0, error: message };
          }
        }

        // Query Pages (publishing) — wrapped in try/catch since not all sites have it
        if (library === 'Pages' || library === 'both') {
          try {
            const pages = await queryLibrary(normalizedSiteUrl, 'Pages', 'Pages', includeModernPages);
            allPages.push(...pages);
            libraries['Pages'] = { queried: true, count: pages.length };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('Could not query Pages library', { error: message });
            libraries['Pages'] = { queried: true, count: 0, error: message };
          }
        }

        // Derive site name from URL path
        const sitePath = new URL(normalizedSiteUrl).pathname.replace(/^\/|\/$/g, '');
        const siteName = sitePath || 'root';

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              siteUrl: normalizedSiteUrl,
              siteName,
              pages: allPages,
              totalCount: allPages.length,
              libraries,
            }, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('list_site_pages failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: message }, null, 2),
          }],
        };
      }
    },
  );
}
