import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { get, getFile, getFormDigest, fetchOptionsFor } from '../sharepoint/rest-client.js';
import { getSharePointCookies } from '../sharepoint/auth.js';
import { sanitizeHtml } from '../utils/html-sanitizer.js';
import { parsePublishingLayout, extractHardcodedHtml } from '../utils/publishing-layout-parser.js';
import { logger } from '../utils/logger.js';
import { retryOperation } from '../utils/retry.js';
import type { ClassicPageBundle, ClassicWebPartInfo, WikiZone, WebPartZone } from '../types/classic.js';

/** GUID regex matching patterns like {GUID} or bare GUIDs in class/id attributes. */
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface SPListItem {
  WikiField?: string;
  PublishingPageContent?: string;
  PublishingPageLayout?: string | { Url: string; Description?: string };
  Title?: string;
  FileLeafRef?: string;
  Id?: number;
}

interface SPWebPartEntry {
  Id: string;
  ZoneId?: string;
  ZoneIndex?: number;
  WebPart: {
    TypeName: string;
    Title: string;
    Properties: Record<string, unknown>;
  };
}

/** Fetch the Author field from a list item. Returns author info or undefined. */
async function fetchAuthor(
  siteUrl: string,
  listTitle: string,
  itemId: number,
): Promise<{ name: string; email: string; loginName: string } | undefined> {
  try {
    const data = await get<{ Author?: { Title?: string; EMail?: string; Id?: number } }>(
      siteUrl,
      `web/lists/getbytitle('${listTitle}')/items(${itemId})?$select=Author/Title,Author/EMail,Author/Id&$expand=Author`,
    );
    if (data.Author) {
      return {
        name: data.Author.Title ?? '',
        email: data.Author.EMail ?? '',
        loginName: data.Author.EMail ?? '',
      };
    }
  } catch (err) {
    logger.warn('Could not fetch Author field', { error: String(err) });
  }
  return undefined;
}

/** Build the server-relative URL for a page in Site Pages. */
function buildPageUrl(siteUrl: string, pageName: string): string {
  const sitePath = new URL(siteUrl).pathname.replace(/\/$/, '');
  return `${sitePath}/SitePages/${pageName}`;
}

/** Build the server-relative URL for a page in the Pages (publishing) library. */
function buildPublishingPageUrl(siteUrl: string, pageName: string): string {
  const sitePath = new URL(siteUrl).pathname.replace(/\/$/, '');
  return `${sitePath}/Pages/${pageName}`;
}

/** Fetch all web parts from a page via REST LimitedWebPartManager. */
async function fetchWebParts(siteUrl: string, pageServerRelUrl: string): Promise<SPWebPartEntry[]> {
  const encodedPath = encodeURIComponent(pageServerRelUrl).replace(/%2F/g, '/');
  const apiPath = `web/getfilebyserverrelativeurl('${encodedPath}')/limitedwebpartmanager(scope=1)/webparts?$expand=WebPart`;
  const result = await get<{ value: SPWebPartEntry[] }>(siteUrl, apiPath);
  return result.value ?? [];
}

// ── CSOM helpers ──

interface CsomWebPartDef {
  _ObjectType_?: string;
  Id?: string;
  WebPart?: {
    _ObjectType_?: string;
    Title?: string;
    ZoneIndex?: number;
    [key: string]: unknown;
  };
}

/**
 * Fetch web parts via CSOM (/_vti_bin/client.svc/ProcessQuery).
 * Two-phase: (1) list IDs + basic info, (2) ExportWebPart for full type + properties.
 */
