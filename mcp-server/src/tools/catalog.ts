import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId, GA_WHITELIST } from '../types/modern.js';

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  supportedOn: string[];
  inGaWhitelist: boolean;
  builderTool: string;
  propertiesSchema: Record<string, string>;
  serverProcessedContent?: Record<string, string>;
  example: Record<string, unknown>;
}

const FULL_CATALOG: CatalogEntry[] = [
  {
    id: WebPartId.IMAGE,
    name: 'Image',
    description: 'Displays an image with optional alt text, caption, overlay text, and link.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_image_webpart',
    propertiesSchema: {
      imageSourceType: 'number (2 = uploaded/site image)',
      altText: 'string — accessibility alt text',
      captionText: 'string — visible caption below image',
      overlayText: 'string — text overlay on the image',
    },
    serverProcessedContent: {
      'imageSources.imageSource': 'string — URL of the image',
      'links.linkUrl': 'string — optional click-through URL',
    },
    example: {
      webPartType: WebPartId.IMAGE,
      data: {
        dataVersion: '1.9',
        properties: { imageSourceType: 2, altText: 'Logo', captionText: '' },
        serverProcessedContent: { imageSources: { imageSource: '/sites/team/SiteAssets/logo.png' }, links: {} },
      },
    },
  },
  {
    id: WebPartId.QUICK_LINKS,
    name: 'Quick Links',
    description: 'Displays a collection of links in various layouts (CompactCard, FilmStrip, Grid, Button, List, Waffle).',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_quicklinks_webpart',
    propertiesSchema: {
      'items[]': 'array of link items',
      'items[].sourceItem.itemType': 'number (2 = link)',
      'items[].thumbnailType': 'number (2 = auto)',
      'items[].id': 'number — unique item id',
      'items[].title': 'string — link display text',
      'items[].description': 'string — optional description',
      layoutId: 'string — CompactCard | FilmStrip | Grid | Button | List | Waffle',
      dataProviderId: 'string — always "QuickLinks"',
    },
    serverProcessedContent: {
      'links["items[N].sourceItem.url"]': 'string — URL for each link item',
      'searchablePlainTexts["items[N].title"]': 'string — searchable title for each item',
    },
    example: {
      webPartType: WebPartId.QUICK_LINKS,
      data: {
        dataVersion: '2.2',
        properties: {
          layoutId: 'CompactCard',
          dataProviderId: 'QuickLinks',
          items: [{ sourceItem: { itemType: 2 }, thumbnailType: 2, id: 1, title: 'Home', description: '' }],
        },
        serverProcessedContent: {
          links: { 'items[0].sourceItem.url': 'https://contoso.sharepoint.com' },
          searchablePlainTexts: { 'items[0].title': 'Home' },
        },
      },
    },
  },
  {
    id: WebPartId.DIVIDER,
    name: 'Divider',
    description: 'Renders a horizontal divider line. No required properties.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_divider_webpart',
    propertiesSchema: {},
    example: {
      webPartType: WebPartId.DIVIDER,
      data: { dataVersion: '2.1', properties: {} },
    },
  },
  {
    id: WebPartId.DOCUMENT_EMBED,
    name: 'DocumentEmbed',
    description: 'Embeds a document (Word, Excel, PowerPoint, PDF) inline on the page.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      file: 'string — file path or name',
      siteId: 'string — GUID of the site',
      webId: 'string — GUID of the web',
      listId: 'string — GUID of the document library',
      uniqueId: 'string — GUID of the file',
    },
    serverProcessedContent: {
      'links.serverRelativeUrl': 'string — server-relative URL of the document',
    },
    example: {
      webPartType: WebPartId.DOCUMENT_EMBED,
      data: {
        dataVersion: '1.0',
        properties: { file: 'Report.docx', siteId: '', webId: '', listId: '', uniqueId: '' },
        serverProcessedContent: { links: { serverRelativeUrl: '/sites/team/Shared Documents/Report.docx' } },
      },
    },
  },
  {
    id: WebPartId.EMBED,
    name: 'Embed',
    description: 'Embeds external content via URL or embed code (iframes, oEmbed).',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_embed_webpart',
    propertiesSchema: {
      embedCode: 'string — raw HTML embed code (e.g., <iframe>)',
      cachedEmbedCode: 'string — cached version of embed code',
      shouldScaleWidth: 'boolean — scale to container width',
    },
    example: {
      webPartType: WebPartId.EMBED,
      data: {
        dataVersion: '1.0',
        properties: { embedCode: '<iframe src="https://example.com"></iframe>', cachedEmbedCode: '', shouldScaleWidth: true },
      },
    },
  },
  {
    id: WebPartId.YOUTUBE,
    name: 'YouTube',
    description: 'Embeds a YouTube video by video ID.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      embedCode: 'string — YouTube embed HTML',
      videoId: 'string — YouTube video ID',
      videoTitle: 'string — display title',
    },
    example: {
      webPartType: WebPartId.YOUTUBE,
      data: {
        dataVersion: '1.0',
        properties: { videoId: 'dQw4w9WgXcQ', videoTitle: 'Example Video', embedCode: '' },
      },
    },
  },
  {
    id: WebPartId.BUTTON,
    name: 'Button',
    description: 'Renders a clickable button with configurable text, URL, and alignment.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      buttonText: 'string — button label',
      alignment: 'string — button alignment (left, center, right)',
    },
    serverProcessedContent: {
      'links.buttonUrl': 'string — URL the button navigates to',
    },
    example: {
      webPartType: WebPartId.BUTTON,
      data: {
        dataVersion: '1.0',
        properties: { buttonText: 'Learn More', alignment: 'center' },
        serverProcessedContent: { links: { buttonUrl: 'https://contoso.sharepoint.com/sites/info' } },
      },
    },
  },
  {
    id: WebPartId.PEOPLE,
    name: 'People',
    description: 'Displays people cards with profile information.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      'persons[]': 'array of person objects with id and upn',
      layout: 'string — display layout',
      numPersonsToShow: 'number — max persons visible',
    },
    example: {
      webPartType: WebPartId.PEOPLE,
      data: {
        dataVersion: '1.0',
        properties: { persons: [], layout: 'default', numPersonsToShow: 5 },
      },
    },
  },
  {
    id: WebPartId.LIST,
    name: 'List',
    description: 'Displays a SharePoint list or library view.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      selectedListId: 'string — GUID of the list',
      selectedViewId: 'string — GUID of the view',
      listTitle: 'string — display title',
      selectedListUrl: 'string — server-relative URL of the list',
    },
    example: {
      webPartType: WebPartId.LIST,
      data: {
        dataVersion: '1.0',
        properties: { selectedListId: '', selectedViewId: '', listTitle: 'Documents', selectedListUrl: '' },
      },
    },
  },
  {
    id: WebPartId.HERO,
    name: 'Hero',
    description: 'Large hero banner with images, titles, and call-to-action links. Supports multiple layouts.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      heroLayoutThreshold: 'number — layout threshold',
      'items[]': 'array of hero items with title, image, and link',
    },
    example: {
      webPartType: WebPartId.HERO,
      data: { dataVersion: '1.0', properties: { heroLayoutThreshold: 1 } },
    },
  },
  {
    id: WebPartId.HIGHLIGHTED_CONTENT,
    name: 'Highlighted Content',
    description: 'Content rollup web part — displays items from search or a document library based on filters.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      sourceDataSourceType: 'number — content source type',
      layoutId: 'string — display layout',
      maxItemsPerPage: 'number — items per page',
    },
    example: {
      webPartType: WebPartId.HIGHLIGHTED_CONTENT,
      data: { dataVersion: '1.0', properties: { sourceDataSourceType: 1, layoutId: 'Card', maxItemsPerPage: 8 } },
    },
  },
  {
    id: WebPartId.BING_MAPS,
    name: 'Bing Maps',
    description: 'Displays an interactive Bing Maps embed with a configurable location.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      address: 'string — location address',
      pushPinTitle: 'string — pin label',
    },
    example: {
      webPartType: WebPartId.BING_MAPS,
      data: { dataVersion: '1.0', properties: { address: 'Redmond, WA', pushPinTitle: 'Office' } },
    },
  },
  {
    id: WebPartId.LINK_PREVIEW,
    name: 'Link Preview',
    description: 'Shows a rich preview card for a URL (title, description, thumbnail).',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      url: 'string — URL to preview',
      title: 'string — override title',
      description: 'string — override description',
    },
    example: {
      webPartType: WebPartId.LINK_PREVIEW,
      data: { dataVersion: '1.0', properties: { url: 'https://contoso.com', title: '', description: '' } },
    },
  },
  {
    id: WebPartId.ORG_CHART,
    name: 'Org Chart',
    description: 'Displays an organizational chart for a specified person.',
    supportedOn: ['v1.0', 'beta'],
    inGaWhitelist: true,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      targetUserId: 'string — user ID or email',
    },
    example: {
      webPartType: WebPartId.ORG_CHART,
      data: { dataVersion: '1.0', properties: { targetUserId: '' } },
    },
  },
  {
    id: WebPartId.SPACER,
    name: 'Spacer',
    description: 'Adds vertical spacing between web parts.',
    supportedOn: ['beta'],
    inGaWhitelist: false,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      height: 'number — spacing height in pixels',
    },
    example: {
      webPartType: WebPartId.SPACER,
      data: { dataVersion: '1.0', properties: { height: 60 } },
    },
  },
  {
    id: WebPartId.IMAGE_GALLERY,
    name: 'Image Gallery',
    description: 'Displays a gallery/carousel of images.',
    supportedOn: ['beta'],
    inGaWhitelist: false,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      'images[]': 'array of image objects with url and alt text',
      layout: 'string — gallery layout type',
    },
    example: {
      webPartType: WebPartId.IMAGE_GALLERY,
      data: { dataVersion: '1.0', properties: { images: [], layout: 'default' } },
    },
  },
  {
    id: WebPartId.CALL_TO_ACTION,
    name: 'Call to Action',
    description: 'Prominent call-to-action block with background image, heading, and button.',
    supportedOn: ['beta'],
    inGaWhitelist: false,
    builderTool: 'build_any_webpart',
    propertiesSchema: {
      heading: 'string — CTA heading text',
      buttonText: 'string — button label',
      buttonUrl: 'string — button link URL',
    },
    example: {
      webPartType: WebPartId.CALL_TO_ACTION,
      data: { dataVersion: '1.0', properties: { heading: 'Get Started', buttonText: 'Sign Up' } },
    },
  },
];

export function registerCatalogTool(server: McpServer): void {
  server.tool(
    'get_modern_webpart_catalog',
    'Return the catalog of modern web parts available via Graph API, filtered by API version. Includes IDs, schemas, and examples.',
    {
      apiVersion: z.enum(['v1.0', 'beta']).default('v1.0').describe('Graph API version — "v1.0" for GA-only web parts, "beta" for all'),
    },
    async ({ apiVersion }) => {
      if (apiVersion === 'beta') {
        // Beta: return everything
        const result = {
          apiVersion,
          webParts: FULL_CATALOG,
          count: FULL_CATALOG.length,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      // v1.0: split into GA and beta-only
      const gaSet = new Set(GA_WHITELIST);
      const gaWebParts = FULL_CATALOG.filter(wp => gaSet.has(wp.id));
      const betaOnly = FULL_CATALOG.filter(wp => !gaSet.has(wp.id)).map(wp => ({
        id: wp.id,
        name: wp.name,
        description: wp.description,
        note: 'Available on beta API only',
      }));

      const result = {
        apiVersion,
        webParts: gaWebParts,
        count: gaWebParts.length,
        betaOnly,
        betaOnlyCount: betaOnly.length,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
