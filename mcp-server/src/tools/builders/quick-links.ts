import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export interface QuickLink {
  title: string;
  url: string;
  description?: string;
  imageUrl?: string;
}

export interface QuickLinksOptions {
  title?: string;
  links: QuickLink[];
  layoutId?: 'CompactCard' | 'FilmStrip' | 'Grid' | 'Button' | 'List' | 'Waffle';
}

export function buildQuickLinksWebPart({
  title = 'Quick Links',
  links,
  layoutId = 'List',
}: QuickLinksOptions): StandardWebPart {
  const webPartTitle = title.trim() || 'Quick Links';
  const imageSources = links
    .map((link, i) => link.imageUrl ? { key: `items[${i}].rawPreviewImageUrl`, value: link.imageUrl } : null)
    .filter((x): x is { key: string; value: string } => x !== null);

  return {
    webPartType: WebPartId.QUICK_LINKS,
    data: {
      dataVersion: '2',
      title: webPartTitle,
      properties: {
        title: webPartTitle,
        items: links.map((link, i) => ({
          sourceItem: {
            itemType: 2,
            fileExtension: '',
            progId: '',
          },
          thumbnailType: link.imageUrl ? 3 : 2,
          id: i + 1,
          description: link.description ?? '',
          title: '',
          rawPreviewImageUrl: link.imageUrl ?? '',
        })),
        isMigrated: true,
        layoutId,
        shouldShowThumbnail: true,
        hideWebPartWhenEmpty: true,
        dataProviderId: 'QuickLinks',
      },
      serverProcessedContent: {
        searchablePlainTexts: [
          { key: 'title', value: webPartTitle },
          ...links.flatMap((link, i) => [
            { key: `items[${i}].title`, value: link.title },
            { key: `items[${i}].description`, value: link.description ?? '' },
          ]),
        ],
        links: links.map((link, i) => ({
          key: `items[${i}].sourceItem.url`,
          value: link.url,
        })),
        ...(imageSources.length > 0 ? { imageSources } : {}),
      },
    },
  };
}

export function registerBuildQuickLinksTool(server: McpServer): void {
  server.tool(
    'build_quick_links_webpart',
    'Build a Quick Links web part JSON from a visible heading and link items for use in a modern page canvas. Use layoutId "List" to show descriptions beneath each link title. Other layouts (CompactCard, Button, Waffle) only show titles.',
    {
      title: z.string().default('Quick Links').describe('Visible Quick Links web part heading'),
      links: z.array(
        z.object({
          title: z.string().describe('Link display text'),
          url: z.string().describe('Link URL'),
          description: z.string().optional().describe('Optional link description (visible in List layout)'),
          imageUrl: z.string().optional().describe('Optional thumbnail image URL. When provided, sets thumbnailType:3 (custom image). Use a URL accessible to SharePoint users, ideally hosted on the same tenant.'),
        }),
      ).describe('Array of links to include in the Quick Links web part'),
      layoutId: z.enum(['CompactCard', 'FilmStrip', 'Grid', 'Button', 'List', 'Waffle']).default('List').describe('Quick Links layout style. Use "List" to show descriptions beneath link titles; other layouts (CompactCard, Button, Waffle) show titles only.'),
    },
    async ({ title, links, layoutId }) => {
      const webpart = buildQuickLinksWebPart({ title, links, layoutId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
