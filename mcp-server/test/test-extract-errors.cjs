/**
 * Regression test for surfacing detailed web part extraction failures.
 *
 * Run: node test/test-extract-errors.cjs
 */
async function main() {
  const { createWebPartExtractionError } = await import('../dist/tools/extract.js');

  const primaryUrl = '/sites/legacyitsite/SitePages/Example.aspx';
  const fallbackUrl = '/sites/legacyitsite/Pages/Example.aspx';
  const error = createWebPartExtractionError(primaryUrl, [
    {
      pageUrl: primaryUrl,
      diagnostics: [
        'REST LimitedWebPartManager failed: SP REST GET failed (429): throttled',
        'CSOM fallback returned zero web part entries',
        'ASPX file parse fallback returned zero web part entries',
      ],
    },
    {
      pageUrl: fallbackUrl,
      diagnostics: [
        'REST LimitedWebPartManager returned zero web part entries',
        'CSOM fallback failed: CSOM request failed (404): not found',
        'ASPX file parse fallback returned zero web part entries',
      ],
    },
  ]);

  const checks = [
    ['returns an Error', error instanceof Error],
    ['identifies the primary page', error.message.includes(primaryUrl)],
    ['includes the REST failure', error.message.includes('SP REST GET failed (429): throttled')],
    ['includes the CSOM failure', error.message.includes('CSOM request failed (404): not found')],
    ['includes the alternate path', error.message.includes(fallbackUrl)],
  ];

  let failures = 0;
  for (const [label, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
    if (!passed) failures++;
  }

  if (failures > 0) process.exit(1);
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
