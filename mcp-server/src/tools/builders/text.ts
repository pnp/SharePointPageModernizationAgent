import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TextWebPart } from '../../types/modern.js';
import { cleanWikiHtml } from '../../utils/html-sanitizer.js';
import { transformHtml } from '../../utils/html-transformator.js';

export function registerBuildTextTool(server: McpServer): void {
  server.tool(
    'build_text_webpart',
    'Build a Text web part JSON from sanitized HTML content for use in a modern page canvas. Applies PnP-style HTML transformation (heading shift, RTE class mapping, table modernization) before wrapping. Images are kept as inline RTE images.',
    {
      innerHtml: z.string().describe('Sanitized HTML content for the text web part'),
      sourceUrl: z.string().optional().describe('Source site URL for resolving relative image URLs to absolute (e.g., https://tenant.sharepoint.com/sites/sourceSite)'),
    },
    async ({ innerHtml, sourceUrl }) => {
      const cleaned = cleanWikiHtml(innerHtml);
      const transformed = transformHtml(cleaned.html, sourceUrl);
      const webpart: TextWebPart = {
        '@odata.type': '#microsoft.graph.textWebPart',
        innerHtml: transformed,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
