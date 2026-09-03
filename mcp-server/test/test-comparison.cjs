/**
 * Unit tests for the structural and visual migration quality score.
 *
 * Run: node test/test-comparison.cjs
 */
async function main() {
  const { comparePages } = await import('../dist/tools/compare.js');

  let passed = 0;
  let failed = 0;
  const pass = (label, ok) => {
    if (ok) {
      passed++;
      console.log(`  PASS ${label}`);
    } else {
      failed++;
      process.exitCode = 1;
      console.log(`  FAIL ${label}`);
    }
  };

  const createPage = (overrides = {}) => ({
    pageType: 'modern',
    title: 'Migration test page',
    url: 'https://contoso.sharepoint.com/sites/test/SitePages/migration.aspx',
    headings: [{ tag: 'H2', text: 'Updates' }],
    headingCount: 1,
    links: [],
    linkCount: 0,
    images: [{
      src: 'https://contoso.sharepoint.com/sites/test/SiteAssets/banner.png',
      alt: 'Banner',
      width: 1200,
      height: 400,
    }],
    imageCount: 1,
    webParts: [{
      id: 'news',
      typeName: 'Microsoft.SharePoint.WebPartPages.XsltListViewWebPart',
      title: 'News',
      kind: 'standard',
      innerText: 'Quarterly announcements and company news',
    }],
    webPartCount: 1,
    textLength: 0,
    textPreview: '',
    tableCount: 0,
    codeBlockCount: 0,
    iframeCount: 0,
    layout: {
      sections: [
        { columns: [12] },
        { columns: [4, 8] },
      ],
    },
    ...overrides,
  });

  console.log('\nTest 1: exact DOM and visual match');
  {
    const classic = createPage({ pageType: 'classic' });
    const modern = createPage();
    const result = comparePages(classic, modern, {
      status: 'MATCH',
      layoutMatches: true,
      notes: [],
    });

    pass('returns a perfect score', result.contentCoverage === 100);
    pass('confirms strict layout mapping', result.layoutComparison.strictlyMapped === true);
    pass('does not report web part substitutions', result.webPartComparison.rteSubstitutions.length === 0);
  }

  console.log('\nTest 2: Rich Text substitution, zero-sized image, layout, and heading penalties');
  {
    const classic = createPage({ pageType: 'classic' });
    const modern = createPage({
      headings: [],
      headingCount: 0,
      images: [{
        src: 'https://contoso.sharepoint.com/sites/test/SiteAssets/banner.png',
        alt: 'Banner',
        width: 0,
        height: 400,
      }],
      webParts: [{
        id: 'rich-text-news',
        typeName: 'RTE',
        title: '',
        kind: 'rte',
        innerText: 'Quarterly announcements and company news',
      }],
      layout: {
        sections: [{ columns: [12] }],
      },
    });
    const result = comparePages(classic, modern, {
      status: 'MISMATCH',
      layoutMatches: false,
      notes: ['The second column is absent.'],
    });

    pass('deducts only the requested 30 points', result.contentCoverage === 70);
    pass('reports the Rich Text substitution', result.webPartComparison.rteSubstitutions.length === 1);
    pass('reports the zero-sized image', result.imageComparison.invalidDimensions === 1);
    pass('reports the layout mismatch', result.layoutComparison.strictlyMapped === false);
    pass('reports the missing heading', result.headingComparison.missingInModern.length === 1);
  }

  console.log('\nTest 3: missing web part penalty');
  {
    const classic = createPage({ pageType: 'classic' });
    const modern = createPage({
      webParts: [],
      webPartCount: 0,
    });
    const result = comparePages(classic, modern, {
      status: 'MATCH',
      layoutMatches: true,
      notes: [],
    });

    pass('deducts 20 points for the missing web part', result.contentCoverage === 80);
    pass('reports the missing web part', result.webPartComparison.missing.length === 1);
  }

  console.log('\nTest 4: visual confirmation avoids DOM false positives');
  {
    const classic = createPage({ pageType: 'classic' });
    const modern = createPage({
      images: [],
      imageCount: 0,
      webParts: [],
      webPartCount: 0,
    });
    const result = comparePages(classic, modern, {
      status: 'MATCH',
      layoutMatches: true,
      confirmedWebParts: ['News'],
      confirmedImages: ['Banner'],
      notes: ['The SPFx controls are visible but do not expose standard DOM metadata.'],
    });

    pass('keeps the score when screenshots confirm missing DOM metadata', result.contentCoverage === 100);
    pass('records visual web part confirmation', result.webPartComparison.visuallyConfirmed.length === 1);
    pass('does not report image loss from the DOM false positive', result.imageComparison.missingOrInvalid === 0);
  }

  console.log('\nTest 5: incomplete optional metadata does not fail scoring');
  {
    const classic = createPage({
      pageType: 'classic',
      links: [{ href: 'https://contoso.sharepoint.com/sites/test/news' }],
      images: [{
        src: 'https://contoso.sharepoint.com/sites/test/SiteAssets/banner.png',
        width: 1200,
        height: 400,
      }],
      webParts: [{
        id: 'news',
      }],
    });
    const modern = createPage({
      links: [{ href: 'https://contoso.sharepoint.com/sites/test/news' }],
      images: [{
        src: 'https://contoso.sharepoint.com/sites/test/SiteAssets/banner.png',
        width: 1200,
        height: 400,
      }],
      webParts: [{
        id: 'news',
      }],
    });
    let result;
    try {
      result = comparePages(classic, modern, {
        status: 'MATCH',
        layoutMatches: true,
        notes: [],
      });
    } catch {
      result = undefined;
    }

    pass('scores successfully when optional text metadata is absent', result?.contentCoverage === 100);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
