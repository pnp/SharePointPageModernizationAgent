// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

/**
 * Unit tests for the supporting helpers in html-sanitizer:
 *   - extractLinks(html)
 *   - hasLinkListPattern(html)
 *
 * cleanWikiHtml has its own test (test-safelinks.cjs); these helpers were
 * previously uncovered.
 *
 * Run: node test/test-html-sanitizer-helpers.cjs
 */
async function main() {
  const { extractLinks, hasLinkListPattern } = await import(
    '../dist/utils/html-sanitizer.js'
  );

  let passed = 0;
  let failed = 0;
  const pass = (label, ok) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; process.exitCode = 1; console.log(`  ❌ ${label}`); }
  };

  // ── extractLinks ─────────────────────────────────────────────────
  console.log('\n--- extractLinks ---');

  // Test 1: empty / no links
  {
    pass('empty string → []', extractLinks('').length === 0);
    pass('plain text → []', extractLinks('<p>No links here</p>').length === 0);
  }

  // Test 2: single anchor
  {
    const links = extractLinks('<a href="https://example.com">Example</a>');
    pass('one link extracted', links.length === 1);
    pass('text trimmed', links[0].text === 'Example');
    pass('url captured', links[0].url === 'https://example.com');
  }

  // Test 3: multiple anchors preserve order
  {
    const links = extractLinks(
      '<a href="/a">First</a> middle text <a href="/b">Second</a><a href="/c">Third</a>',
    );
    pass('three links extracted', links.length === 3);
    pass('order preserved', links[0].text === 'First' && links[1].text === 'Second' && links[2].text === 'Third');
    pass('urls captured in order', links[0].url === '/a' && links[1].url === '/b' && links[2].url === '/c');
  }

  // Test 4: whitespace trimmed
  {
    const links = extractLinks('<a href="/x">   Spaced   </a>');
    pass('leading/trailing whitespace trimmed', links[0].text === 'Spaced');
  }

  // Test 5: anchor without href is skipped (selector is a[href])
  {
    const links = extractLinks('<a>No href</a><a href="/yes">Yes</a>');
    pass('anchor without href excluded', links.length === 1);
    pass('only href anchor returned', links[0].text === 'Yes');
  }

  // Test 6: nested markup in anchor text is flattened
  {
    const links = extractLinks('<a href="/n"><strong>Bold</strong> and <em>italic</em></a>');
    pass('nested text captured', links.length === 1);
    pass('text flattened', links[0].text === 'Bold and italic');
  }

  // Test 7: nested anchors inside list items — captured
  {
    const html = '<ul><li><a href="/one">One</a></li><li><a href="/two">Two</a></li></ul>';
    const links = extractLinks(html);
    pass('two list-item links extracted', links.length === 2);
  }

  // Test 8: empty href attribute still captured
  {
    const links = extractLinks('<a href="">empty</a>');
    pass('empty href anchor included', links.length === 1);
    pass('url is empty string', links[0].url === '');
  }

  // ── hasLinkListPattern ───────────────────────────────────────────
  console.log('\n--- hasLinkListPattern ---');

  // Test 9: empty input
  {
    pass('empty → false', hasLinkListPattern('') === false);
    pass('no list → false', hasLinkListPattern('<p><a href="/x">x</a></p>') === false);
  }

  // Test 10: <ul> all items contain links → true
  {
    const html = '<ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li></ul>';
    pass('all-link <ul> detected', hasLinkListPattern(html) === true);
  }

  // Test 11: <ol> all items contain links → true
  {
    const html = '<ol><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ol>';
    pass('all-link <ol> detected', hasLinkListPattern(html) === true);
  }

  // Test 12: list with no links → false
  {
    const html = '<ul><li>Plain item one</li><li>Plain item two</li></ul>';
    pass('plain text list → false', hasLinkListPattern(html) === false);
  }

  // Test 13: list with one link out of five (20%) → false
  {
    const html = '<ul>' +
      '<li><a href="/x">linked</a></li>' +
      '<li>plain</li><li>plain</li><li>plain</li><li>plain</li>' +
      '</ul>';
    pass('20% link list → false (below 60% threshold)', hasLinkListPattern(html) === false);
  }

  // Test 14: list with 3/5 links (60%) → true (threshold is >=0.6)
  {
    const html = '<ul>' +
      '<li><a href="/a">A</a></li>' +
      '<li><a href="/b">B</a></li>' +
      '<li><a href="/c">C</a></li>' +
      '<li>plain</li><li>plain</li>' +
      '</ul>';
    pass('60% link list → true', hasLinkListPattern(html) === true);
  }

  // Test 15: list with 1/2 links (50%) → false
  {
    const html = '<ul><li><a href="/x">linked</a></li><li>plain</li></ul>';
    pass('50% link list → false', hasLinkListPattern(html) === false);
  }

  // Test 16: empty list (no items) is skipped, does not throw
  {
    const html = '<ul></ul>';
    pass('empty <ul> → false (no items)', hasLinkListPattern(html) === false);
  }

  // Test 17: nested lists — outer triggers if inner pattern qualifies
  {
    const html = '<ul><li><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></li></ul>';
    pass('nested list with all links → true', hasLinkListPattern(html) === true);
  }

  // Test 18: anchor outside list does not count
  {
    const html = '<p><a href="/x">outside</a></p><ul><li>plain</li><li>plain</li></ul>';
    pass('outside-list anchor ignored', hasLinkListPattern(html) === false);
  }

  // Test 19: multiple lists — only one needs to qualify
  {
    const html =
      '<ul><li>plain</li><li>plain</li></ul>' +
      '<ol><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ol>';
    pass('any qualifying list → true', hasLinkListPattern(html) === true);
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
