/**
 * Unit tests for parsePublishingLayout().
 * Run: node test/test-layout-parser.cjs
 */

// Polyfill File for Node 18 (undici requires it)
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

async function main() {
  const { parsePublishingLayout } = await import('../dist/utils/publishing-layout-parser.js');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${message}`);
    }
  }

  // ── Test 1: ArticleLeft layout ──
  console.log('Test 1: ArticleLeft layout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="article-header">
    <SharePointWebControls:DateTimeField FieldName="ArticleStartDate" runat="server" />
    <SharePointWebControls:TextField FieldName="ArticleByLine" runat="server" />
  </div>
  <div class="article-body">
    <div class="captioned-image">
      <PublishingWebControls:RichImageField FieldName="PublishingPageImage" runat="server" />
      <SharePointWebControls:TextField FieldName="PublishingImageCaption" runat="server" />
    </div>
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'ArticleLeft.aspx');

    assert(result.layoutName === 'ArticleLeft.aspx', 'layoutName should be ArticleLeft.aspx');
    assert(result.fieldControls.length === 5, `should have 5 field controls, got ${result.fieldControls.length}`);

    const fieldNames = result.fieldControls.map(f => f.fieldName);
    assert(fieldNames.includes('PublishingPageContent'), 'should include PublishingPageContent');
    assert(fieldNames.includes('PublishingPageImage'), 'should include PublishingPageImage');
    assert(fieldNames.includes('ArticleByLine'), 'should include ArticleByLine');
    assert(fieldNames.includes('ArticleStartDate'), 'should include ArticleStartDate');
    assert(fieldNames.includes('PublishingImageCaption'), 'should include PublishingImageCaption');

    assert(result.webPartZones.length === 0, 'ArticleLeft should have no web part zones');
    assert(result.modernMapping.length >= 1, 'should have at least 1 mapping row');

    // All content should be full-width (no CSS column classes)
    const firstRow = result.modernMapping[0];
    assert(firstRow.columns.length === 1, `first row should have 1 column, got ${firstRow.columns.length}`);
    assert(firstRow.columns[0].modernWidth === 12, 'full-width column should be 12');

    console.log('  ArticleLeft: OK\n');
  }

  // ── Test 2: BlankWebPartPage layout (zones with column classes) ──
  console.log('Test 2: BlankWebPartPage layout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="article-content">
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
  <div class="zone-grid">
    <div class="tableCol-75">
      <WebPartPages:WebPartZone id="CenterLeftColumn" runat="server" />
      <WebPartPages:WebPartZone id="CenterColumn" runat="server" />
    </div>
    <div class="tableCol-25">
      <WebPartPages:WebPartZone id="RightColumn" runat="server" />
    </div>
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'BlankWebPartPage.aspx');

    assert(result.layoutName === 'BlankWebPartPage.aspx', 'layoutName');
    assert(result.fieldControls.length === 1, `should have 1 field control, got ${result.fieldControls.length}`);
    assert(result.fieldControls[0].fieldName === 'PublishingPageContent', 'should have PublishingPageContent');

    assert(result.webPartZones.length === 3, `should have 3 web part zones, got ${result.webPartZones.length}`);
    const zoneIds = result.webPartZones.map(z => z.zoneId);
    assert(zoneIds.includes('CenterLeftColumn'), 'should include CenterLeftColumn');
    assert(zoneIds.includes('CenterColumn'), 'should include CenterColumn');
    assert(zoneIds.includes('RightColumn'), 'should include RightColumn');

    // Should have a multi-column row from the zone-grid
    const multiColRow = result.modernMapping.find(r => r.columns.length > 1);
    assert(multiColRow != null, 'should have a multi-column row');
    if (multiColRow) {
      assert(multiColRow.columns[0].widthPercent === 75, 'first column should be 75%');
      assert(multiColRow.columns[0].modernWidth === 9, 'first column modernWidth should be 9');
      assert(multiColRow.columns[1].widthPercent === 25, 'second column should be 25%');
      assert(multiColRow.columns[1].modernWidth === 3, 'second column modernWidth should be 3');
    }

    console.log('  BlankWebPartPage: OK\n');
  }

  // ── Test 3: WelcomeSplash layout (multiple zones with 50/50) ──
  console.log('Test 3: WelcomeSplash layout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="welcome-header">
    <PublishingWebControls:RichImageField FieldName="PublishingPageImage" runat="server" />
  </div>
  <div class="welcome-links">
    <div class="col-50">
      <PublishingWebControls:SummaryLinkFieldControl FieldName="SummaryLinks" runat="server" />
    </div>
    <div class="col-50">
      <PublishingWebControls:SummaryLinkFieldControl FieldName="SummaryLinks2" runat="server" />
    </div>
  </div>
  <div class="zone-row">
    <div class="col-50">
      <WebPartPages:WebPartZone id="BottomLeftZone" runat="server" />
    </div>
    <div class="col-50">
      <WebPartPages:WebPartZone id="BottomRightZone" runat="server" />
    </div>
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'WelcomeSplash.aspx');

    assert(result.layoutName === 'WelcomeSplash.aspx', 'layoutName');
    assert(result.fieldControls.length === 3, `should have 3 field controls, got ${result.fieldControls.length}`);
    assert(result.webPartZones.length === 2, `should have 2 web part zones, got ${result.webPartZones.length}`);

    // Should have 50/50 rows
    const twoColRows = result.modernMapping.filter(r => r.columns.length === 2);
    assert(twoColRows.length >= 1, 'should have at least one 50/50 row');
    if (twoColRows.length > 0) {
      assert(twoColRows[0].columns[0].modernWidth === 6, 'col-50 should map to modernWidth 6');
      assert(twoColRows[0].columns[1].modernWidth === 6, 'col-50 should map to modernWidth 6');
    }

    console.log('  WelcomeSplash: OK\n');
  }

  // ── Test 4: WelcomeTOC layout ──
  console.log('Test 4: WelcomeTOC layout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="welcome-header">
    <PublishingWebControls:RichImageField FieldName="PublishingPageImage" runat="server" />
  </div>
  <div class="welcome-body">
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
  <div class="toc-zones">
    <div class="tableCol-50">
      <WebPartPages:WebPartZone id="LeftColumnZone" runat="server" />
    </div>
    <div class="tableCol-50">
      <WebPartPages:WebPartZone id="RightColumnZone" runat="server" />
    </div>
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'WelcomeTOC.aspx');

    assert(result.layoutName === 'WelcomeTOC.aspx', 'layoutName');
    assert(result.fieldControls.length === 2, `should have 2 field controls, got ${result.fieldControls.length}`);
    assert(result.webPartZones.length === 2, `should have 2 web part zones, got ${result.webPartZones.length}`);

    // Should include a 50/50 row for the zones
    const twoColRow = result.modernMapping.find(r => r.columns.length === 2);
    assert(twoColRow != null, 'should have a 2-column row');
    if (twoColRow) {
      assert(twoColRow.columns[0].widthPercent === 50, 'left column should be 50%');
      assert(twoColRow.columns[1].widthPercent === 50, 'right column should be 50%');
    }

    console.log('  WelcomeTOC: OK\n');
  }

  // ── Test 5: PageFromDocLayout (content only) ──
  console.log('Test 5: PageFromDocLayout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="document-content">
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'PageFromDocLayout.aspx');

    assert(result.layoutName === 'PageFromDocLayout.aspx', 'layoutName');
    assert(result.fieldControls.length === 1, `should have 1 field control, got ${result.fieldControls.length}`);
    assert(result.fieldControls[0].fieldName === 'PublishingPageContent', 'should have PublishingPageContent');
    assert(result.webPartZones.length === 0, 'should have no web part zones');
    assert(result.modernMapping.length >= 1, 'should have at least 1 row');
    assert(result.modernMapping[0].columns[0].modernWidth === 12, 'should be full-width');

    console.log('  PageFromDocLayout: OK\n');
  }

  // ── Test 6: CSS class → width mapping ──
  console.log('Test 6: CSS class to width mapping');
  {
    // Test with explicit width classes
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="main-content">
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
  <div class="right-bar">
    <WebPartPages:WebPartZone id="RightZone" runat="server" />
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'TestLayout.aspx');

    const multiCol = result.modernMapping.find(r => r.columns.length === 2);
    assert(multiCol != null, 'should find 75/25 column row');
    if (multiCol) {
      assert(multiCol.columns[0].widthPercent === 75, 'main-content should be 75%');
      assert(multiCol.columns[0].modernWidth === 9, 'main-content modernWidth should be 9');
      assert(multiCol.columns[1].widthPercent === 25, 'right-bar should be 25%');
      assert(multiCol.columns[1].modernWidth === 3, 'right-bar modernWidth should be 3');
    }

    console.log('  CSS mapping: OK\n');
  }

  // ── Test 7: Unknown layout (graceful fallback) ──
  console.log('Test 7: Unknown/empty layout');
  {
    const aspx = `<html><body><div>Not a real layout</div></body></html>`;

    const result = parsePublishingLayout(aspx, 'CustomLayout.aspx');

    assert(result.layoutName === 'CustomLayout.aspx', 'layoutName should still be set');
    assert(result.fieldControls.length === 0, 'should have 0 field controls');
    assert(result.webPartZones.length === 0, 'should have 0 web part zones');
    // Fallback should produce at least one single-column row
    assert(result.modernMapping.length >= 1, 'should have at least 1 fallback row');
    assert(result.modernMapping[0].columns[0].modernWidth === 12, 'fallback should be full-width');

    console.log('  Unknown layout: OK\n');
  }

  // ── Test 8: 33/33/33 three-column layout ──
  console.log('Test 8: Three-column layout');
  {
    const aspx = `
<%@ Page language="C#" Inherits="Microsoft.SharePoint.Publishing.PublishingLayoutPage" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="three-col-row">
    <div class="tableCol-33">
      <WebPartPages:WebPartZone id="LeftZone" runat="server" />
    </div>
    <div class="tableCol-33">
      <WebPartPages:WebPartZone id="CenterZone" runat="server" />
    </div>
    <div class="tableCol-33">
      <WebPartPages:WebPartZone id="RightZone" runat="server" />
    </div>
  </div>
</asp:Content>`;

    const result = parsePublishingLayout(aspx, 'ThreeCol.aspx');

    const threeColRow = result.modernMapping.find(r => r.columns.length === 3);
    assert(threeColRow != null, 'should have a 3-column row');
    if (threeColRow) {
      assert(threeColRow.columns.every(c => c.widthPercent === 33), 'all columns should be 33%');
      assert(threeColRow.columns.every(c => c.modernWidth === 4), 'all columns modernWidth should be 4');
    }

    console.log('  Three-column: OK\n');
  }

  // ── Test 9: extractHardcodedHtml — layout with hardcoded content ──
  console.log('Test 9: extractHardcodedHtml — hardcoded content');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<%@ Page language="C#" %>
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  <div class="container">
    <h1>Welcome to the Sample Hub</h1>
    <a href="/sites/sample/pages/help.aspx" class="btn">Need Help?</a>
    <div class="row">
      <div class="col"><a href="/dashboard"><img src="/images/icon.png" /><h3>Section A</h3></a></div>
    </div>
  </div>
  <WebPartPages:WebPartZone id="zone1" runat="server" />
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result != null, '9a: should return content');
    assert(result.includes('Welcome to the Sample Hub'), '9a: should contain heading');
    assert(result.includes('Need Help?'), '9a: should contain link text');
    assert(result.includes('<img'), '9a: should contain image');
    assert(!result.includes('RichHtmlField'), '9a: should NOT contain server control');
    assert(!result.includes('WebPartZone'), '9a: should NOT contain WebPartZone');
    assert(!result.includes('<%'), '9a: should NOT contain code block');

    console.log('  Hardcoded content: OK\n');
  }

  // ── Test 10: extractHardcodedHtml — layout with only server controls ──
  console.log('Test 10: extractHardcodedHtml — no substantive content');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <div class="wrapper">
    <PublishingWebControls:RichHtmlField FieldName="PublishingPageContent" runat="server" />
  </div>
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result == null, '10: should return undefined for layout with no substantive content');

    console.log('  No substantive content: OK\n');
  }

  // ── Test 11: extractHardcodedHtml — EditModePanel stripping ──
  console.log('Test 11: extractHardcodedHtml — EditModePanel');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <PublishingWebControls:EditModePanel runat="server">
    <p>This is edit-only content</p>
  </PublishingWebControls:EditModePanel>
  <div class="visible">
    <h2>Real Content</h2>
  </div>
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result != null, '11a: should return content');
    assert(result.includes('Real Content'), '11b: should contain visible content');
    assert(!result.includes('edit-only'), '11c: should NOT contain EditModePanel content');

    console.log('  EditModePanel: OK\n');
  }

  // ── Test 12: extractHardcodedHtml — no PlaceHolderMain ──
  console.log('Test 12: extractHardcodedHtml — no PlaceHolderMain');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `<html><body><div>Not a real layout</div></body></html>`;
    const result = extractHardcodedHtml(aspx);
    assert(result == null, '12: should return undefined when no PlaceHolderMain');

    console.log('  No PlaceHolderMain: OK\n');
  }

  // ── Test 13: extractHardcodedHtml — nested server tags unwrapped ──
  console.log('Test 13: extractHardcodedHtml — nested server tags');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <SharePoint:SPSecurityTrimmedControl runat="server" PermissionsString="ManageWeb">
    <asp:Panel runat="server">
      <h3>Admin Panel</h3>
    </asp:Panel>
  </SharePoint:SPSecurityTrimmedControl>
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result != null, '13a: should return content');
    assert(result.includes('Admin Panel'), '13b: inner HTML should be preserved');
    assert(!result.includes('SPSecurityTrimmedControl'), '13c: server tags should be removed');
    assert(!result.includes('asp:Panel'), '13d: nested server tags should be removed');

    console.log('  Nested server tags: OK\n');
  }

  // ── Test 14: extractHardcodedHtml — script and style stripping ──
  console.log('Test 14: extractHardcodedHtml — scripts and styles');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <script src="/scripts/jquery.js">//<![CDATA[//]]></script>
  <script type="text/javascript">
    function doStuff() { alert('hello'); }
  </script>
  <style>.custom { color: red; }</style>
  <div class="content">
    <h1>Real Content</h1>
    <p>This should remain</p>
  </div>
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result != null, '14a: should return content');
    assert(result.includes('Real Content'), '14b: should contain heading');
    assert(result.includes('This should remain'), '14c: should contain paragraph');
    assert(!result.includes('<script'), '14d: should NOT contain script tags');
    assert(!result.includes('doStuff'), '14e: should NOT contain script body');
    assert(!result.includes('<style'), '14f: should NOT contain style tags');
    assert(!result.includes('color: red'), '14g: should NOT contain style body');

    console.log('  Scripts and styles: OK\n');
  }

  // ── Test 15: extractHardcodedHtml — custom namespace tags (PageField*, Publishing:) ──
  console.log('Test 15: extractHardcodedHtml — custom namespace tags');
  {
    const { extractHardcodedHtml } = await import('../dist/utils/publishing-layout-parser.js');

    const aspx = `
<asp:Content ContentPlaceHolderID="PlaceHolderMain" runat="server">
  <Publishing:EditModePanel runat="server" CssClass="edit-mode-panel">
    <PageFieldTextField:TextField FieldName="fa564e0f" runat="server">
    </PageFieldTextField:TextField>
  </Publishing:EditModePanel>
  <div>
    <PageFieldRichImageField:RichImageField FieldName="3de94b06" runat="server">
    </PageFieldRichImageField:RichImageField>
  </div>
  <div>
    <PageFieldRichHtmlField:RichHtmlField FieldName="f55c4d88" runat="server">
    </PageFieldRichHtmlField:RichHtmlField>
  </div>
  <div class="real-content">
    <h2>Dashboard Tiles</h2>
    <a href="/powerbi/report"><img src="/images/tile.png" /></a>
  </div>
  <PageFieldDateTimeField:DateTimeField FieldName="71316cea" runat="server" />
</asp:Content>`;

    const result = extractHardcodedHtml(aspx);
    assert(result != null, '15a: should return content');
    assert(result.includes('Dashboard Tiles'), '15b: should contain real content');
    assert(result.includes('<img'), '15c: should contain image');
    assert(!result.includes('PageFieldTextField'), '15d: should NOT contain PageFieldTextField');
    assert(!result.includes('PageFieldRichImageField'), '15e: should NOT contain PageFieldRichImageField');
    assert(!result.includes('PageFieldRichHtmlField'), '15f: should NOT contain PageFieldRichHtmlField');
    assert(!result.includes('PageFieldDateTimeField'), '15g: should NOT contain PageFieldDateTimeField');
    assert(!result.includes('Publishing:EditModePanel'), '15h: should NOT contain Publishing:EditModePanel');
    assert(!result.includes('edit-mode-panel'), '15i: EditModePanel content should be stripped');

    console.log('  Custom namespace tags: OK\n');
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
