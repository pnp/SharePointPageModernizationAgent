// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

// Test: PnP-style HTML transformation rules
async function main() {
  const { transformHtml } = await import('../dist/utils/html-transformator.js');

  let failures = 0;
  const pass = (label, ok) => {
    console.log(ok ? `  ✅ ${label}` : `  ❌ ${label}`);
    if (!ok) { failures++; process.exitCode = 1; }
  };

  // ── Heading shift ──────────────────────────────────────────────
  console.log('\n--- Heading shift ---');
  {
    const out = transformHtml('<h1>Title</h1><h2>Sub</h2><h3>Sub2</h3>');
    pass('h1 → h2', out.includes('<h2>Title</h2>'));
    pass('h2 → h3', out.includes('<h3>Sub</h3>'));
    pass('h3 → h4', out.includes('<h4>Sub2</h4>'));
  }
  {
    const out = transformHtml('<h4>Four</h4><h5>Five</h5><h6>Six</h6>');
    pass('h4 → div', out.includes('<div>Four</div>'));
    pass('h5 → div', out.includes('<div>Five</div>'));
    pass('h6 → div', out.includes('<div>Six</div>'));
  }
  {
    const out = transformHtml('<h1 style="text-align:center">Centered</h1>');
    pass('preserves text-align during heading shift', out.includes('text-align:center') && out.includes('<h2'));
  }

  // ── Font size class mapping ────────────────────────────────────
  console.log('\n--- Font size mapping ---');
  {
    const out = transformHtml('<span class="ms-rtefontsize-1">Small</span>');
    pass('fontsize 1 → fontSizeSmall', out.includes('fontSizeSmall'));
    pass('original class removed', !out.includes('ms-rtefontsize'));
  }
  {
    const out = transformHtml('<span class="ms-rtefontsize-4">Default</span>');
    pass('fontsize 4 → removed (default)', !out.includes('fontsize') && !out.includes('ms-rte'));
  }
  {
    const out = transformHtml('<span class="ms-rtefontsize-8">Super</span>');
    pass('fontsize 8 → fontSizeSuper', out.includes('fontSizeSuper'));
  }

  // ── Foreground color mapping ───────────────────────────────────
  console.log('\n--- Foreground color mapping ---');
  {
    const out = transformHtml('<span class="ms-rteforecolor-2">Red</span>');
    pass('forecolor 2 → fontColorRed', out.includes('fontColorRed'));
  }
  {
    const out = transformHtml('<span class="ms-rteforecolor-8">Blue</span>');
    pass('forecolor 8 → fontColorBlue', out.includes('fontColorBlue'));
  }

  // ── Theme foreground color mapping ─────────────────────────────
  console.log('\n--- Theme foreground color mapping ---');
  {
    const out = transformHtml('<span class="ms-rtethemeforecolor-0">Default</span>');
    pass('theme forecolor 0 → removed', !out.includes('fontColor') && !out.includes('ms-rte'));
  }
  {
    const out = transformHtml('<span class="ms-rtethemeforecolor-2">Primary</span>');
    pass('theme forecolor 2 → fontColorThemePrimary', out.includes('fontColorThemePrimary'));
  }

  // ── Background color mapping ───────────────────────────────────
  console.log('\n--- Background color mapping ---');
  {
    const out = transformHtml('<span class="ms-rtebackcolor-3">Yellow</span>');
    pass('backcolor 3 → highlightColorYellow', out.includes('highlightColorYellow'));
  }
  {
    const out = transformHtml('<span class="ms-rtebackcolor-8">Blue</span>');
    pass('backcolor 8 → highlightColorBlue', out.includes('highlightColorBlue'));
  }

  // ── Theme background → removed ────────────────────────────────
  console.log('\n--- Theme background removal ---');
  {
    const out = transformHtml('<span class="ms-rtethemebackcolor-4">Themed</span>');
    pass('theme backcolor removed', !out.includes('ms-rtethemebackcolor'));
  }

  // ── Font face → removed ───────────────────────────────────────
  console.log('\n--- Font face removal ---');
  {
    const out = transformHtml('<span class="ms-rtefontface-5">Custom Font</span>');
    pass('fontface removed', !out.includes('ms-rtefontface'));
  }

  // ── RTE style mapping ─────────────────────────────────────────
  console.log('\n--- RTE style mapping ---');
  {
    const out = transformHtml('<span class="ms-rtestyle-quote">Quoted</span>');
    pass('quote → wraps in <em>', out.includes('<em>Quoted</em>'));
    pass('quote class removed', !out.includes('ms-rtestyle'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-intenseQuote">IQ</span>');
    pass('intenseQuote → <em><u>', out.includes('<em><u>IQ</u></em>'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-emphasis">Emp</span>');
    pass('emphasis → <em> + fontColorBlue', out.includes('<em>Emp</em>') && out.includes('fontColorBlue'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-intenseEmphasis">IE</span>');
    pass('intenseEmphasis → <em><u> + fontColorBlue', out.includes('<em><u>IE</u></em>') && out.includes('fontColorBlue'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-accent1">A1</span>');
    pass('accent1 → fontColorBlue', out.includes('fontColorBlue'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-accent2">A2</span>');
    pass('accent2 → fontColorBlueDark', out.includes('fontColorBlueDark'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-normal">Normal</span>');
    pass('normal → class removed', !out.includes('ms-rtestyle'));
  }
  {
    const out = transformHtml('<span class="ms-rtestyle-intenseReferences">IR</span>');
    pass('intenseReferences → <u>', out.includes('<u>IR</u>'));
  }

  // ── Table modernization ───────────────────────────────────────
  console.log('\n--- Table modernization ---');
  {
    const out = transformHtml('<table class="ms-rteTable-1"><tr><th>Header</th><td class="ms-rteTable-default">Cell</td></tr></table>');
    pass('table class → bandedRowTableStyleNeutral', out.includes('bandedRowTableStyleNeutral'));
    pass('responsive wrapper added', out.includes('canvasRteResponsiveTable') && out.includes('tableWrapper'));
    pass('th → td with <strong>', out.includes('<td') && out.includes('<strong>Header</strong>'));
    pass('ms-rteTable-default removed from td', !out.includes('ms-rteTable-default'));
  }
  {
    const out = transformHtml('<table class="ms-rteTable-0"><tr><td>A</td></tr></table>');
    pass('table style 0 → simpleTableStyleNeutral', out.includes('simpleTableStyleNeutral'));
  }
  {
    const out = transformHtml('<table class="ms-rteTable-99"><tr><td>A</td></tr></table>');
    pass('unknown table style → borderHeaderTableStyleNeutral', out.includes('borderHeaderTableStyleNeutral'));
  }

  // ── Blockquote conversion ─────────────────────────────────────
  console.log('\n--- Blockquote conversion ---');
  {
    const out = transformHtml('<blockquote style="margin-left:60px">Indented</blockquote>');
    pass('blockquote with margin → p margin-left:60px', out.includes('<p style="margin-left:60px">Indented</p>'));
    pass('blockquote tag removed', !out.includes('blockquote'));
  }
  {
    const out = transformHtml('<blockquote>Default</blockquote>');
    pass('blockquote default → margin-left:40px', out.includes('margin-left:40px'));
  }

  // ── <hr> conversion ───────────────────────────────────────────
  console.log('\n--- <hr> conversion ---');
  {
    const out = transformHtml('<p>Before</p><hr><p>After</p>');
    pass('hr → span with br', out.includes('<span><br><br></span>'));
    pass('hr tag removed', !out.includes('<hr'));
  }

  // ── Text decoration ───────────────────────────────────────────
  console.log('\n--- Text decoration ---');
  {
    const out = transformHtml('<span style="text-decoration:line-through">Deleted</span>');
    pass('line-through → <s>', out.includes('<s>Deleted</s>'));
    pass('text-decoration style removed', !out.includes('text-decoration'));
  }
  {
    const out = transformHtml('<span style="text-decoration:underline">Underlined</span>');
    pass('underline → <u>', out.includes('<u>Underlined</u>'));
  }

  // ── Zero-width space stripping ────────────────────────────────
  console.log('\n--- Zero-width space stripping ---');
  {
    const out = transformHtml('<p>Hello\u200BWorld</p>');
    pass('zero-width space stripped', !out.includes('\u200B') && out.includes('HelloWorld'));
  }

  // ── Combined: multiple ms-rte classes ─────────────────────────
  console.log('\n--- Combined classes ---');
  {
    const out = transformHtml('<span class="ms-rtefontsize-1 ms-rteforecolor-8">Blue small</span>');
    pass('combined: fontSizeSmall present', out.includes('fontSizeSmall'));
    pass('combined: fontColorBlue present', out.includes('fontColorBlue'));
    pass('combined: no ms-rte classes remain', !out.includes('ms-rte'));
  }

  // ── Image tag → RTE inline image ──────────────────────────────
  console.log('\n--- Image tag → RTE inline image ---');
  {
    const out = transformHtml('<p><img src="/sites/team/photo.png" alt="Team photo" /></p>');
    pass('img replaced with div.imagePlugin', out.includes('class="imagePlugin"'));
    pass('no <img> tag remains', !out.includes('<img'));
    pass('data-imageurl set', out.includes('data-imageurl="/sites/team/photo.png"'));
    pass('data-alttext set', out.includes('data-alttext="Team photo"'));
    pass('data-alignment defaults to Left', out.includes('data-alignment="Left"'));
    pass('data-uploading="0"', out.includes('data-uploading="0"'));
    pass('natural size fallback (-1)', out.includes('data-imagenaturalheight="-1"') && out.includes('data-imagenaturalwidth="-1"'));
  }

  // Image with explicit width/height attributes
  console.log('\n--- Image with width/height attributes ---');
  {
    const out = transformHtml('<img src="/img.png" width="400" height="300" alt="sized" />');
    pass('data-imagenaturalwidth from attr', out.includes('data-imagenaturalwidth="400"'));
    pass('data-imagenaturalheight from attr', out.includes('data-imagenaturalheight="300"'));
  }

  // Image with px dimension in style
  console.log('\n--- Image with style width/height ---');
  {
    const out = transformHtml('<img src="/img.png" style="width:200px;height:150px" class="ms-rtePosition-2" alt="" />');
    pass('style width parsed', out.includes('data-imagenaturalwidth="200"'));
    pass('style height parsed', out.includes('data-imagenaturalheight="150"'));
    pass('ms-rtePosition-2 → Right', out.includes('data-alignment="Right"'));
  }

  // Image inside <a> tag should NOT be transformed
  console.log('\n--- Image inside <a> (not transformed) ---');
  {
    const out = transformHtml('<a href="/page"><img src="/icon.png" alt="icon" /></a>');
    pass('img inside link preserved', out.includes('<img'));
    pass('no imagePlugin div created', !out.includes('imagePlugin'));
  }

  // Image with special chars in src/alt
  console.log('\n--- Image with special chars ---');
  {
    const out = transformHtml('<img src="/img?a=1&b=2" alt="a &quot;quote&quot;" />');
    pass('ampersand escaped in src', out.includes('data-imageurl="/img?a=1&amp;b=2"'));
  }

  // Image with no alt — data-alttext omitted
  console.log('\n--- Image with no alt ---');
  {
    const out = transformHtml('<img src="/img.png" />');
    pass('no data-alttext when alt empty', !out.includes('data-alttext'));
    pass('still has imagePlugin', out.includes('imagePlugin'));
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? '✅ All tests passed!' : `❌ ${failures} test(s) failed`}`);
}

main().catch(err => { console.error(err); process.exit(1); });
