import type { TitleArea } from '../types/modern.js';

const TITLE_REGION_WEBPART_ID = 'cbe7b0a9-3504-44dd-a3a3-0e5cacd07788';
const TITLE_REGION_DATA_VERSION = '1.4';

const TITLE_AREA_LAYOUT_TYPES: Record<NonNullable<TitleArea['layout']>, string> = {
  plain: 'FullWidthImage',
  imageAndTitle: 'FullWidthImage',
  overlap: 'Overlap',
  colorBlock: 'ColorBlock',
};

export function titleAreaToLayoutWebpartsContent(pageTitle: string, titleArea?: TitleArea): string {
  const title = titleArea?.title?.trim() || pageTitle.trim();
  if (!title) {
    throw new Error('A page title is required to create a title area.');
  }

  const imageWebUrl = titleArea?.imageWebUrl?.trim();
  const hasImage = Boolean(imageWebUrl);
  const properties: Record<string, unknown> = {
    title,
    imageSourceType: hasImage ? 2 : 4,
    layoutType: TITLE_AREA_LAYOUT_TYPES[titleArea?.layout ?? 'plain'],
    textAlignment: titleArea?.textAlignment ?? 'left',
    showTopicHeader: titleArea?.showTextBlockAboveTitle ?? false,
    showPublishDate: titleArea?.showPublishedDate ?? false,
    topicHeader: titleArea?.textAboveTitle ?? '',
  };

  if (titleArea?.enableGradientEffect !== undefined) {
    properties.enableGradientEffect = titleArea.enableGradientEffect;
  }

  if (titleArea?.showAuthor !== undefined) {
    properties.showAuthor = titleArea.showAuthor;
  }

  const titleRegion = {
    id: TITLE_REGION_WEBPART_ID,
    instanceId: TITLE_REGION_WEBPART_ID,
    title: 'Title Region',
    description: 'Title Region Description',
    serverProcessedContent: {
      htmlStrings: {},
      searchablePlainTexts: {},
      imageSources: hasImage ? { imageSource: imageWebUrl } : {},
      links: {},
    },
    dataVersion: TITLE_REGION_DATA_VERSION,
    properties,
  };

  return JSON.stringify([{
    ...titleRegion,
    audiences: [],
    containsDynamicDataSource: false,
    reservedHeight: 280,
    properties: {
      ...properties,
      authors: [],
      authorByline: [],
      hasTitleBeenCommitted: true,
    },
  }]);
}
