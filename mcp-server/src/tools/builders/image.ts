import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export interface ImageWebPartOptions {
  imageUrl: string;
  altText?: string;
  captionText?: string;
  linkUrl?: string;
  imgWidth?: number;
  imgHeight?: number;
  siteId?: string;
  webId?: string;
  listId?: string;
  uniqueId?: string;
  fileName?: string;
  alignment?: 'Left' | 'Center' | 'Right';
}

export function buildImageWebPart({
  imageUrl,
  altText = '',
  captionText = '',
  linkUrl = '',
  imgWidth = 0,
  imgHeight = 0,
  siteId = '',
  webId = '',
  listId = '',
  uniqueId = '',
  fileName = '',
  alignment = 'Center',
}: ImageWebPartOptions): StandardWebPart {
  const hasSourceMetadata = Boolean(siteId && webId && listId && uniqueId);

  return {
    webPartType: WebPartId.IMAGE,
    data: {
      dataVersion: '1.9',
      title: 'Image',
      description: 'Show an image on your page.',
      properties: {
        imageSourceType: 2,
        altText,
        captionText,
        linkUrl,
        overlayText: '',
        fileName,
        siteId,
        webId,
        listId,
        uniqueId,
        imgWidth,
        imgHeight,
        alignment,
        fixAspectRatio: false,
      },
      serverProcessedContent: {
        imageSources: [{ key: 'imageSource', value: imageUrl }],
        links: linkUrl ? [{ key: 'linkUrl', value: linkUrl }] : [],
        searchablePlainTexts: [
          { key: 'captionText', value: captionText },
          { key: 'altText', value: altText },
        ],
        ...(hasSourceMetadata ? {
          customMetadata: [{
            key: 'imageSource',
            value: {
              siteId,
              webId,
              listId,
              uniqueId,
              width: String(imgWidth),
              height: String(imgHeight),
            },
          }],
        } : {}),
      },
      dynamicDataPaths: {},
      dynamicDataValues: {},
    },
  };
}

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
      siteId: z.string().optional().describe('Source site collection GUID for a same-site uploaded image'),
      webId: z.string().optional().describe('Source web GUID for a same-site uploaded image'),
      listId: z.string().optional().describe('Source library GUID for a same-site uploaded image'),
      uniqueId: z.string().optional().describe('Source file GUID for a same-site uploaded image'),
      fileName: z.string().optional().describe('Source file name'),
      alignment: z.enum(['Left', 'Center', 'Right']).default('Center').describe('Image alignment'),
    },
    async (options) => {
      const webpart = buildImageWebPart(options);
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
