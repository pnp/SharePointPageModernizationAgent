// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

/**
 * Unit tests for canvasLayoutToCanvasContent1().
 *
 * Run: node test/test-canvas-converter.cjs
 *
 * canvas-converter converts the hierarchical canvasLayout produced by the
 * MCP builder tools into the flat CanvasContent1 JSON-string format
 * accepted by the SharePoint REST SavePage endpoint.
 */
async function main() {
  const { canvasLayoutToCanvasContent1 } = await import(
    '../dist/sharepoint/canvas-converter.js'
  );

  let passed = 0;
  let failed = 0;
  const pass = (label, ok) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; process.exitCode = 1; console.log(`  ❌ ${label}`); }
  };

  const parse = (s) => JSON.parse(s);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── Test 1: empty layout returns "[]" ──
  console.log('\nTest 1: empty layout');
  {
    const out = canvasLayoutToCanvasContent1({ horizontalSections: [] });
    pass('returns valid JSON', typeof out === 'string');
    const controls = parse(out);
    pass('returns empty array', Array.isArray(controls) && controls.length === 0);
  }

  // ── Test 2: single text web part — controlType 4 ──
  console.log('\nTest 2: single text web part');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        emphasis: 'none',
        columns: [{
          webparts: [{
            '@odata.type': '#microsoft.graph.textWebPart',
            innerHtml: '<p>Hello</p>',
          }],
        }],
      }],
    });
    const controls = parse(out);
    pass('one control emitted', controls.length === 1);
    pass('controlType is 4 (text)', controls[0].controlType === 4);
    pass('innerHTML preserved', controls[0].innerHTML === '<p>Hello</p>');
    pass('id is uuid', UUID_RE.test(controls[0].id));
    pass('addedFromPersistedData true', controls[0].addedFromPersistedData === true);
    pass('zoneIndex 1', controls[0].position.zoneIndex === 1);
    pass('sectionIndex 1', controls[0].position.sectionIndex === 1);
    pass('controlIndex 1', controls[0].position.controlIndex === 1);
    pass('sectionFactor 12 (oneColumn)', controls[0].position.sectionFactor === 12);
    pass('zoneEmphasis 0 (none)', controls[0].position.zoneEmphasis === 0);
  }

  // ── Test 3: text web part with empty innerHtml ──
  console.log('\nTest 3: empty innerHtml');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{ webparts: [{ '@odata.type': '#microsoft.graph.textWebPart' }] }],
      }],
    });
    const controls = parse(out);
    pass('text control still emitted', controls.length === 1 && controls[0].controlType === 4);
    pass('innerHTML defaults to ""', controls[0].innerHTML === '');
  }

  // ── Test 4: text web part inferred when innerHtml present and no webPartType ──
  console.log('\nTest 4: text inferred without @odata.type');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{ webparts: [{ innerHtml: '<p>inferred</p>' }] }],
      }],
    });
    const controls = parse(out);
    pass('treated as text web part', controls.length === 1 && controls[0].controlType === 4);
    pass('innerHTML carried over', controls[0].innerHTML === '<p>inferred</p>');
  }

  // ── Test 5: standard web part — controlType 3 ──
  console.log('\nTest 5: standard web part');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        emphasis: 'soft',
        columns: [{
          webparts: [{
            webPartType: 'd1d91016-032f-456d-98a4-721247c305e8', // Image
            data: {
              dataVersion: '1.9',
              title: 'Image',
              properties: { imageSourceType: 2, altText: 'logo' },
            },
          }],
        }],
      }],
    });
    const controls = parse(out);
    pass('one control emitted', controls.length === 1);
    pass('controlType is 3 (webpart)', controls[0].controlType === 3);
    pass('webPartId matches input', controls[0].webPartId === 'd1d91016-032f-456d-98a4-721247c305e8');
    pass('webPartData.id matches type', controls[0].webPartData.id === 'd1d91016-032f-456d-98a4-721247c305e8');
    pass('webPartData.instanceId is uuid', UUID_RE.test(controls[0].webPartData.instanceId));
    pass('webPartData.instanceId equals control id', controls[0].webPartData.instanceId === controls[0].id);
    pass('webPartData.title preserved', controls[0].webPartData.title === 'Image');
    pass('webPartData.dataVersion preserved', controls[0].webPartData.dataVersion === '1.9');
    pass('webPartData.properties preserved', controls[0].webPartData.properties.imageSourceType === 2);
    pass('webPartData.description defaults to ""', controls[0].webPartData.description === '');
    pass('no serverProcessedContent when omitted', controls[0].webPartData.serverProcessedContent === undefined);
    pass('zoneEmphasis soft → 2', controls[0].position.zoneEmphasis === 2);
  }

  // ── Test 6: standard web part defaults ──
  console.log('\nTest 6: standard web part missing data');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{ webparts: [{ webPartType: 'some-guid' }] }],
      }],
    });
    const controls = parse(out);
    pass('webpart emitted', controls.length === 1);
    pass('dataVersion defaults to "1.0"', controls[0].webPartData.dataVersion === '1.0');
    pass('title defaults to ""', controls[0].webPartData.title === '');
    pass('properties defaults to {}', JSON.stringify(controls[0].webPartData.properties) === '{}');
  }

  // ── Test 7: serverProcessedContent kv-array → object ──
  console.log('\nTest 7: serverProcessedContent array → object');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{
          webparts: [{
            webPartType: 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd', // Quick Links
            data: {
              dataVersion: '2',
              properties: { layoutId: 'List' },
              serverProcessedContent: {
                searchablePlainTexts: [
                  { key: 'items[0].title', value: 'Home' },
                  { key: 'items[1].title', value: 'Help' },
                ],
                links: [
                  { key: 'items[0].sourceItem.url', value: 'https://contoso.com/home' },
                ],
                imageSources: [
                  { key: 'items[0].rawPreviewImageUrl', value: '/img.png' },
                ],
                customMetadata: { someKey: 'preserved' },
              },
            },
          }],
        }],
      }],
    });
    const spc = parse(out)[0].webPartData.serverProcessedContent;
    pass('searchablePlainTexts converted to object', spc.searchablePlainTexts['items[0].title'] === 'Home');
    pass('searchablePlainTexts second key present', spc.searchablePlainTexts['items[1].title'] === 'Help');
    pass('links converted to object', spc.links['items[0].sourceItem.url'] === 'https://contoso.com/home');
    pass('imageSources converted to object', spc.imageSources['items[0].rawPreviewImageUrl'] === '/img.png');
    pass('customMetadata preserved as-is', spc.customMetadata.someKey === 'preserved');
    pass('htmlStrings absent when not provided', spc.htmlStrings === undefined);
  }

  // ── Test 8: emphasis mapping ──
  console.log('\nTest 8: emphasis mapping');
  {
    const emphasisCases = [
      ['none', 0],
      ['neutral', 1],
      ['soft', 2],
      ['strong', 3],
    ];
    for (const [emphasis, expected] of emphasisCases) {
      const out = canvasLayoutToCanvasContent1({
        horizontalSections: [{
          layout: 'oneColumn',
          emphasis,
          columns: [{ webparts: [{ innerHtml: 'x' }] }],
        }],
      });
      pass(`emphasis '${emphasis}' → ${expected}`, parse(out)[0].position.zoneEmphasis === expected);
    }
    // Unknown emphasis falls back to 0
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        emphasis: 'unknown-value',
        columns: [{ webparts: [{ innerHtml: 'x' }] }],
      }],
    });
    pass('unknown emphasis → 0', parse(out)[0].position.zoneEmphasis === 0);
  }

  // ── Test 9: layout → sectionFactor mapping ──
  console.log('\nTest 9: layout → sectionFactor mapping');
  {
    const layoutCases = [
      ['oneColumn', [12]],
      ['twoColumns', [6, 6]],
      ['threeColumns', [4, 4, 4]],
      ['oneThirdLeftColumn', [4, 8]],
      ['oneThirdRightColumn', [8, 4]],
      ['fullWidth', [0]],
    ];
    for (const [layout, factors] of layoutCases) {
      const columns = factors.map(() => ({ webparts: [{ innerHtml: 'x' }] }));
      const out = canvasLayoutToCanvasContent1({
        horizontalSections: [{ layout, columns }],
      });
      const controls = parse(out);
      pass(`layout '${layout}' produces ${factors.length} control(s)`, controls.length === factors.length);
      for (let i = 0; i < factors.length; i++) {
        pass(`layout '${layout}' col ${i + 1} sectionFactor=${factors[i]}`,
          controls[i].position.sectionFactor === factors[i]);
      }
    }
    // Unknown layout falls back to [12]
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{ layout: 'nonsense', columns: [{ webparts: [{ innerHtml: 'x' }] }] }],
    });
    pass('unknown layout → sectionFactor 12', parse(out)[0].position.sectionFactor === 12);
  }

  // ── Test 10: multiple sections — zoneIndex increments ──
  console.log('\nTest 10: multiple sections');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [
        { layout: 'oneColumn', columns: [{ webparts: [{ innerHtml: 'a' }] }] },
        { layout: 'oneColumn', columns: [{ webparts: [{ innerHtml: 'b' }] }] },
        { layout: 'oneColumn', columns: [{ webparts: [{ innerHtml: 'c' }] }] },
      ],
    });
    const controls = parse(out);
    pass('three controls emitted', controls.length === 3);
    pass('section 1 → zoneIndex 1', controls[0].position.zoneIndex === 1);
    pass('section 2 → zoneIndex 2', controls[1].position.zoneIndex === 2);
    pass('section 3 → zoneIndex 3', controls[2].position.zoneIndex === 3);
  }

  // ── Test 11: multiple columns and web parts — indexing ──
  console.log('\nTest 11: multiple columns / web parts');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'twoColumns',
        columns: [
          { webparts: [{ innerHtml: 'a' }, { innerHtml: 'b' }] },
          { webparts: [{ innerHtml: 'c' }] },
        ],
      }],
    });
    const controls = parse(out);
    pass('three controls emitted', controls.length === 3);
    pass('col1 wp1: section=1, control=1', controls[0].position.sectionIndex === 1 && controls[0].position.controlIndex === 1);
    pass('col1 wp2: section=1, control=2', controls[1].position.sectionIndex === 1 && controls[1].position.controlIndex === 2);
    pass('col2 wp1: section=2, control=1', controls[2].position.sectionIndex === 2 && controls[2].position.controlIndex === 1);
    pass('col1 factor=6', controls[0].position.sectionFactor === 6);
    pass('col2 factor=6', controls[2].position.sectionFactor === 6);
  }

  // ── Test 12: unknown web part type without innerHtml — silently skipped ──
  console.log('\nTest 12: unknown shape silently skipped');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{
          webparts: [
            { someUnknownField: 'value' }, // no innerHtml, no webPartType → skipped
            { innerHtml: 'kept' },
          ],
        }],
      }],
    });
    const controls = parse(out);
    pass('only the valid web part emitted', controls.length === 1);
    pass('valid one kept', controls[0].innerHTML === 'kept');
  }

  // ── Test 13: unique ids ──
  console.log('\nTest 13: unique ids');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{
          webparts: [
            { innerHtml: 'a' },
            { innerHtml: 'b' },
            { webPartType: 'c70391ea-0b10-4ee9-b2b4-006d3fcad0cd' },
          ],
        }],
      }],
    });
    const controls = parse(out);
    const ids = controls.map(c => c.id);
    pass('all ids unique', new Set(ids).size === ids.length);
    pass('all ids are uuids', ids.every(id => UUID_RE.test(id)));
  }

  // ── Test 14: serverProcessedContent empty → undefined ──
  console.log('\nTest 14: empty serverProcessedContent stays undefined');
  {
    const out = canvasLayoutToCanvasContent1({
      horizontalSections: [{
        layout: 'oneColumn',
        columns: [{
          webparts: [{
            webPartType: 'guid',
            data: { properties: {}, serverProcessedContent: {} },
          }],
        }],
      }],
    });
    pass('spc absent when no recognized keys', parse(out)[0].webPartData.serverProcessedContent === undefined);
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
