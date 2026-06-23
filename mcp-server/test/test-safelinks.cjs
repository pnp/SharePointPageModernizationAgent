// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

// Quick test: SafeLinks remnant attribute cleanup
async function main() {
  const { cleanWikiHtml } = await import('../dist/utils/html-sanitizer.js');

  const input = `<a href="https://nam06.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com&amp;data=05%7C01%7C%7Cabc" data-auth="NotApplicable" data-linkindex="0" data-safelink="true" aria-label="Original URL: https://example.com. Click or tap if you trust this link." title="Original URL: https://example.com">Example</a>`;

  const { html } = cleanWikiHtml(input);

  const pass = (label, ok) => {
    console.log(ok ? `  ✅ ${label}` : `  ❌ ${label}`);
    if (!ok) process.exitCode = 1;
  };

  console.log('Output:', html);
  pass('href unwrapped to https://example.com', html.includes('href="https://example.com"'));
  pass('data-auth removed', !html.includes('data-auth'));
  pass('data-linkindex removed', !html.includes('data-linkindex'));
  pass('data-safelink removed', !html.includes('data-safelink'));
  pass('aria-label removed', !html.includes('aria-label'));
  pass('title removed', !html.includes('title='));
  pass('link text preserved', html.includes('Example'));
}

main().catch(err => { console.error(err); process.exit(1); });
