import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { post as restPost } from '../sharepoint/rest-client.js';
import { canvasLayoutToCanvasContent1 } from '../sharepoint/canvas-converter.js';
import type { CanvasLayout } from '../sharepoint/canvas-converter.js';
import { logger } from '../utils/logger.js';

export function registerUpdatePageTool(server: McpServer): void {
  server.tool(
    'update_modern_page',
    'Update an existing modern SharePoint page with new canvas content via SharePoint REST API.',
    {
      siteUrl: z.string().describe('SharePoint site URL'),
      pageId: z.string().describe('Page ID returned from create_modern_page'),
      canvasLayout: z.object({
        horizontalSections: z.array(z.object({
          layout: z.enum(['oneColumn', 'twoColumns', 'threeColumns', 'oneThirdLeftColumn', 'oneThirdRightColumn', 'fullWidth']),
          emphasis: z.enum(['none', 'neutral', 'soft', 'strong']).optional(),
          columns: z.array(z.object({
            id: z.string().optional(),
            width: z.number().optional(),
            webparts: z.array(z.any()),
          })),
        })),
      }).optional().describe('Canvas layout with sections, columns, and web parts'),
      title: z.string().optional().describe('Updated page title'),
      titleArea: z.any().optional().describe('Updated title area configuration'),
      useBetaApi: z.boolean().default(false).describe('Unused legacy parameter, kept for backward compatibility'),
    },
    async ({ siteUrl, pageId, canvasLayout, title }) => {
      const warnings: string[] = [];

      try {
        const saveBody: Record<string, unknown> = {
          __metadata: { type: 'SP.Publishing.SitePage' },
        };

        if (title !== undefined) {
          saveBody.Title = title;
        }

        if (canvasLayout !== undefined) {
          saveBody.CanvasContent1 = canvasLayoutToCanvasContent1(canvasLayout as CanvasLayout);
        }

        logger.info('Updating page via REST API SavePage', { siteUrl, pageId });

        try {
          await restPost(
            siteUrl,
            `sitepages/pages(${pageId})/SavePage`,
            saveBody,
          );
        } catch (saveError: unknown) {
          const saveMsg = saveError instanceof Error ? saveError.message : String(saveError);
          // Auto-retry on 409 editing session conflicts by discarding the checkout first
          if (saveMsg.includes('409') || saveMsg.includes('editing session')) {
            logger.info('SavePage got 409 conflict, discarding checkout and retrying', { pageId });
            warnings.push('Page had an active editing session. Discarded checkout and retried.');
            try {
              await restPost(siteUrl, `sitepages/pages(${pageId})/discardPage`, {});
            } catch (discardErr: unknown) {
              // discardPage may fail if there's no checkout — that's OK, try checkoutPage
              logger.info('discardPage call result (may be expected to fail)', {
                error: discardErr instanceof Error ? discardErr.message : String(discardErr),
              });
            }
            // Checkout the page to acquire edit lock
            try {
              await restPost(siteUrl, `sitepages/pages(${pageId})/checkoutPage`, {});
            } catch (checkoutErr: unknown) {
              logger.info('checkoutPage call result', {
                error: checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr),
              });
            }
            // Retry the SavePage
            await restPost(
              siteUrl,
              `sitepages/pages(${pageId})/SavePage`,
              saveBody,
            );
          } else {
            throw saveError;
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              pageId,
              status: 'draft_updated',
              warnings,
            }, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('update_modern_page failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: message,
              warnings,
            }, null, 2),
          }],
        };
      }
    },
  );
}
