import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId, GA_WHITELIST } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export function registerBuildAnyWebPartTool(server: McpServer): void {
  server.tool(
    'build_any_webpart',
    'Build an arbitrary standard web part JSON by specifying the web part type ID and properties directly. Use this for web parts without a dedicated builder.',
    {
      webPartType: z.string().describe('Web part type GUID (e.g., "c70391ea-0b10-4ee9-b2b4-006d3fcad0cd" for Quick Links)'),
      dataVersion: z.string().default('1.0').describe('Data version string'),
      title: z.string().default('').describe('Web part title'),
      properties: z.record(z.string(), z.unknown()).describe('Web part properties object'),
      serverProcessedContent: z.object({
        htmlStrings: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
        searchablePlainTexts: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
        imageSources: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
        links: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
      }).optional().describe('Server-processed content for links, images, etc. Uses {key, value} array format.'),
    },
    async ({ webPartType, dataVersion, title, properties, serverProcessedContent }) => {
      const warnings: string[] = [];
      if (!GA_WHITELIST.includes(webPartType)) {
        warnings.push('This web part type is not in the Graph API v1.0 whitelist. You may need to use the beta endpoint.');
      }
      const knownGuids = Object.values(WebPartId) as string[];
      if (!knownGuids.includes(webPartType)) {
        warnings.push('This GUID is not in the known web part catalog. Verify it is a valid SPFx component ID.');
      }

      const webpart: StandardWebPart = {
        webPartType,
        data: {
          dataVersion,
          title,
          properties,
          serverProcessedContent: serverProcessedContent ?? undefined,
        },
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ webpart, warnings }, null, 2) }] };
    },
  );
}
