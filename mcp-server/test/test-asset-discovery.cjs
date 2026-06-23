// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

async function main() {
  const { discoverAssets } = await import('../dist/utils/asset-discovery.js');

  const pass = (label, ok) => {
    console.log(ok ? `  \u2705 ${label}` : `  \u274c ${label}`);
    if (!ok) process.exitCode = 1;
  };

  console.log('=== Asset Discovery Tests ===\n');

  // Test 1: Discover images in wikiHtml
  console.log('Test 1: Images in wikiHtml');
  const bundle1 = {
    wikiHtml: '<p><img src="/sites/test/SiteAssets/photo.png" /><a href="/sites/test/Documents/file.pdf">PDF</a></p>',
  };
  const inv1 = discoverAssets(bundle1, 'https://source.sharepoint.com/sites/test');
  pass('Found 2 assets', inv1.totalCount === 2);
  pass('Image classified', inv1.assets.find(a => a.type === 'image') !== undefined);
  pass('Document classified', inv1.assets.find(a => a.type === 'document') !== undefined);

  // Test 2: Cross-tenant classification
  console.log('\nTest 2: Cross-tenant classification');
  const bundle2 = {
    wikiHtml: '<img src="/sites/test/SiteAssets/photo.png">',
  };
  const inv2 = discoverAssets(bundle2, 'https://source.sharepoint.com/sites/test', 'https://dest.sharepoint.com/sites/dest');
  pass('1 cross-tenant asset', inv2.crossTenantAssets.length === 1);
  pass('0 same-tenant assets', inv2.sameTenantAssets.length === 0);

  // Test 3: Same-tenant (no dest URL)
  console.log('\nTest 3: Same-tenant (no dest URL)');
  const inv3 = discoverAssets(bundle2, 'https://source.sharepoint.com/sites/test');
  pass('0 cross-tenant', inv3.crossTenantAssets.length === 0);
  pass('1 same-tenant', inv3.sameTenantAssets.length === 1);

  // Test 4: Publishing fields
  console.log('\nTest 4: Publishing fields');
  const bundle4 = {
    publishingFields: {
      PublishingPageContent: '<img src="/sites/pub/PublishingImages/banner.jpg">',
      PublishingPageImage: '<img src="/sites/pub/PublishingImages/thumb.png">',
    },
  };
  const inv4 = discoverAssets(bundle4, 'https://source.sharepoint.com/sites/pub');
  pass('Found 2 assets from publishing fields', inv4.totalCount === 2);
  pass('Sources tracked', inv4.assets[0].source.startsWith('publishingField:'));

  // Test 5: Web part resolved HTML
  console.log('\nTest 5: Web part resolvedHtml');
  const bundle5 = {
    webParts: [
      { resolvedHtml: '<img src="/sites/test/images/logo.png">', typeName: 'ContentEditorWebPart', title: 'Logo' },
    ],
  };
  const inv5 = discoverAssets(bundle5, 'https://source.sharepoint.com/sites/test');
  pass('Found 1 asset from web part', inv5.totalCount === 1);
  pass('Source is webPart:ContentEditorWebPart', inv5.assets[0].source === 'webPart:ContentEditorWebPart');

  // Test 6: Deduplication
  console.log('\nTest 6: Deduplication');
  const bundle6 = {
    wikiHtml: '<img src="/sites/test/img.png"><img src="/sites/test/img.png">',
  };
  const inv6 = discoverAssets(bundle6, 'https://source.sharepoint.com/sites/test');
  pass('Deduplicated to 1 asset', inv6.totalCount === 1);

  // Test 7: Absolute URLs
  console.log('\nTest 7: Absolute URLs');
  const bundle7 = {
    wikiHtml: '<img src="https://source.sharepoint.com/sites/test/SiteAssets/abs.png">',
  };
  const inv7 = discoverAssets(bundle7, 'https://source.sharepoint.com/sites/test', 'https://dest.sharepoint.com/sites/dest');
  pass('Absolute URL discovered', inv7.totalCount === 1);
  pass('Classified as cross-tenant', inv7.crossTenantAssets.length === 1);

  // Test 8: byType counts
  console.log('\nTest 8: byType counts');
  const bundle8 = {
    wikiHtml: '<img src="/s/a.png"><img src="/s/b.jpg"><link href="/s/c.css"><script src="/s/d.js"></script>',
  };
  const inv8 = discoverAssets(bundle8, 'https://source.sharepoint.com/s');
  pass('2 images', inv8.byType.image === 2);
  pass('1 css', inv8.byType.css === 1);
  pass('1 js', inv8.byType.js === 1);

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
