import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { get } from '../sharepoint/rest-client.js';
import { logger } from '../utils/logger.js';

interface SPListInfo {
  Id: string;
  Title: string;
  RootFolder?: { ServerRelativeUrl: string };
  DefaultView?: { Id: string };
}

export function registerResolveListTool(server: McpServer): void {
  server.tool(
    'resolve_list_info',
    'Get the list ID, default view ID, and server-relative URL for a SharePoint list or library by title. Use this when building List web parts to resolve destination-site GUIDs.',
    {
      siteUrl: z.string().describe('SharePoint site URL (e.g., https://contoso.sharepoint.com/sites/team)'),
      listTitle: z.string().describe('List or library title (e.g., "Site Pages", "Documents", "Pages")'),
    },
    async ({ siteUrl, listTitle }) => {
      try {
        const encodedTitle = listTitle.replace(/'/g, "''");
        const apiPath = `web/lists/getByTitle('${encodedTitle}')?$select=Id,Title,RootFolder/ServerRelativeUrl,DefaultView/Id&$expand=RootFolder,DefaultView`;

        logger.info('Resolving list info', { siteUrl, listTitle });
        const data = await get<SPListInfo>(siteUrl, apiPath);

        const result = {
          success: true,
          listId: data.Id,
          listTitle: data.Title,
          selectedListUrl: data.RootFolder?.ServerRelativeUrl ?? '',
          defaultViewId: data.DefaultView?.Id ?? '',
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('resolve_list_info failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: message,
            }, null, 2),
          }],
        };
      }
    },
  );
}
