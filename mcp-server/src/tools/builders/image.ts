import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export function registerBuildImageTool(server: McpServer): void {
  server.tool(
    'build_image_webpart',
    'Build an Image web part JSON from an image URL for use in a modern page canvas.',
    {
      imageUrl: z.string().describe('URL of the image to display'),
      altText: z.string().optional().describe('Alternative text for accessibility'),
      captionText: z.string().optional().describe('Caption text for the image'),
      linkUrl: z.string().optional().describe('Optional URL to navigate to when the image is clicked'),
      imgWidth: z.number().optional().describe('Natural width of the image in pixels (required for proper rendering)'),
      imgHeight: z.number().optional().describe('Natural height of the image in pixels (required for proper rendering)'),
    },
    async ({ imageUrl, altText, captionText, linkUrl, imgWidth, imgHeight }) => {
      const webpart: StandardWebPart = {
        webPartType: WebPartId.IMAGE,
        data: {
          dataVersion: '1.9',
          title: 'Image',
          properties: {
            imageSourceType: 2,
            altText: '',
            captionText: '',
            overlayText: '',
            siteId: '',
            webId: '',
            listId: '',
            uniqueId: '',
            imgWidth: imgWidth ?? 0,
            imgHeight: imgHeight ?? 0,
          },
          serverProcessedContent: {
            imageSources: [{ key: 'imageSource', value: imageUrl }],
            links: linkUrl ? [{ key: 'linkUrl', value: linkUrl }] : [],
            searchablePlainTexts: [
              { key: 'captionText', value: captionText ?? '' },
              { key: 'altText', value: altText ?? '' },
            ],
          },
        },
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