async function fetchWebPartsViaCsom(siteUrl: string, pageServerRelUrl: string): Promise<SPWebPartEntry[]> {
  const cookies = await getSharePointCookies(siteUrl);
  const digest = await getFormDigest(siteUrl);

  // Phase 1: get web part IDs + basic info (Title, ZoneIndex)
  const listBody = [
    '<Request AddExpandoFieldTypeSuffix="true" SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="classic-to-modern" xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009">',
    '<Actions>',
    '<ObjectPath Id="2" ObjectPathId="1" /><ObjectPath Id="4" ObjectPathId="3" />',
    '<ObjectPath Id="6" ObjectPathId="5" /><ObjectPath Id="8" ObjectPathId="7" />',
    '<ObjectPath Id="10" ObjectPathId="9" />',
    '<Query Id="11" ObjectPathId="9">',
    '<Query SelectAllProperties="false"><Properties /></Query>',
    '<ChildItemQuery SelectAllProperties="true">',
    '<Properties><Property Name="WebPart" SelectAll="true"><Query SelectAllProperties="true"><Properties /></Query></Property></Properties>',
    '</ChildItemQuery></Query>',
    '</Actions>',
    '<ObjectPaths>',
    '<StaticProperty Id="1" TypeId="{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}" Name="Current" />',
    '<Property Id="3" ParentId="1" Name="Web" />',
    '<Method Id="5" ParentId="3" Name="GetFileByServerRelativeUrl"><Parameters><Parameter Type="String">', pageServerRelUrl, '</Parameter></Parameters></Method>',
    '<Method Id="7" ParentId="5" Name="GetLimitedWebPartManager"><Parameters><Parameter Type="Enum">1</Parameter></Parameters></Method>',
    '<Property Id="9" ParentId="7" Name="WebParts" />',
    '</ObjectPaths></Request>',
  ].join('');

  const csomUrl = `${siteUrl.replace(/\/$/, '')}/_vti_bin/client.svc/ProcessQuery`;
  logger.info('CSOM web part extraction', { url: csomUrl, pageServerRelUrl });

  const listRes = await fetch(csomUrl, {
    method: 'POST',
    headers: { 'Cookie': cookies, 'Content-Type': 'text/xml', 'X-RequestDigest': digest },
    body: listBody,
    ...fetchOptionsFor(csomUrl),
  });

  if (!listRes.ok) throw new Error(`CSOM request failed (${listRes.status}): ${await listRes.text()}`);
  const listJson = await listRes.json() as unknown[];

  for (const item of listJson) {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      if (obj.ErrorInfo) throw new Error(`CSOM error: ${(obj.ErrorInfo as { ErrorMessage?: string }).ErrorMessage}`);
    }
  }

  // Extract IDs and basic info from the WebPartDefinitionCollection
  const idMap = new Map<string, { title: string; zoneId?: string; zoneIndex?: number }>();
  for (const item of listJson) {
    if (typeof item === 'object' && item !== null && '_Child_Items_' in item) {
      const collection = item as { _Child_Items_: CsomWebPartDef[] };
      for (const def of collection._Child_Items_) {
        if (def._ObjectType_?.includes('WebPartDefinition')) {
          const id = def.Id?.replace(/\/Guid\(|\)\//g, '') ?? '';
          const wp = def.WebPart as Record<string, unknown> | undefined;
          idMap.set(id, {
            title: (wp?.Title ?? 'Unknown') as string,
            zoneId: wp?.ZoneId as string | undefined,
            zoneIndex: typeof wp?.ZoneIndex === 'number' ? wp.ZoneIndex : undefined,
          });
        }
      }
    }
  }

  if (idMap.size === 0) return [];

  // Phase 2: ExportWebPart(guid) on LimitedWebPartManager for full type + properties
  const wpIds = [...idMap.keys()];
  const exportMap = await exportWebPartsViaCsom(siteUrl, pageServerRelUrl, wpIds, cookies, digest);

  const entries: SPWebPartEntry[] = [];
  for (const [id, basic] of idMap) {
    const xml = exportMap.get(id);
    const typeName = xml ? parseTypeFromExportXml(xml) : undefined;
    const xmlProps = xml ? parsePropertiesFromExportXml(xml) : {};

    entries.push({
      Id: id,
      ZoneId: basic.zoneId,
      ZoneIndex: basic.zoneIndex,
      WebPart: {
        TypeName: typeName ?? basic.title,
        Title: basic.title,
        Properties: { ...xmlProps, ...(xml ? { exportedWebPartXml: xml } : {}) },
      },
    });
  }

  logger.info('CSOM extraction complete', { entries: entries.length, exported: exportMap.size });
  return entries;
}

/**
 * Call ExportWebPart(guid) via CSOM batch on LimitedWebPartManager.
 * Returns a map of ID → exported web part XML string.
 */
