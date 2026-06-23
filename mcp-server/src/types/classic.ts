/** Represents a fully extracted classic SharePoint page with all its content. */
export interface ClassicPageBundle {
  pageType: 'wiki' | 'webpart' | 'publishing';
  title: string;
  url: string;
  siteUrl: string;

  // Wiki pages
  wikiHtml?: string;
  wikiZones?: WikiZone[];

  // Web part pages
  layoutTemplate?: string; // e.g. "spstd1.aspx"
  zones?: WebPartZone[];

  // Publishing pages
  publishingLayoutUrl?: string;     // URL from PublishingPageLayout field
  publishingLayoutName?: string;    // e.g. "ArticleLeft.aspx"
  publishingLayout?: PublishingLayoutInfo;  // parsed layout structure
  publishingFields?: Record<string, string>; // field values from FieldValuesForEdit (e.g. PublishingPageImage)
  publishingLayoutHtml?: string;             // Hardcoded HTML from the layout ASPX template (content not in fields or web parts)

  // Page author (from Author field on the list item)
  author?: {
    name: string;
    email: string;
    loginName: string;
  };

  // All resolved web parts
  webParts: ClassicWebPartInfo[];
}

export interface WikiZone {
  index: number;
  html: string;
  webPartIds: string[];
}

export interface WebPartZone {
  zoneId: string;
  webParts: ClassicWebPartInfo[];
}

export interface ClassicWebPartInfo {
  id: string;
  typeName: string;
  title: string;
  zoneId?: string;
  zoneIndex?: number;
  properties: Record<string, unknown>;
  resolvedHtml?: string;
  contentLink?: string;
  hasScripts: boolean;
}

/** Parsed structure of a publishing page layout ASPX. */
export interface PublishingLayoutInfo {
  layoutName: string;            // e.g. "ArticleLeft.aspx"
  fieldControls: PublishingFieldControl[];
  webPartZones: PublishingWebPartZone[];
  /** Modern section rows derived from CSS classes. Each row = array of columns with widths out of 12. */
  modernMapping: PublishingLayoutRow[];
}

export interface PublishingFieldControl {
  fieldName: string;            // e.g. "PublishingPageContent"
  controlType: string;          // e.g. "RichHtmlField", "RichImageField", "TextField"
  containerClass?: string;      // CSS class on parent div, e.g. "article-content", "captioned-image"
  editOnly?: boolean;           // true if inside an EditModePanel (not rendered on published page)
}

export interface PublishingWebPartZone {
  zoneId: string;               // e.g. "Header", "TopLeftRow"
  containerClass?: string;      // CSS class giving width hint, e.g. "tableCol-50"
  widthPercent?: number;         // derived: 50, 33, 25, 75, 100
}

export interface PublishingLayoutRow {
  columns: PublishingLayoutColumn[];
}

export interface PublishingLayoutColumn {
  widthPercent: number;
  modernWidth: number;
  zoneIds?: string[];
  fieldNames?: string[];
}
