function parseTitleRegion(content) {
  const titleRegions = JSON.parse(content);
  if (!Array.isArray(titleRegions) || titleRegions.length !== 1) {
    throw new Error('Title area content must contain exactly one title region.');
  }
  return titleRegions[0];
}

async function main() {
  const { titleAreaToLayoutWebpartsContent } = await import('../dist/sharepoint/title-area.js');

  let failed = 0;
  const pass = (label, condition) => {
    console.log(condition ? `  PASS ${label}` : `  FAIL ${label}`);
    if (!condition) {
      failed++;
      process.exitCode = 1;
    }
  };

  const plainTitleRegion = parseTitleRegion(titleAreaToLayoutWebpartsContent('OOCL Enterprise Wiki 01 Green'));
  pass('uses the title region web part', plainTitleRegion.id === 'cbe7b0a9-3504-44dd-a3a3-0e5cacd07788');
  pass('preserves the page title', plainTitleRegion.properties.title === 'OOCL Enterprise Wiki 01 Green');
  pass('creates a visible plain title area', plainTitleRegion.properties.layoutType === 'FullWidthImage');
  pass('uses no-image mode for plain title areas', plainTitleRegion.properties.imageSourceType === 4);
  pass('creates a committed title region', plainTitleRegion.properties.hasTitleBeenCommitted === true);

  const imageTitleRegion = parseTitleRegion(titleAreaToLayoutWebpartsContent('Page title', {
    imageWebUrl: '/sites/demo/SiteAssets/banner.jpg',
    layout: 'imageAndTitle',
    textAlignment: 'center',
  }));
  pass('creates an image title area', imageTitleRegion.properties.imageSourceType === 2);
  pass('uses full-width image layout', imageTitleRegion.properties.layoutType === 'FullWidthImage');
  pass('preserves title alignment', imageTitleRegion.properties.textAlignment === 'center');
  pass(
    'preserves the title area image',
    imageTitleRegion.serverProcessedContent.imageSources.imageSource === '/sites/demo/SiteAssets/banner.jpg',
  );

  if (failed === 0) {
    console.log('All title area tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
