import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { get } from '../sharepoint/rest-client.js';
import { logger } from '../utils/logger.js';

interface SitePage {
  Id: number;
  FileName: string;
  Title: string;
  AbsoluteUrl?: string;
  Url?: string;
}

interface SitePagesResponse {
  value: SitePage[];
}

export function registerFindPageTool(server: McpServer): void {
  server.tool(
    'find_modern_page',
    'Find an existing modern SharePoint page by name. Returns the page ID, title, and URL if found.',
    {
      siteUrl: z.string().describe('SharePoint site URL'),
      pageName: z.string().describe('Page file name (without .aspx)'),
    },
    async ({ siteUrl, pageName }) => {
      try {
        const name = pageName.endsWith('.aspx') ? pageName : `${pageName}.aspx`;

        const result = await get<SitePagesResponse>(
          siteUrl,
          `sitepages/pages?$filter=FileName eq '${name}'&$select=Id,FileName,Title,AbsoluteUrl,Url`,
        );

        if (result.value && result.value.length > 0) {
          const page = result.value[0];
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                found: true,
                pageId: page.Id,
                name: page.FileName,
                title: page.Title ?? null,
                url: page.AbsoluteUrl ?? page.Url ?? null,
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ found: false }, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('find_modern_page failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              found: false,
              error: message,
            }, null, 2),
          }],
        };
      }
    },
  );
}
