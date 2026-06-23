import * as cheerio from 'cheerio';
import type {
  PublishingLayoutInfo,
  PublishingFieldControl,
  PublishingWebPartZone,
  PublishingLayoutRow,
} from '../types/classic.js';

type CheerioAPI = ReturnType<typeof cheerio.load>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioSelection = cheerio.Cheerio<any>;

/** Map CSS classes from pagelayouts15.css to percent widths. */
const CSS_WIDTH_MAP: Record<string, number> = {
  'col-50': 50,
  'col-33': 33,
  'tableCol-75': 75,
  'tableCol-50': 50,
  'tableCol-33': 33,
  'tableCol-25': 25,
  'main-content': 75,
  'right-bar': 25,
};

/** All CSS classes we look for when determining column widths. */
const WIDTH_CLASSES = Object.keys(CSS_WIDTH_MAP);

/** Convert a percent width to a modern 12-column grid width. */
function toModernWidth(pct: number): number {
  if (pct >= 75) return 9;
  if (pct >= 50) return 6;
  if (pct >= 33) return 4;
  return 3;
}

/** Get width percent from a class string if it contains a known width class. */
function getWidthFromClasses(classStr: string | undefined): number | undefined {
  if (!classStr) return undefined;
  for (const cls of WIDTH_CLASSES) {
    if (classStr.split(/\s+/).includes(cls)) {
      return CSS_WIDTH_MAP[cls];
    }
  }
  return undefined;
}

/**
 * Parse a publishing page layout ASPX to extract field controls,
 * web part zones, and CSS-based column structure.
 */
export function parsePublishingLayout(aspxContent: string, layoutName: string): PublishingLayoutInfo {
  const fieldControls = extractFieldControls(aspxContent);
  const webPartZones = extractWebPartZones(aspxContent);
  const modernMapping = deriveModernMapping(aspxContent, fieldControls, webPartZones);

  return {
    layoutName,
    fieldControls,
    webPartZones,
    modernMapping,
  };
}

/** Extract field controls from the ASPX, returning their field names and types. */
function extractFieldControls(aspx: string): PublishingFieldControl[] {
  const controls: PublishingFieldControl[] = [];
  const seen = new Set<string>();

  // Extract the PlaceHolderMain block so we only search for fields there
  // and EditModePanel detection isn't confused by panels in other content blocks.
  const mainMatch = aspx.match(/<asp:Content[^>]*PlaceHolderMain[^>]*>([\s\S]*?)<\/asp:Content>/i);
  const mainContent = mainMatch ? mainMatch[1] : aspx;

  // Match SharePoint field control tags like:
  //   <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" ... />
  //   <PublishingWebControls:RichImageField FieldName="PublishingPageImage" ... />
  //   <SharePointWebControls:TextField FieldName="ArticleByLine" ... />
  //   <SharePointWebControls:DateTimeField FieldName="ArticleStartDate" ... />
  //   <PublishingWebControls:SummaryLinkFieldControl FieldName="SummaryLinks" ... />
  const fieldControlRegex = /<(?:\w+:)(RichHtmlField|RichImageField|TextField|DateTimeField|NoteField|SummaryLinkFieldControl|ImageFieldValue)\b[^>]*FieldName="([^"]+)"[^>]*\/?>/gi;

  let match: RegExpExecArray | null;
  while ((match = fieldControlRegex.exec(mainContent)) !== null) {
    const controlType = match[1];
    const fieldName = match[2];

    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    // Find the nearest parent div's CSS class for container context
    const containerClass = findContainerClass(mainContent, match.index);

    // Check if this field is inside an EditModePanel (edit-only, not rendered)
    const editOnly = isInsideEditModePanel(mainContent, match.index);

    controls.push({
      fieldName,
      controlType,
      containerClass,
      editOnly: editOnly || undefined,
    });
  }

  return controls;
}

/** Find the nearest parent div's CSS class before the given index in the ASPX. */
function findContainerClass(aspx: string, index: number): string | undefined {
  // Look backwards from the field control for the nearest <div class="...">
  const before = aspx.substring(Math.max(0, index - 500), index);
  const divMatches = [...before.matchAll(/<div[^>]*class="([^"]+)"[^>]*>/gi)];
  if (divMatches.length > 0) {
    const lastMatch = divMatches[divMatches.length - 1];
    return lastMatch[1];
  }
  return undefined;
}

/** Check if the field at the given index is inside a PublishingWebControls:EditModePanel. */
function isInsideEditModePanel(aspx: string, index: number): boolean {
  // Count open/close EditModePanel tags before this index
  const before = aspx.substring(0, index);
  const opens = (before.match(/<PublishingWebControls:EditModePanel\b/gi) || []).length;
  const closes = (before.match(/<\/PublishingWebControls:EditModePanel>/gi) || []).length;
  // If more opens than closes, we're inside an EditModePanel
  return opens > closes;
}

