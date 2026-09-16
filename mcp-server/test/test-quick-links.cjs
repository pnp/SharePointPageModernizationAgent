async function main() {
  const { buildQuickLinksWebPart } = await import('../dist/tools/builders/quick-links.js');

  let failed = 0;
  const pass = (label, condition) => {
    console.log(condition ? `  PASS ${label}` : `  FAIL ${label}`);
    if (!condition) {
      failed++;
      process.exitCode = 1;
    }
  };

  const webpart = buildQuickLinksWebPart({
    title: 'OOCL Green - Summary Links',
    layoutId: 'List',
    links: [{
      title: 'Demo list',
      description: 'Synthetic same-Web list',
      url: 'https://contoso.sharepoint.com/sites/demo/Lists/Items',
    }],
  });

  const searchableText = webpart.data.serverProcessedContent.searchablePlainTexts;
  pass('web part title is preserved', webpart.data.title === 'OOCL Green - Summary Links');
  pass('visible title property is populated', webpart.data.properties.title === 'OOCL Green - Summary Links');
  pass(
    'title is available to the renderer',
    searchableText.some((entry) => entry.key === 'title' && entry.value === 'OOCL Green - Summary Links'),
  );
  pass(
    'link title is available to the renderer',
    searchableText.some((entry) => entry.key === 'items[0].title' && entry.value === 'Demo list'),
  );

  if (failed === 0) {
    console.log('All Quick Links tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
