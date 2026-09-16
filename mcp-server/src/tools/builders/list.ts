import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebPartId } from '../../types/modern.js';
import type { StandardWebPart } from '../../types/modern.js';

export interface ListWebPartOptions {
  siteUrl: string;
  listId: string;
  viewId: string;
  listUrl: string;
  listTitle: string;
  title?: string;
  isDocumentLibrary?: boolean;
  webpartHeightKey?: number;
  hideCommandBar?: boolean;
}

function getWebRelativeListUrl(siteUrl: string, listUrl: string): string {
  const site = new URL(siteUrl);
  const sitePath = site.pathname.replace(/\/$/, '');
  const listPath = new URL(listUrl, site.origin).pathname;
  const prefix = `${sitePath}/`;

  if (!listPath.startsWith(prefix)) {
    throw new Error(`List URL '${listPath}' is outside destination site '${sitePath || '/'}'.`);
  }

  return decodeURI(listPath.slice(sitePath.length));
}

export function buildListWebPart({
  siteUrl,
  listId,
  viewId,
  listUrl,
  listTitle,
  title = 'List',
  isDocumentLibrary = false,
  webpartHeightKey = 4,
  hideCommandBar = false,
}: ListWebPartOptions): StandardWebPart {
  const webPartTitle = title.trim() || 'List';
  const normalizedListTitle = listTitle.trim();
  if (!normalizedListTitle) {
    throw new Error('A list title is required to build a List web part.');
  }

  return {
    webPartType: WebPartId.LIST,
    data: {
      dataVersion: '1.0',
      title: webPartTitle,
      description: isDocumentLibrary ? 'Display a document library.' : 'Display a list from this site.',
      properties: {
        isDocumentLibrary,
        selectedListId: listId,
        selectedListUrl: listUrl,
        webRelativeListUrl: getWebRelativeListUrl(siteUrl, listUrl),
        webpartHeightKey,
        selectedViewId: viewId,
        selectedFolderPath: '',
        hideCommandBar,
      },
      serverProcessedContent: {
        htmlStrings: [],
        searchablePlainTexts: [{ key: 'listTitle', value: normalizedListTitle }],
        imageSources: [],
        links: [],
      },
      dynamicDataPaths: {},
      dynamicDataValues: { filterBy: {} },
      containsDynamicDataSource: true,
    },
  };
}

export function registerBuildListTool(server: McpServer): void {
  server.tool(
    'build_list_webpart',
    'Build a modern List web part JSON from verified destination list and view metadata.',
    {
      siteUrl: z.string().describe('Destination SharePoint site URL'),
      listId: z.string().describe('Destination list GUID'),
      viewId: z.string().describe('Destination view GUID'),
      listUrl: z.string().describe('Destination list server-relative URL'),
      listTitle: z.string().describe('Destination list title'),
      title: z.string().default('List').describe('Visible List web part heading'),
      isDocumentLibrary: z.boolean().default(false).describe('Whether the destination is a document library'),
      webpartHeightKey: z.number().int().min(1).max(6).default(4).describe('List web part height preset'),
      hideCommandBar: z.boolean().default(false).describe('Whether to hide the List command bar'),
    },
    async (options) => {
      const webpart = buildListWebPart(options);
      return { content: [{ type: 'text' as const, text: JSON.stringify(webpart, null, 2) }] };
    },
  );
}
