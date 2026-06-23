import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export function registerBuildDividerTool(server: McpServer): void {
  server.tool(
    'build_divider_webpart',
    'Build a Divider (horizontal rule) web part JSON for use in a modern page canvas.',
    {
      showLine: z.boolean().default(true).describe('Whether to show the divider line'),
    },
    async ({ showLine }) => {
      const webpart: StandardWebPart = {
        webPartType: WebPartId.DIVIDER,
        data: {
          dataVersion: '2.1',
          title: 'Divider',
          properties: showLine ? {} : { isHidden: true },
        },
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