/** Extract web part zones from the ASPX. */
function extractWebPartZones(aspx: string): PublishingWebPartZone[] {
  const zones: PublishingWebPartZone[] = [];

  // Match WebPartZone tags: <WebPartPages:WebPartZone ... id="Header" ... >
  const zoneRegex = /<WebPartPages:WebPartZone[^>]*\bid="([^"]+)"[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = zoneRegex.exec(aspx)) !== null) {
    const zoneId = match[1];
    const containerClass = findContainerClass(aspx, match.index);
    const widthPercent = getWidthFromClasses(containerClass);

    zones.push({
      zoneId,
      containerClass,
      widthPercent,
    });
  }

  return zones;
}

/**
 * Derive modern section/column mapping from the layout's DOM structure.
 * Looks at CSS width classes to determine column widths within rows.
 * Also handles OOB layout patterns (ArticleLeft/ArticleRight float-based).
 */
function deriveModernMapping(
  aspx: string,
  fieldControls: PublishingFieldControl[],
  webPartZones: PublishingWebPartZone[],
): PublishingLayoutRow[] {
  // Set of edit-only field names to exclude from mapping
  const editOnlyFields = new Set(
    fieldControls.filter(fc => fc.editOnly).map(fc => fc.fieldName),
  );

  // Extract the PlaceHolderMain content, which holds the page body
  const mainMatch = aspx.match(/<asp:Content[^>]*PlaceHolderMain[^>]*>([\s\S]*?)<\/asp:Content>/i);
  if (!mainMatch) {
    // Fallback: use entire content
    return buildFallbackMapping(fieldControls, webPartZones);
  }

  const mainContent = mainMatch[1];
  const $ = cheerio.load(mainContent, null, false);

  const rows: PublishingLayoutRow[] = [];

  // Detect OOB article layout patterns (float-based, not column-class-based)
  const articleLayout = detectArticleLayout($, mainContent);
  if (articleLayout) {
    return filterEditOnlyFromRows(articleLayout, editOnlyFields);
  }

  // Strategy: walk top-level elements looking for sibling divs with width classes
  // that form column groups (rows), and divs without width classes that form full-width rows.
  const topLevel = $.root().children();
  let currentRowColumns: { widthPercent: number; modernWidth: number; zoneIds: string[]; fieldNames: string[] }[] = [];

  topLevel.each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    const classStr = $el.attr('class') || '';
    const width = getWidthFromClasses(classStr);

    if (width) {
      // This element has a width class — it's a column in the current row
      const colZoneIds = findZoneIdsInElement($el, $);
      const colFieldNames = findFieldNamesInElement($el, aspx, mainContent);
      currentRowColumns.push({
        widthPercent: width,
        modernWidth: toModernWidth(width),
        zoneIds: colZoneIds.length > 0 ? colZoneIds : undefined as unknown as string[],
        fieldNames: colFieldNames.length > 0 ? colFieldNames : undefined as unknown as string[],
      });
    } else {
      // No width class — flush any accumulated columns as a row, then add this as a full-width row
      if (currentRowColumns.length > 0) {
        rows.push({ columns: cleanColumns(currentRowColumns) });
        currentRowColumns = [];
      }

      // Check if this element contains columns within it (nested width-class divs)
      const nestedColumns = findNestedColumns($el, $, aspx, mainContent);
      if (nestedColumns.length > 0) {
        rows.push({ columns: cleanColumns(nestedColumns) });
      } else {
        // Full-width row with all contained fields/zones
        const elZoneIds = findZoneIdsInElement($el, $);
        const elFieldNames = findFieldNamesInElement($el, aspx, mainContent);
        if (elZoneIds.length > 0 || elFieldNames.length > 0) {
          rows.push({
            columns: [{
              widthPercent: 100,
              modernWidth: 12,
              zoneIds: elZoneIds.length > 0 ? elZoneIds : undefined,
              fieldNames: elFieldNames.length > 0 ? elFieldNames : undefined,
            }],
          });
        }
      }
    }
  });

  // Flush remaining columns
  if (currentRowColumns.length > 0) {
    rows.push({ columns: cleanColumns(currentRowColumns) });
  }

  // If no rows were found, use fallback
  if (rows.length === 0) {
    return buildFallbackMapping(fieldControls, webPartZones);
  }

  return filterEditOnlyFromRows(rows, editOnlyFields);
}

/**
 * Detect OOB ArticleLeft/ArticleRight layout patterns.
 * These use CSS floats (not column classes) to place the image beside article-header.
 * Returns rows if detected, null otherwise.
 */