async function exportWebPartsViaCsom(
  siteUrl: string,
  pageServerRelUrl: string,
  wpIds: string[],
  cookies: string,
  digest: string,
): Promise<Map<string, string>> {
  if (wpIds.length === 0) return new Map();

  // Build CSOM batch — ExportWebPart is on LimitedWebPartManager (objectPath 7)
  const actions: string[] = [
    '<ObjectPath Id="2" ObjectPathId="1" /><ObjectPath Id="4" ObjectPathId="3" />',
    '<ObjectPath Id="6" ObjectPathId="5" /><ObjectPath Id="8" ObjectPathId="7" />',
    '<ObjectPath Id="10" ObjectPathId="9" />',
  ];
  const objectPaths: string[] = [
    '<StaticProperty Id="1" TypeId="{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}" Name="Current" />',
    '<Property Id="3" ParentId="1" Name="Web" />',
    `<Method Id="5" ParentId="3" Name="GetFileByServerRelativeUrl"><Parameters><Parameter Type="String">${pageServerRelUrl}</Parameter></Parameters></Method>`,
    '<Method Id="7" ParentId="5" Name="GetLimitedWebPartManager"><Parameters><Parameter Type="Enum">1</Parameter></Parameters></Method>',
    '<Property Id="9" ParentId="7" Name="WebParts" />',
  ];

  for (let i = 0; i < wpIds.length; i++) {
    actions.push(
      `<Method Name="ExportWebPart" Id="${100 + i}" ObjectPathId="7"><Parameters><Parameter Type="Guid">${wpIds[i]}</Parameter></Parameters></Method>`,
    );
  }

  const body = [
    '<Request AddExpandoFieldTypeSuffix="true" SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="classic-to-modern" xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009">',
    '<Actions>', ...actions, '</Actions>',
    '<ObjectPaths>', ...objectPaths, '</ObjectPaths>',
    '</Request>',
  ].join('');

  const url = `${siteUrl.replace(/\/$/, '')}/_vti_bin/client.svc/ProcessQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Cookie': cookies, 'Content-Type': 'text/xml', 'X-RequestDigest': digest },
    body,
    ...fetchOptionsFor(url),
  });

  if (!res.ok) throw new Error(`CSOM ExportWebPart failed (${res.status}): ${await res.text()}`);
  const json = await res.json() as unknown[];

  for (const item of json) {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      if (obj.ErrorInfo) {
        throw new Error(`CSOM ExportWebPart error: ${(obj.ErrorInfo as { ErrorMessage?: string }).ErrorMessage ?? JSON.stringify(obj.ErrorInfo)}`);
      }
    }
  }

  // ExportWebPart returns ClientResult<string> — bare XML strings in the response array
  const exportedXmls: string[] = [];
  for (const item of json) {
    if (typeof item === 'string' && (item.includes('<webParts>') || item.includes('<WebPart'))) {
      exportedXmls.push(item);
    }
  }

  const result = new Map<string, string>();
  for (let i = 0; i < Math.min(wpIds.length, exportedXmls.length); i++) {
    result.set(wpIds[i], exportedXmls[i]);
  }
  return result;
}

// ── Export XML parsers ──

/** Parse the type name from exported web part XML (v3 or v2 format). */
function parseTypeFromExportXml(xml: string): string | undefined {
  const v3Match = xml.match(/<type\s+name="([^"]+)"/);
  if (v3Match) return v3Match[1];

  const v2Match = xml.match(/<TypeName>([^<]+)<\/TypeName>/);
  if (v2Match) return v2Match[1];

  return undefined;
}

/** Parse all properties from exported web part XML into a flat key-value map. */
function parsePropertiesFromExportXml(xml: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  let m: RegExpExecArray | null;

  // v3: <property name="X" type="T" [null="true"] />  or  >value</property>
  const v3Re = /<property\s+name="([^"]+)"\s+type="([^"]*)"([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g;
  while ((m = v3Re.exec(xml)) !== null) {
    const [, name, type, attrs, value] = m;
    if (attrs.includes('null="true"') || value === undefined) {
      props[name] = null;
    } else if (type === 'bool') {
      props[name] = value === 'True';
    } else if (type === 'int') {
      props[name] = parseInt(value, 10);
    } else {
      props[name] = value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    }
  }

  // v2: simple element tags like <Title>value</Title>
  if (Object.keys(props).length === 0) {
    const v2Re = /<([A-Z]\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
    while ((m = v2Re.exec(xml)) !== null) {
      props[m[1]] = m[2];
    }
  }

  return props;
}

// ── ASPX file parser (fallback for web part pages) ──

/**
 * Download the .aspx file and parse web part XML from it.
 * Only works for web part pages where WPs are embedded in the file.
 * Wiki pages store WPs in the DB — use CSOM instead.
 */
async function fetchWebPartsFromFile(siteUrl: string, pageServerRelUrl: string): Promise<SPWebPartEntry[]> {
  const fileContent = await getFile(siteUrl, pageServerRelUrl);
  return parseWebPartsFromAspx(fileContent);
}

function parseWebPartsFromAspx(aspxContent: string): SPWebPartEntry[] {
  const webParts: SPWebPartEntry[] = [];

  const v3Regex = /<webParts>\s*<webPart[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/WebPart\/v3"[^>]*>([\s\S]*?)<\/webPart>\s*<\/webParts>/gi;
  let match: RegExpExecArray | null;

  while ((match = v3Regex.exec(aspxContent)) !== null) {
    const entry = parseV3WebPart(match[1], webParts.length);
    if (entry) webParts.push(entry);
  }

  const v2Regex = /<WebPart[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/WebPart\/v2"[^>]*>([\s\S]*?)<\/WebPart>/gi;
  while ((match = v2Regex.exec(aspxContent)) !== null) {
    const entry = parseV2WebPart(match[1], webParts.length);
    if (entry) webParts.push(entry);
  }

  return webParts;
}

function parseV3WebPart(xml: string, index: number): SPWebPartEntry | null {
  try {
    const typeMatch = xml.match(/<type\s+name="([^"]+)"/i);
    const typeName = typeMatch ? typeMatch[1].split(',')[0].trim() : 'Unknown';
    const properties = parsePropertiesFromExportXml(`<data><properties>${xml}</properties></data>`);
    const title = (properties['Title'] as string) ?? typeName.split('.').pop() ?? 'Unknown';

    return {
      Id: `parsed-${index}`,
      ZoneIndex: index,
      WebPart: { TypeName: typeName, Title: String(title), Properties: properties },
    };
  } catch (err) {
    logger.warn('Failed to parse v3 web part XML', { error: String(err) });
    return null;
  }
}

function parseV2WebPart(xml: string, index: number): SPWebPartEntry | null {
  try {
    const typeMatch = xml.match(/<TypeName[^>]*>(.*?)<\/TypeName>/i);
    const titleMatch = xml.match(/<Title[^>]*>(.*?)<\/Title>/i);
    const typeName = typeMatch?.[1]?.trim() ?? 'Unknown';
    const title = titleMatch?.[1]?.trim() ?? typeName.split('.').pop() ?? 'Unknown';
    const properties = parsePropertiesFromExportXml(xml);

    return {
      Id: `parsed-${index}`,
      ZoneIndex: index,
      WebPart: { TypeName: typeName, Title: title, Properties: properties },
    };
  } catch (err) {
    logger.warn('Failed to parse v2 web part XML', { error: String(err) });
    return null;
  }
}

// ── Web part post-processing ──

/** Convert an SPWebPartEntry to ClassicWebPartInfo, resolving CEWP content. */
async function toWebPartInfo(siteUrl: string, entry: SPWebPartEntry): Promise<ClassicWebPartInfo> {
  const props = entry.WebPart.Properties ?? {};
  const info: ClassicWebPartInfo = {
    id: entry.Id,
    typeName: entry.WebPart.TypeName,
    title: entry.WebPart.Title,
    zoneId: entry.ZoneId,
    zoneIndex: entry.ZoneIndex,
    properties: props,
    hasScripts: false,
  };

  if (entry.WebPart.TypeName.includes('ContentEditorWebPart')) {
    const contentLink = typeof props.ContentLink === 'string' ? props.ContentLink : undefined;
    let rawHtml = '';

    if (contentLink) {
      info.contentLink = contentLink;
      try {
        rawHtml = await getFile(siteUrl, contentLink);
      } catch (err) {
        logger.warn('Failed to fetch ContentLink', { contentLink, error: String(err) });
        rawHtml = typeof props.Content === 'string' ? props.Content : '';
      }
    } else {
      rawHtml = typeof props.Content === 'string' ? props.Content : '';
    }

    if (rawHtml) {
      const sanitized = sanitizeHtml(rawHtml);
      info.resolvedHtml = sanitized.html;
      info.hasScripts = sanitized.hadScripts;
    }
  }

  return info;
}

// ── Wiki HTML parser ──

/** Parse wiki HTML to extract zones and embedded web part GUIDs. */
function parseWikiZones(wikiHtml: string): { zones: WikiZone[]; webPartIds: string[] } {
  const $ = cheerio.load(wikiHtml, null, false);
  const zones: WikiZone[] = [];
  const allWebPartIds: string[] = [];
  let zoneIndex = 0;

  const wpBoxes = $('div.ms-rte-wpbox');

  if (wpBoxes.length === 0) {
    zones.push({ index: 0, html: wikiHtml, webPartIds: [] });
    return { zones, webPartIds: [] };
  }

  const topHtml = $.html();

  wpBoxes.each((_, box) => {
    const $box = $(box);
    const innerDivs = $box.find('div[id^="div_"]');
    innerDivs.each((__, inner) => {
      const id = $(inner).attr('id') ?? '';
      const match = id.match(GUID_RE);
      if (match) {
        allWebPartIds.push(match[0]);
      }
    });

    if (allWebPartIds.length === 0 || !innerDivs.length) {
      const boxHtml = $.html(box);
      const classMatch = boxHtml.match(GUID_RE);
      if (classMatch && !allWebPartIds.includes(classMatch[0])) {
        allWebPartIds.push(classMatch[0]);
      }
    }
  });

  // Split HTML around web part boxes to build zones
  let markedHtml = topHtml;
  const marker = '<!--WP_ZONE_SPLIT-->';

  wpBoxes.each((_, box) => {
    const boxHtml = $.html(box);
    markedHtml = markedHtml.replace(boxHtml, marker);
  });

  const segments = markedHtml.split(marker);
  let wpIdIndex = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed) {
      zones.push({ index: zoneIndex, html: trimmed, webPartIds: [] });
      zoneIndex++;
    }
    if (wpIdIndex < allWebPartIds.length) {
      zones.push({ index: zoneIndex, html: '', webPartIds: [allWebPartIds[wpIdIndex]] });
      zoneIndex++;
      wpIdIndex++;
    }
  }

  while (wpIdIndex < allWebPartIds.length) {
    zones.push({ index: zoneIndex, html: '', webPartIds: [allWebPartIds[wpIdIndex]] });
    zoneIndex++;
    wpIdIndex++;
  }

  return { zones, webPartIds: allWebPartIds };
}

// ── Shared web part extraction helper ──

/** Try REST → CSOM → file parse to get web part entries for a page URL. */
async function extractWebParts(siteUrl: string, pageUrl: string): Promise<SPWebPartEntry[]> {
  // Try REST LimitedWebPartManager
  try {
    const entries = await fetchWebParts(siteUrl, pageUrl);
    if (entries.length > 0) return entries;
  } catch (err) {
    logger.warn('REST LimitedWebPartManager failed', { url: pageUrl, error: String(err) });
  }

  // Try CSOM (works for wiki pages where REST returns empty)
  try {
    const entries = await fetchWebPartsViaCsom(siteUrl, pageUrl);
    if (entries.length > 0) return entries;
  } catch (err) {
    logger.warn('CSOM fallback failed', { url: pageUrl, error: String(err) });
  }

  // Try parsing the .aspx file directly (works for unghosted web part pages)
  try {
    const entries = await fetchWebPartsFromFile(siteUrl, pageUrl);
    if (entries.length > 0) return entries;
  } catch (err) {
    logger.warn('File parse fallback failed', { url: pageUrl, error: String(err) });
  }

  return [];
}

// ── Main extraction tool ──

/** Extract a classic page bundle (reusable by other tools). */
export async function extractClassicPageBundle(siteUrl: string, pageName: string): Promise<ClassicPageBundle> {
        const normalizedSiteUrl = siteUrl.replace(/\/$/, '');

        // Detect library from pageName path (e.g., "Pages/Home.aspx" or "SitePages/Home.aspx")
        let targetLibrary: 'SitePages' | 'Pages' | undefined;
        let leafName = pageName;
        if (/^Pages\//i.test(pageName)) {
          targetLibrary = 'Pages';
          leafName = pageName.replace(/^Pages\//i, '');
        } else if (/^SitePages\//i.test(pageName)) {
          targetLibrary = 'SitePages';
          leafName = pageName.replace(/^SitePages\//i, '');
        }

        const pageServerRelUrl = buildPageUrl(normalizedSiteUrl, leafName);
        logger.info('Extracting classic page', { siteUrl: normalizedSiteUrl, pageName: leafName, targetLibrary, pageServerRelUrl });

        const encodedPageName = encodeURIComponent(leafName);

        // --- Try wiki page (Site Pages library) — skip if caller explicitly targets Pages ---
        // Use getfilebyserverrelativeurl + ListItemAllFields to get draft content
        // (the items?$filter= endpoint only returns published version data, so WikiField
        // is null for pages that have never been published, e.g. version 0.3)
        let listItem: SPListItem | undefined;
        if (targetLibrary !== 'Pages') {
          try {
            const encodedPath = encodeURIComponent(pageServerRelUrl).replace(/%2F/g, '/');
            listItem = await get<SPListItem>(normalizedSiteUrl,
              `web/getfilebyserverrelativeurl('${encodedPath}')/listitemallfields?$select=WikiField,Title,FileLeafRef,Id`);
          } catch (err) {
            logger.warn('Could not fetch from Site Pages via file URL', { error: String(err) });
            // Fallback to items query (works when page URL doesn't match SitePages path)
            try {
              const result = await get<{ value: SPListItem[] }>(normalizedSiteUrl,
                `web/lists/getbytitle('Site Pages')/items?$filter=FileLeafRef eq '${encodedPageName}'&$select=WikiField,Title,FileLeafRef,Id`);
              listItem = result.value?.[0];
            } catch (err2) {
              logger.warn('Could not fetch from Site Pages list', { error: String(err2) });
            }
          }
        }

        if (listItem?.WikiField != null) {
          // --- Wiki Page Extraction ---
          const wikiHtml = listItem.WikiField!;
          const title = listItem.Title ?? leafName;
          const { zones, webPartIds } = parseWikiZones(wikiHtml);

          const webParts: ClassicWebPartInfo[] = [];
          if (webPartIds.length > 0) {
            const spEntries = await extractWebParts(normalizedSiteUrl, pageServerRelUrl);

            for (const entry of spEntries) {
              try {
                webParts.push(await toWebPartInfo(normalizedSiteUrl, entry));
              } catch (err) {
                logger.error('Failed to process web part', { id: entry.Id, error: String(err) });
                webParts.push({ id: entry.Id, typeName: entry.WebPart?.TypeName ?? 'Unknown', title: entry.WebPart?.Title ?? 'Unknown', properties: {}, hasScripts: false });
              }
            }

            if (spEntries.length === 0) {
              for (const wpId of webPartIds) {
                webParts.push({ id: wpId, typeName: 'Unknown (details unavailable)', title: `Web Part ${wpId}`, properties: {}, hasScripts: false });
              }
            }
          }

          const author = listItem.Id != null ? await fetchAuthor(normalizedSiteUrl, 'Site Pages', listItem.Id!) : undefined;

          const bundle: ClassicPageBundle = {
            pageType: 'wiki', title, url: pageServerRelUrl, siteUrl: normalizedSiteUrl,
            wikiHtml, wikiZones: zones, author, webParts,
          };
          return bundle;
        }

        // --- Try publishing page (Pages library) — skip if caller explicitly targets SitePages ---
        let publishingItem: SPListItem | undefined;
        if (targetLibrary !== 'SitePages') {
          try {
            const pubResult = await get<{ value: SPListItem[] }>(normalizedSiteUrl,
              `web/lists/getbytitle('Pages')/items?$filter=FileLeafRef eq '${encodedPageName}'&$select=PublishingPageContent,PublishingPageLayout,Title,FileLeafRef,Id`);
            publishingItem = pubResult.value?.[0];
          } catch (err) {
            logger.info('No Pages library found', { error: String(err) });
          }
        }

        if (publishingItem != null) {
          // --- Publishing Page Extraction ---
          const publishingHtml = publishingItem.PublishingPageContent ?? '';
          const title = publishingItem.Title ?? leafName;
          const pubPageUrl = buildPublishingPageUrl(normalizedSiteUrl, leafName);
          const { zones, webPartIds } = publishingHtml ? parseWikiZones(publishingHtml) : { zones: [] as WikiZone[], webPartIds: [] as string[] };

          // Parse publishing page layout
          let publishingLayoutUrl: string | undefined;
          let publishingLayoutName: string | undefined;
          let publishingLayout: import('../types/classic.js').PublishingLayoutInfo | undefined;
          let publishingLayoutHtml: string | undefined;

          const rawLayoutField = publishingItem.PublishingPageLayout;
          if (rawLayoutField) {
            const layoutUrl = typeof rawLayoutField === 'object'
              ? (rawLayoutField as { Url: string }).Url
              : rawLayoutField.split(',')[0].trim();
            publishingLayoutUrl = layoutUrl;
            publishingLayoutName = layoutUrl.split('/').pop() ?? '';

            try {
              const layoutServerRelUrl = new URL(layoutUrl).pathname;
              // Try fetching from the current site first, then walk up to parent sites
              // (layout ASPX is often in a parent site's _catalogs/masterpage gallery)
              let layoutContent: string | undefined;
              const sitesToTry = [normalizedSiteUrl];
              const sitePathParts = new URL(normalizedSiteUrl).pathname.replace(/\/$/, '').split('/').filter(Boolean);
              const origin = new URL(normalizedSiteUrl).origin;
              for (let i = sitePathParts.length - 1; i >= 1; i--) {
                sitesToTry.push(`${origin}/${sitePathParts.slice(0, i).join('/')}`);
              }
              for (const candidateSite of sitesToTry) {
                try {
                  layoutContent = await getFile(candidateSite, layoutServerRelUrl);
                  if (layoutContent) {
                    logger.info('Fetched publishing layout from site', { candidateSite, layoutServerRelUrl });
                    break;
                  }
                } catch {
                  logger.info('Layout not found at site, trying parent', { candidateSite });
                }
              }
              if (layoutContent) {
                publishingLayout = parsePublishingLayout(layoutContent, publishingLayoutName);
                publishingLayoutHtml = extractHardcodedHtml(layoutContent);
              } else {
                logger.warn('Could not fetch publishing layout from any site', { layoutUrl });
              }
            } catch (err) {
              logger.warn('Could not fetch/parse publishing layout', { layoutUrl, error: String(err) });
            }
          }

          // Fetch ALL publishing field values (not just hardcoded ones)
          // Custom page layouts use custom columns — return every non-empty string field
          const publishingFields: Record<string, string> = {};
          if (publishingItem.Id) {
            try {
              const editVals = await get<Record<string, unknown>>(normalizedSiteUrl,
                `web/lists/getbytitle('Pages')/items(${publishingItem.Id})/FieldValuesForEdit`);
              // Skip OData metadata and internal-only fields
              const skipPrefixes = ['odata.', '__metadata', 'owshiddenversion', 'MetaInfo'];
              for (const [key, value] of Object.entries(editVals)) {
                if (skipPrefixes.some(p => key.toLowerCase().startsWith(p.toLowerCase()))) continue;
                if (typeof value === 'string' && value.trim() !== '') {
                  publishingFields[key] = value;
                }
              }
            } catch (err) {
              logger.warn('Could not fetch FieldValuesForEdit', { error: String(err) });
            }
          }

          // Fetch web parts
          const webParts: ClassicWebPartInfo[] = [];
          if (webPartIds.length > 0) {
            const spEntries = await extractWebParts(normalizedSiteUrl, pubPageUrl);

            for (const entry of spEntries) {
              try {
                webParts.push(await toWebPartInfo(normalizedSiteUrl, entry));
              } catch (err) {
                logger.error('Failed to process web part', { id: entry.Id, error: String(err) });
                webParts.push({ id: entry.Id, typeName: entry.WebPart?.TypeName ?? 'Unknown', title: entry.WebPart?.Title ?? 'Unknown', properties: {}, hasScripts: false });
              }
            }

            if (spEntries.length === 0) {
              for (const wpId of webPartIds) {
                webParts.push({ id: wpId, typeName: 'Unknown (details unavailable)', title: `Web Part ${wpId}`, properties: {}, hasScripts: false });
              }
            }
          }

          const author = publishingItem.Id != null ? await fetchAuthor(normalizedSiteUrl, 'Pages', publishingItem.Id!) : undefined;

          const bundle: ClassicPageBundle = {
            pageType: 'publishing', title, url: pubPageUrl, siteUrl: normalizedSiteUrl,
            wikiHtml: publishingHtml || undefined, wikiZones: zones.length > 0 ? zones : undefined,
            publishingLayoutUrl, publishingLayoutName, publishingLayout,
            publishingFields: Object.keys(publishingFields).length > 0 ? publishingFields : undefined,
            publishingLayoutHtml,
            author, webParts,
          };
          return bundle;
        }

        {
          // --- Web Part Page Extraction ---
          // (publishingItem is null here — otherwise we'd have returned from the publishing block above)
          const wpPageUrl = pageServerRelUrl;
          const wpListTitle = 'Site Pages';
          const wpTitle = listItem?.Title ?? leafName;
          const wpItemId = listItem?.Id;

          // Try primary URL, then alternate library URL
          let spEntries = await extractWebParts(normalizedSiteUrl, wpPageUrl);
          let successUrl = wpPageUrl;

          if (spEntries.length === 0) {
            const altUrl = buildPublishingPageUrl(normalizedSiteUrl, leafName);
            if (altUrl !== wpPageUrl) {
              spEntries = await extractWebParts(normalizedSiteUrl, altUrl);
              if (spEntries.length > 0) successUrl = altUrl;
            }
          }

          if (spEntries.length === 0) {
            const bundle: ClassicPageBundle = { pageType: 'webpart', title: wpTitle, url: wpPageUrl, siteUrl: normalizedSiteUrl, zones: [], webParts: [] };
            (bundle as unknown as Record<string, unknown>).warning = 'Web part details unavailable — all extraction methods failed.';
            return bundle;
          }

          const webParts: ClassicWebPartInfo[] = [];
          for (const entry of spEntries) {
            try {
              webParts.push(await toWebPartInfo(normalizedSiteUrl, entry));
            } catch (err) {
              logger.error('Failed to extract web part', { id: entry.Id, error: String(err) });
              webParts.push({ id: entry.Id, typeName: entry.WebPart?.TypeName ?? 'Unknown', title: entry.WebPart?.Title ?? 'Unknown', properties: {}, hasScripts: false });
            }
          }

          const zoneMap = new Map<string, ClassicWebPartInfo[]>();
          for (const wp of webParts) {
            const zoneId = wp.zoneId ?? 'Default';
            if (!zoneMap.has(zoneId)) zoneMap.set(zoneId, []);
            zoneMap.get(zoneId)!.push(wp);
          }

          const zones: WebPartZone[] = Array.from(zoneMap.entries()).map(([zoneId, zoneWps]) => ({
            zoneId,
            webParts: zoneWps.sort((a, b) => (a.zoneIndex ?? 0) - (b.zoneIndex ?? 0)),
          }));

          const author = wpItemId != null ? await fetchAuthor(normalizedSiteUrl, wpListTitle, wpItemId) : undefined;

          const bundle: ClassicPageBundle = {
            pageType: 'webpart', title: wpTitle, url: successUrl, siteUrl: normalizedSiteUrl,
            zones, author, webParts,
          };
          return bundle;
        }
}

export function registerExtractTool(server: McpServer): void {
  server.tool(
    'extract_classic_page',
    'Extract content from a classic SharePoint page (wiki, web part, or publishing page). Returns raw HTML, web part metadata, and resolved content.',
    {
      siteUrl: z.string().describe('SharePoint site URL (e.g., https://contoso.sharepoint.com/sites/team)'),
      pageName: z.string().describe('Page file name (e.g., Home.aspx) or library-qualified path (e.g., Pages/Home.aspx)'),
    },
    async ({ siteUrl, pageName }) => {
      try {
        const bundle = await retryOperation(
          'extract_classic_page',
          () => extractClassicPageBundle(siteUrl, pageName),
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(bundle, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('extract_classic_page failed', { error: message });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to extract page: ${message}` }) }] };
      }
    },
  );
}
