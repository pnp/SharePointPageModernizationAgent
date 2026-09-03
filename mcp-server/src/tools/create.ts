import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { post as restPost } from '../sharepoint/rest-client.js';
import { canvasLayoutToCanvasContent1 } from '../sharepoint/canvas-converter.js';
import type { CanvasLayout } from '../sharepoint/canvas-converter.js';
import { logger } from '../utils/logger.js';
import { retryOperation } from '../utils/retry.js';

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  oneColumn: 1,
  twoColumns: 2,
  threeColumns: 3,
  oneThirdLeftColumn: 2,
  oneThirdRightColumn: 2,
  fullWidth: 1,
};

function sanitizeToKebabCase(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** REST API response wrapper (odata=verbose). */
interface RestPageResponse {
  d: {
    Id: number;
    Name: string;
    Title: string;
    AbsoluteUrl?: string;
    Url?: string;
  };
}

export function registerCreatePageTool(server: McpServer): void {
  server.tool(
    'create_modern_page',
    'Create a new modern SharePoint page via SharePoint REST API. Returns the created page metadata including its ID.',
    {
      siteUrl: z.string().describe('SharePoint site URL'),
      title: z.string().describe('Page title'),
      pageName: z.string().optional().describe('Page file name (without .aspx). Defaults to "migrated-{title}"'),
      pageLayout: z.enum(['article', 'home']).default('article'),
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
      }).describe('Canvas layout with sections, columns, and web parts'),
      useBetaApi: z.boolean().default(false).describe('Use beta Graph API endpoint (needed for some web part types)'),
      titleArea: z.object({
        enableGradientEffect: z.boolean().optional(),
        imageWebUrl: z.string().optional(),
        layout: z.enum(['plain', 'imageAndTitle', 'overlap', 'colorBlock']).optional(),
        showAuthor: z.boolean().optional(),
        showPublishedDate: z.boolean().optional(),
        showTextBlockAboveTitle: z.boolean().optional(),
        textAboveTitle: z.string().optional(),
        textAlignment: z.enum(['left', 'center']).optional(),
        title: z.string().optional(),
      }).optional().describe('Title area configuration (author display, banner image, layout)'),
    },
    async ({ siteUrl, title, pageName, pageLayout, canvasLayout, titleArea }) => {
      const warnings: string[] = [];

      try {
        // Soft validation: column counts vs layout
        for (const section of canvasLayout.horizontalSections) {
          const expected = EXPECTED_COLUMN_COUNTS[section.layout];
          if (expected !== undefined && section.columns.length !== expected) {
            warnings.push(
              `Section layout '${section.layout}' expects ${expected} column(s) but got ${section.columns.length}`,
            );
          }
        }

        const name = pageName
          ? (pageName.endsWith('.aspx') ? pageName : `${pageName}.aspx`)
          : `migrated-${sanitizeToKebabCase(title)}.aspx`;

        // Convert Graph canvasLayout to REST CanvasContent1
        const canvasContent = canvasLayoutToCanvasContent1(canvasLayout as CanvasLayout);

        // Step 1: Create the page via REST API
        const createBody = {
          __metadata: { type: 'SP.Publishing.SitePage' },
          Name: name,
          Title: title,
          PageLayoutType: pageLayout === 'home' ? 'Home' : 'Article',
          PromotedState: 0,
        };

        logger.info('Creating modern page via REST API', { siteUrl, name, title });
        const createResult = await restPost<RestPageResponse>(
          siteUrl,
          'sitepages/pages',
          createBody,
        );

        const pageId = createResult.d.Id;
        const pageUrl = createResult.d.AbsoluteUrl || createResult.d.Url || null;

        // Step 2: Save canvas content
        const saveBody = {
          __metadata: { type: 'SP.Publishing.SitePage' },
          CanvasContent1: canvasContent,
        };

        // Include title area properties if provided
        if (titleArea) {
          if (titleArea.textAboveTitle) {
            (saveBody as Record<string, unknown>).TopicHeader = titleArea.textAboveTitle;
          }
        }

        logger.info('Saving page content via REST API', { pageId });
        await retryOperation(
          'create_modern_page SavePage',
          () => restPost(
            siteUrl,
            `sitepages/pages(${pageId})/SavePage`,
            saveBody,
          ),
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              pageId,
              pageUrl,
              webUrl: pageUrl,
              status: 'draft',
              warnings,
            }, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('create_modern_page failed', { error: message });
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