function detectArticleLayout(
  $: CheerioAPI,
  mainContent: string,
): PublishingLayoutRow[] | null {
  // Look for .article-left or .article-right class on a container
  const $article = $('[class*="article-left"], [class*="article-right"]').first();
  if ($article.length === 0) return null;

  const isLeft = ($article.attr('class') || '').includes('article-left');

  // Gather field names from each structural div
  const captionedImageFields = findFieldNamesInHtml(mainContent, '.captioned-image', $);
  const articleHeaderFields = findFieldNamesInHtml(mainContent, '.article-header', $);
  const articleContentFields = findFieldNamesInHtml(mainContent, '.article-content', $);

  const rows: PublishingLayoutRow[] = [];

  // Row 1: image+caption (left/right) alongside date+byline — two columns
  if (captionedImageFields.length > 0 || articleHeaderFields.length > 0) {
    const imageCol = {
      widthPercent: 33,
      modernWidth: 4,
      fieldNames: captionedImageFields.length > 0 ? captionedImageFields : undefined,
    };
    const headerCol = {
      widthPercent: 66,
      modernWidth: 8,
      fieldNames: articleHeaderFields.length > 0 ? articleHeaderFields : undefined,
    };
    rows.push({
      columns: isLeft ? [imageCol, headerCol] : [headerCol, imageCol],
    });
  }

  // Row 2: article content — full width
  if (articleContentFields.length > 0) {
    rows.push({
      columns: [{
        widthPercent: 100,
        modernWidth: 12,
        fieldNames: articleContentFields,
      }],
    });
  }

  return rows.length > 0 ? rows : null;
}

/** Find field names within elements matching a CSS class selector in the raw ASPX. */
function findFieldNamesInHtml(
  mainContent: string,
  selector: string,
  $: CheerioAPI,
): string[] {
  const $elements = $(selector);
  const names: string[] = [];
  $elements.each((_, el) => {
    const html = $(el).html() || '';
    const regex = /FieldName="([^"]+)"/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      if (!names.includes(match[1])) {
        names.push(match[1]);
      }
    }
  });
  return names;
}

/** Remove edit-only fields from row mappings. */
function filterEditOnlyFromRows(
  rows: PublishingLayoutRow[],
  editOnlyFields: Set<string>,
): PublishingLayoutRow[] {
  if (editOnlyFields.size === 0) return rows;
  return rows.map(row => ({
    columns: row.columns.map(col => ({
      ...col,
      fieldNames: col.fieldNames?.filter(fn => !editOnlyFields.has(fn)),
    })),
  })).filter(row => row.columns.some(
    col => (col.fieldNames?.length ?? 0) > 0 || (col.zoneIds?.length ?? 0) > 0,
  ));
}

/** Look for nested divs with width classes within an element. */
function findNestedColumns(
  $parent: CheerioSelection,
  $: CheerioAPI,
  aspx: string,
  mainContent: string,
): { widthPercent: number; modernWidth: number; zoneIds?: string[]; fieldNames?: string[] }[] {
  const columns: { widthPercent: number; modernWidth: number; zoneIds?: string[]; fieldNames?: string[] }[] = [];

  $parent.children().each((_, child) => {
    if (child.type !== 'tag') return;
    const $child = $(child);
    const classStr = $child.attr('class') || '';
    const width = getWidthFromClasses(classStr);

    if (width) {
      const colZoneIds = findZoneIdsInElement($child, $);
      const colFieldNames = findFieldNamesInElement($child, aspx, mainContent);
      columns.push({
        widthPercent: width,
        modernWidth: toModernWidth(width),
        zoneIds: colZoneIds.length > 0 ? colZoneIds : undefined,
        fieldNames: colFieldNames.length > 0 ? colFieldNames : undefined,
      });
    }
  });

  return columns;
}

