import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../utils/logger.js';

/**
 * Build a Video web part JSON from a video URL for use in a modern page canvas.
 *
 * The Video web part (GUID 275c0095-a77e-4f6d-a2a0-6a7626911518) is designed for:
 * - SharePoint video files (.mp4, .mov, .wmv, etc.)
 * - External video URLs (direct links to .mp4, etc.)
 * - Office 365 Video
 * - Microsoft Stream videos
 *
 * For YouTube/Vimeo/other embedded videos, use build_embed_webpart instead.
 */

export const buildVideoWebPartSchema = z.object({
  videoUrl: z.string().describe('URL of the video to display. Can be a SharePoint site-relative URL, absolute URL, or external video URL.'),
  previewImageUrl: z.string().optional().describe('Optional preview/thumbnail image URL'),
  width: z.number().optional().describe('Video width in pixels (default: 640)'),
  height: z.number().optional().describe('Video height in pixels (default: 360)'),
  autoPlay: z.boolean().optional().describe('Whether to auto-play the video (default: false)'),
  showInfo: z.boolean().optional().describe('Whether to show video information overlay (default: true)'),
});

export type BuildVideoWebPartInput = z.infer<typeof buildVideoWebPartSchema>;

export function buildVideoWebPart(input: BuildVideoWebPartInput) {
  const {
    videoUrl,
    previewImageUrl,
    width = 640,
    height = 360,
    autoPlay = false,
    showInfo = true,
  } = input;

  // Video web part structure for Graph API
  return {
    webPartType: '275c0095-a77e-4f6d-a2a0-6a7626911518',
    title: '',
    dataVersion: '1.0',
    properties: {
      title: '',
      videoUrl,
      previewImageUrl: previewImageUrl ?? '',
      width,
      height,
      autoPlay,
      showInfo,
    },
    serverProcessedContent: {
      htmlStrings: [],
      searchablePlainTexts: [],
      imageSources: previewImageUrl
        ? [{ key: 'previewImageUrl', value: previewImageUrl }]
        : [],
      links: [{ key: 'videoUrl', value: videoUrl }],
    },
  };
}

export function registerBuildVideoTool(server: McpServer) {
  server.tool(
    'build_video_webpart',
    'Build a Video web part JSON from a video URL for use in a modern page canvas.',
    {
      videoUrl: z.string().describe('URL of the video to display. Can be a SharePoint site-relative URL, absolute URL, or external video URL.'),
      previewImageUrl: z.string().optional().describe('Optional preview/thumbnail image URL'),
      width: z.number().optional().describe('Video width in pixels (default: 640)'),
      height: z.number().optional().describe('Video height in pixels (default: 360)'),
      autoPlay: z.boolean().optional().describe('Whether to auto-play the video (default: false)'),
      showInfo: z.boolean().optional().describe('Whether to show video information overlay (default: true)'),
    },
    async (input: BuildVideoWebPartInput) => {
      logger.info('Building Video web part', { videoUrl: input.videoUrl });
      const webPart = buildVideoWebPart(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(webPart, null, 2) }],
      };
    }
  );
}
