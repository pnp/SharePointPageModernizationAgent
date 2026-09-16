async function main() {
  const { buildImageWebPart } = await import('../dist/tools/builders/image.js');
  const { canvasLayoutToCanvasContent1 } = await import('../dist/sharepoint/canvas-converter.js');

  let failed = 0;
  const pass = (label, condition) => {
    console.log(condition ? `  PASS ${label}` : `  FAIL ${label}`);
    if (!condition) {
      failed++;
      process.exitCode = 1;
    }
  };

  const webpart = buildImageWebPart({
    imageUrl: '/sites/demo/SiteAssets/green.png',
    altText: 'OOCL Green portable image',
    linkUrl: '/sites/demo/SitePages',
    imgWidth: 960,
    imgHeight: 320,
    siteId: 'c46ece3c-8014-43d6-abb8-9ba6725ad189',
    webId: '4320db13-3881-4c8f-818b-1ad803569572',
    listId: 'e737f386-0cc9-4800-a356-ecfd91da681e',
    uniqueId: 'f38cbec8-7512-42da-a096-d9f3d9405427',
    fileName: 'green.png',
  });
  const control = JSON.parse(canvasLayoutToCanvasContent1({
    horizontalSections: [{ layout: 'oneColumn', columns: [{ webparts: [webpart] }] }],
  }))[0];
  const { properties, serverProcessedContent } = control.webPartData;

  pass('preserves source image IDs', properties.uniqueId === 'f38cbec8-7512-42da-a096-d9f3d9405427');
  pass('preserves source dimensions', properties.imgWidth === 960 && properties.imgHeight === 320);
  pass('preserves image link', serverProcessedContent.links.linkUrl === '/sites/demo/SitePages');
  pass('serializes custom metadata', serverProcessedContent.customMetadata.imageSource.uniqueId === 'f38cbec8-7512-42da-a096-d9f3d9405427');
  pass('serializes custom metadata dimensions', serverProcessedContent.customMetadata.imageSource.width === '960');
  pass('preserves image dynamic data', JSON.stringify(control.webPartData.dynamicDataPaths) === '{}');

  const expectFailure = (label, callback, expectedMessage) => {
    try {
      callback();
      pass(label, false);
    } catch (error) {
      pass(label, error instanceof Error && error.message.includes(expectedMessage));
    }
  };

  expectFailure(
    'rejects SVG Image web parts',
    () => buildImageWebPart({
      imageUrl: '/sites/demo/SiteAssets/green.svg',
      imgWidth: 960,
      imgHeight: 320,
      siteId: 'c46ece3c-8014-43d6-abb8-9ba6725ad189',
      webId: '4320db13-3881-4c8f-818b-1ad803569572',
      listId: 'e737f386-0cc9-4800-a356-ecfd91da681e',
      uniqueId: 'f38cbec8-7512-42da-a096-d9f3d9405427',
    }),
    'SVG images must use build_text_webpart',
  );
  expectFailure(
    'rejects missing image dimensions',
    () => buildImageWebPart({
      imageUrl: '/sites/demo/SiteAssets/green.png',
      siteId: 'c46ece3c-8014-43d6-abb8-9ba6725ad189',
      webId: '4320db13-3881-4c8f-818b-1ad803569572',
      listId: 'e737f386-0cc9-4800-a356-ecfd91da681e',
      uniqueId: 'f38cbec8-7512-42da-a096-d9f3d9405427',
    }),
    'requires positive imgWidth and imgHeight',
  );
  expectFailure(
    'rejects missing source metadata',
    () => buildImageWebPart({
      imageUrl: '/sites/demo/SiteAssets/green.png',
      imgWidth: 960,
      imgHeight: 320,
    }),
    'requires siteId, webId, listId, and uniqueId',
  );

  if (failed === 0) {
    console.log('All Image web part tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