/** Find WebPartZone IDs within a Cheerio element. */
function findZoneIdsInElement($el: CheerioSelection, $: CheerioAPI): string[] {
  const html = $.html($el);
  const ids: string[] = [];
  const regex = /<WebPartPages:WebPartZone[^>]*\bid="([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/** Find field names within a Cheerio element by matching FieldName attributes. */
function findFieldNamesInElement(
  $el: CheerioSelection,
  _aspx: string,
  _mainContent: string,
): string[] {
  // We need to work with the raw HTML because Cheerio lowercases ASP.NET server tags
  const $ = cheerio.load(''); // just for $.html
  const html = $el.html() || '';
  const names: string[] = [];
  const regex = /FieldName="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

/** Remove undefined zoneIds/fieldNames from columns. */
function cleanColumns(
  columns: { widthPercent: number; modernWidth: number; zoneIds?: string[]; fieldNames?: string[] }[],
): { widthPercent: number; modernWidth: number; zoneIds?: string[]; fieldNames?: string[] }[] {
  return columns.map(col => {
    const clean: { widthPercent: number; modernWidth: number; zoneIds?: string[]; fieldNames?: string[] } = {
      widthPercent: col.widthPercent,
      modernWidth: col.modernWidth,
    };
    if (col.zoneIds && col.zoneIds.length > 0) clean.zoneIds = col.zoneIds;
    if (col.fieldNames && col.fieldNames.length > 0) clean.fieldNames = col.fieldNames;
    return clean;
  });
}

/**
 * Extract hardcoded (non-server-control) HTML from a publishing layout ASPX.
 * Strips all ASP.NET server tags, EditModePanel blocks, and code blocks.
 * Returns the cleaned HTML if it contains substantive content, or undefined.
 */
export function extractHardcodedHtml(aspxContent: string): string | undefined {
  // 1. Extract PlaceHolderMain content
  const mainMatch = aspxContent.match(/<asp:Content[^>]*PlaceHolderMain[^>]*>([\s\S]*?)<\/asp:Content>/i);
  if (!mainMatch) return undefined;
  let html = mainMatch[1];

  // 2. Strip server-side code blocks (<% ... %>)
  html = html.replace(/<%[\s\S]*?%>/g, '');

  // 3. Strip <script> and <style> blocks entirely
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // 4. Strip EditModePanel blocks entirely (edit-only content)
  // Use any namespace prefix since layouts may use Publishing: or PublishingWebControls:
  html = html.replace(/<[A-Za-z]+:EditModePanel\b[^>]*>[\s\S]*?<\/[A-Za-z]+:EditModePanel>/gi, '');

  // 5. Strip WebPartZone tags entirely (paired + self-closing)
  html = html.replace(/<[A-Za-z]+:WebPartZone\b[^>]*>[\s\S]*?<\/[A-Za-z]+:WebPartZone>/gi, '');
  html = html.replace(/<[A-Za-z]+:WebPartZone\b[^>]*\/>/gi, '');

  // 6. Unwrap remaining paired colon-namespaced tags (remove tags, keep inner HTML)
  //    Standard HTML never uses colons in tag names, so any <Foo:Bar> is an ASP.NET server control.
  //    Iterate until no more matched (handles nesting).
  const pairedRe = /<([A-Za-z]+:[A-Za-z]+)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let prev: string;
  do {
    prev = html;
    html = html.replace(pairedRe, '$2');
  } while (html !== prev);

  // 7. Remove remaining self-closing colon-namespaced tags
  html = html.replace(/<[A-Za-z]+:[A-Za-z]+\b[^>]*\/>/gi, '');

  // 8. Remove any straggler colon-namespaced opening or closing tags
  html = html.replace(/<\/?[A-Za-z]+:[A-Za-z]+\b[^>]*>/gi, '');

  // 9. Check for substantive content
  const $ = cheerio.load(html, null, false);
  const hasText = $.text().replace(/[\s\u200B]+/g, '').length > 0;
  const hasImages = $('img').length > 0;
  const hasLinks = $('a[href]').length > 0;
  const hasHeadings = $('h1, h2, h3, h4, h5, h6').length > 0;

  if (!hasText && !hasImages && !hasLinks && !hasHeadings) {
    return undefined;
  }

  // 10. Clean up whitespace and return
  html = html.replace(/\n{3,}/g, '\n\n').trim();
  return html || undefined;
}

/** Build a fallback mapping when DOM analysis doesn't find structure. */
function buildFallbackMapping(
  fieldControls: PublishingFieldControl[],
  webPartZones: PublishingWebPartZone[],
): PublishingLayoutRow[] {
  // Check if any zones have width hints that suggest a multi-column layout
  const widthZones = webPartZones.filter(z => z.widthPercent != null);

  if (widthZones.length >= 2) {
    // Group zones into a row based on their widths
    return [{
      columns: widthZones.map(z => ({
        widthPercent: z.widthPercent!,
        modernWidth: toModernWidth(z.widthPercent!),
        zoneIds: [z.zoneId],
      })),
    }];
  }

  // Simple fallback: all fields in a single full-width column
  const allFieldNames = fieldControls.map(fc => fc.fieldName);
  const allZoneIds = webPartZones.map(z => z.zoneId);

  return [{
    columns: [{
      widthPercent: 100,
      modernWidth: 12,
      zoneIds: allZoneIds.length > 0 ? allZoneIds : undefined,
      fieldNames: allFieldNames.length > 0 ? allFieldNames : undefined,
    }],
  }];
}
