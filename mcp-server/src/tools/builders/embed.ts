import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId, GA_WHITELIST } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/.test(url);
}

function isSharePointUrl(url: string): boolean {
  return /\.sharepoint\.com/.test(url);
}

export function registerBuildEmbedTool(server: McpServer): void {
  server.tool(
    'build_embed_webpart',
    'Build an Embed web part JSON from a URL or embed code for use in a modern page canvas.',
    {
      embedUrl: z.string().describe('URL to embed (e.g., YouTube, Stream, or other oEmbed-compatible URL)'),
      embedType: z.enum(['iframe', 'video', 'document', 'other']).default('other').describe('Type of embed content'),
    },
    async ({ embedUrl, embedType }) => {
      const warnings: string[] = [];

      if (isYouTubeUrl(embedUrl)) {
        const videoId = extractYouTubeVideoId(embedUrl) ?? '';
        const webpart: StandardWebPart = {
          webPartType: WebPartId.YOUTUBE,
          data: {
            dataVersion: '1.1',
            title: 'YouTube',
            properties: {
              embedCode: `<iframe src="https://www.youtube.com/embed/${videoId}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>`,
              videoId,
              videoTitle: '',
            },
          },
        };
        if (!GA_WHITELIST.includes(WebPartId.YOUTUBE)) {
          warnings.push('This web part type is not in the Graph API v1.0 whitelist. You may need to use the beta endpoint.');
        }
        const result = warnings.length > 0 ? { webpart, warnings } : webpart;
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      if (embedType === 'document' && isSharePointUrl(embedUrl)) {
        const webpart: StandardWebPart = {
          webPartType: WebPartId.DOCUMENT_EMBED,
          data: {
            dataVersion: '1.0',
            title: 'Document',
            properties: {
              file: '',
              startPage: 1,
              wopiWebUrl: '',
            },
            serverProcessedContent: {
              links: [{ key: 'file', value: embedUrl }],
            },
          },
        };
        if (!GA_WHITELIST.includes(WebPartId.DOCUMENT_EMBED)) {
          warnings.push('This web part type is not in the Graph API v1.0 whitelist. You may need to use the beta endpoint.');
        }
        const result = warnings.length > 0 ? { webpart, warnings } : webpart;
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      // Generic embed
      const webpart: StandardWebPart = {
        webPartType: WebPartId.EMBED,
        data: {
          dataVersion: '1.2',
          title: 'Embed',
          properties: {
            embedCode: `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0"></iframe>`,
            cachedEmbedCode: '',
            shouldScaleWidth: true,
            tempState: {},
          },
        },
      };
      if (!GA_WHITELIST.includes(WebPartId.EMBED)) {
        warnings.push('This web part type is not in the Graph API v1.0 whitelist. You may need to use the beta endpoint.');
      }
      const result = warnings.length > 0 ? { webpart, warnings } : webpart;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
