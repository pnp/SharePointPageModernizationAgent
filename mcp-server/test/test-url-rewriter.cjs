async function main() {
  const { rewriteUrls } = await import('../dist/utils/url-rewriter.js');

  const pass = (label, ok) => {
    console.log(ok ? `  \u2705 ${label}` : `  \u274c ${label}`);
    if (!ok) process.exitCode = 1;
  };

  console.log('=== URL Rewriter Tests ===\n');

  // Test 1: Explicit URL mapping
  console.log('Test 1: Explicit URL mapping');
  const r1 = rewriteUrls(
    '<img src="/sites/source/SiteAssets/photo.png">',
    [{ sourceUrl: '/sites/source/SiteAssets/photo.png', destUrl: '/sites/dest/SiteAssets/photo.png' }],
  );
  pass('URL rewritten', r1.content.includes('/sites/dest/SiteAssets/photo.png'));
  pass('1 replacement', r1.totalReplacements === 1);

  // Test 2: Multiple mappings
  console.log('\nTest 2: Multiple mappings');
  const r2 = rewriteUrls(
    '<img src="/a/img1.png"><img src="/a/img2.png">',
    [
      { sourceUrl: '/a/img1.png', destUrl: '/b/img1.png' },
      { sourceUrl: '/a/img2.png', destUrl: '/b/img2.png' },
    ],
  );
  pass('Both rewritten', r2.content.includes('/b/img1.png') && r2.content.includes('/b/img2.png'));
  pass('2 replacements', r2.totalReplacements === 2);

  // Test 3: Path-based substitution
  console.log('\nTest 3: Path-based substitution');
  const r3 = rewriteUrls(
    '<a href="/teams/old-site/Pages/About.aspx">About</a>',
    [],
    '/teams/old-site',
    '/sites/new-site',
  );
  pass('Path rewritten', r3.content.includes('/sites/new-site/Pages/About.aspx'));

  // Test 4: Longest match first
  console.log('\nTest 4: Longest match first');
  const r4 = rewriteUrls(
    '<img src="/sites/source/SiteAssets/sub/photo.png">',
    [
      { sourceUrl: '/sites/source/', destUrl: '/sites/dest/' },
      { sourceUrl: '/sites/source/SiteAssets/sub/photo.png', destUrl: '/sites/dest/SiteAssets/migrated.png' },
    ],
  );
  pass('Longer match wins', r4.content.includes('/sites/dest/SiteAssets/migrated.png'));

  // Test 5: No changes when content has no matching URLs
  console.log('\nTest 5: No-op when no matches');
  const r5 = rewriteUrls('<p>Hello world</p>', [{ sourceUrl: '/foo', destUrl: '/bar' }]);
  pass('Content unchanged', r5.content === '<p>Hello world</p>');
  pass('0 replacements', r5.totalReplacements === 0);

  // Test 6: URL-encoded variants
  console.log('\nTest 6: URL-encoded variants');
  const r6 = rewriteUrls(
    '<img src="/sites/source/PublishingImages/Pages/My%20Page/photo.png">',
    [{ sourceUrl: '/sites/source/PublishingImages/Pages/My Page/photo.png', destUrl: '/sites/dest/SiteAssets/photo.png' }],
  );
  pass('Decoded variant matched', r6.content.includes('/sites/dest/SiteAssets/photo.png'));

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
