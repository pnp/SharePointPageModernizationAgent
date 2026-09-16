async function main() {
  const { buildListWebPart } = await import('../dist/tools/builders/list.js');
  const { canvasLayoutToCanvasContent1 } = await import('../dist/sharepoint/canvas-converter.js');

  let failed = 0;
  const pass = (label, condition) => {
    console.log(condition ? `  PASS ${label}` : `  FAIL ${label}`);
    if (!condition) {
      failed++;
      process.exitCode = 1;
    }
  };

  const webpart = buildListWebPart({
    siteUrl: 'https://contoso.sharepoint.com/sites/demo',
    listId: 'c69b2bf0-aafe-4759-9b82-d4bd07dc339b',
    viewId: '1c6d4d7c-a972-4557-8157-167e544f58c6',
    listUrl: '/sites/demo/Lists/Items',
    listTitle: 'Items',
    title: 'OOCL Green - List View',
  });
  const control = JSON.parse(canvasLayoutToCanvasContent1({
    horizontalSections: [{ layout: 'oneColumn', columns: [{ webparts: [webpart] }] }],
  }))[0];

  pass('uses the List web part ID', control.webPartId === 'f92bf067-bc19-489e-a556-7fe95f508720');
  pass('preserves the web part title', control.webPartData.title === 'OOCL Green - List View');
  pass('preserves the list ID', control.webPartData.properties.selectedListId === 'c69b2bf0-aafe-4759-9b82-d4bd07dc339b');
  pass('derives the web-relative list URL', control.webPartData.properties.webRelativeListUrl === '/Lists/Items');
  const spacedList = buildListWebPart({
    siteUrl: 'https://contoso.sharepoint.com/sites/demo',
    listId: 'c69b2bf0-aafe-4759-9b82-d4bd07dc339b',
    viewId: '1c6d4d7c-a972-4557-8157-167e544f58c6',
    listUrl: '/sites/demo/Lists/OOCL%20Demo%20Items',
    listTitle: 'OOCL Demo Items',
  });
  pass(
    'does not double-encode spaces in web-relative URLs',
    spacedList.data.properties.webRelativeListUrl === '/Lists/OOCL Demo Items',
  );
  pass('uses the default List web part height', control.webPartData.properties.webpartHeightKey === 4);
  pass('sets the searchable list title', control.webPartData.serverProcessedContent.searchablePlainTexts.listTitle === 'Items');
  pass('enables List dynamic data', control.webPartData.containsDynamicDataSource === true);

  if (failed === 0) {
    console.log('All List web part tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
