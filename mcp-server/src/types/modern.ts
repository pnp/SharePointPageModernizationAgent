// ── Layout enums ──

export type SectionLayout =
  | 'oneColumn'
  | 'twoColumns'
  | 'threeColumns'
  | 'oneThirdLeftColumn'
  | 'oneThirdRightColumn'
  | 'fullWidth';

export type SectionEmphasis = 'none' | 'neutral' | 'soft' | 'strong';

// ── Known modern web part IDs ──

export const WebPartId = {
  IMAGE: 'd1d91016-032f-456d-98a4-721247c305e8',
  QUICK_LINKS: 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd',
  DIVIDER: '2161a1c6-db61-4731-b97c-3cdb303f7cbb',
  DOCUMENT_EMBED: 'b7dd04e1-19ce-4b24-9132-b60a1c2b910d',
  EMBED: '490d7c76-1824-45b2-9de3-676421c997fa',
  VIDEO: '275c0095-a77e-4f6d-a2a0-6a7626911518',
  YOUTUBE: '544dd15b-cf3c-441b-96da-004d5a8cea1d',
  BUTTON: '0f087d7f-520e-42b7-89c0-496aaf979d58',
  PEOPLE: '7f718435-ee4d-431c-bdbf-9c4ff326f46e',
  HERO: 'c4bd7b2f-7b6e-4599-8485-16504575f590',
  HIGHLIGHTED_CONTENT: 'daf0b71c-6de8-4ef7-b511-faae7c388708',
  LIST: 'f92bf067-bc19-489e-a556-7fe95f508720',
  BING_MAPS: 'e377ea37-9047-43b9-8cdb-a761be2f8e09',
  LINK_PREVIEW: '6410b3b6-d440-4663-8744-378976dc97bf',
  ORG_CHART: 'e84a8ca2-f63c-4fb9-bc0b-d8eef5ccb22b',
  SPACER: '8654b779-4886-46d4-8ffb-b5ed960ee986',
  IMAGE_GALLERY: 'af8be689-990e-492a-81f7-ba3e4cd3ed9c',
  CALL_TO_ACTION: 'df8e44e7-edd5-46d5-90da-aca1539313b8',
} as const;

/** Web parts supported on Graph v1.0 GA endpoint. */
export const GA_WHITELIST: string[] = [
  WebPartId.IMAGE,
  WebPartId.QUICK_LINKS,
  WebPartId.DIVIDER,
  WebPartId.DOCUMENT_EMBED,
  WebPartId.EMBED,
  WebPartId.YOUTUBE,
  WebPartId.BUTTON,
  WebPartId.PEOPLE,
  WebPartId.HERO,
  WebPartId.HIGHLIGHTED_CONTENT,
  WebPartId.LIST,
  WebPartId.BING_MAPS,
  WebPartId.LINK_PREVIEW,
  WebPartId.ORG_CHART,
];

// ── Canvas layout types ──

export interface HorizontalSectionColumn {
  id: string;
  width: number; // 1-12
  webparts: (TextWebPart | StandardWebPart)[];
}

export interface HorizontalSection {
  layout: SectionLayout;
  emphasis?: SectionEmphasis;
  columns: HorizontalSectionColumn[];
}

export interface CanvasLayout {
  horizontalSections: HorizontalSection[];
}

// ── Web part types ──

export interface TextWebPart {
  '@odata.type': '#microsoft.graph.textWebPart';
  innerHtml: string;
}

export interface StandardWebPart {
  '@odata.type'?: '#microsoft.graph.standardWebPart';
  containerTextWebPartId?: string;
  webPartType: string;
  data: {
    dataVersion?: string;
    title?: string;
    properties: Record<string, unknown>;
    serverProcessedContent?: {
      htmlStrings?: MetaDataKeyStringPair[];
      searchablePlainTexts?: MetaDataKeyStringPair[];
      imageSources?: MetaDataKeyStringPair[];
      links?: MetaDataKeyStringPair[];
      componentDependencies?: MetaDataKeyStringPair[];
      customMetadata?: MetaDataKeyValuePair[];
    };
  };
}

/** Graph API key-value pair for serverProcessedContent collections. */
export interface MetaDataKeyStringPair {
  key: string;
  value: string;
}

/** Graph API key-value pair for customMetadata in serverProcessedContent. */
export interface MetaDataKeyValuePair {
  key: string;
  value: Record<string, string>;
}

// ── Title area ──

export interface TitleArea {
  '@odata.type'?: '#microsoft.graph.titleArea';
  enableGradientEffect?: boolean;
  imageWebUrl?: string;
  layout?: 'plain' | 'imageAndTitle' | 'overlap' | 'colorBlock';
  showAuthor?: boolean;
  showPublishedDate?: boolean;
  showTextBlockAboveTitle?: boolean;
  textAboveTitle?: string;
  textAlignment?: 'left' | 'center';
  title?: string;
}

// ── Page creation request ──

export interface GraphPageCreateRequest {
  '@odata.type'?: '#microsoft.graph.sitePage';
  name: string;
  title: string;
  pageLayout?: 'article' | 'home';
  showComments?: boolean;
  showRecommendedPages?: boolean;
  titleArea?: TitleArea;
  canvasLayout?: CanvasLayout;
}
