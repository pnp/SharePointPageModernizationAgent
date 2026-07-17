---
name: transform-and-create
description: Transform classic page content into modern web parts, assemble canvas layout, and create/update the modern page.
model: sonnet
---

# Phase 2: Transform & Create

Transform classic page content into modern web parts, assemble the canvas layout, and create (or update) the modern page via SharePoint REST API.

---

## Reading CIM Files

When invoked from `migrate-site`, you receive a CIM JSON file (at `pageunderstanding/<sitename>/<pagename>.json`). The CIM contains pre-extracted and structured data.

### Processing Publishing Fields

**CRITICAL: Do not ignore publishing fields.** The `wikiZones` array only contains `PublishingPageContent`. Fields like `PublishingPageImage`, `PublishingImageCaption`, `ArticleByLine`, and `ArticleStartDate` are ONLY in `content.publishingFields`. Build web parts using the field's `type`:

| Type | Transform Action |
|------|-----------------|
| `image` | `build_text_webpart(html)` without sourceUrl (cross-site) |
| `richHtml` | `build_text_webpart(html, sourceUrl)` |
| `text` | `build_text_webpart(<p>{value}</p>)` |
| `dateTime` | `build_text_webpart(<p>{value}</p>)` |

### Using transformationHints

If the CIM has `transformationHints.sections`, follow it as your layout plan. For each section → column → webPart hint:
- If `sourceField` is a main content field (PublishingPageContent or WikiField) AND `content.wikiZones` exists, use **zone-aware processing** (below)
- If `sourceWebPartId` is present, look up the matching web part in `content.webParts` by `id` and build it using its `modernMapping.transformStrategy` (e.g., call `build_embed_webpart` for MediaWebPart → Embed mappings). **Never skip web parts referenced by `sourceWebPartId`.**
- Otherwise, look up `content.publishingFields[sourceField]` and build the web part using the field's type

### titleArea Handling

Publishing fields are **body content**, not title area metadata. Use a plain title area for publishing pages:

```json
{ "layout": "plain", "showAuthor": false, "showPublishedDate": false, "showTextBlockAboveTitle": false }
```

---

## Workflow

### Step 1: Plan the Layout

- **CIM has `transformationHints.sections`** — follow that plan
- **CIM has `publishingLayout.modernMapping`** — derive sections from the mapping
- Classic wiki with zones → equivalent modern sections
- Full-width content → `oneColumn`

**HTML table layout detection:** Even when the publishing layout is single-column (e.g., EnterpriseWiki / Basic Page), the **content itself** may use HTML `<table>` elements for multi-column layout. Before defaulting to `oneColumn`, inspect the `PublishingPageContent` HTML for layout tables:

1. Look for an outer `<table>` with `class="ms-rteTable-*"` or `width="100%"` that wraps the entire page content
2. Count the columns (`<td>`) in each row — this defines the actual visual layout
3. Map table column proportions to modern section types:
   - Narrow left + wide right (e.g., ~30%/70%) → `oneThirdLeftColumn`
   - Wide left + narrow right → `oneThirdRightColumn`
   - Equal columns → `twoColumns`
4. Each table `<tr>` becomes a separate modern section, all using the same column layout
5. Extract content from each `<td>` cell and place it in the corresponding column
6. Empty cells → empty column (no web parts)

**Do NOT flatten a multi-column table layout into a single column.** The table structure is intentional and should be preserved in the modern page.

**Layout mappings:**

| Classic Pattern | Modern Section |
|----------------|---------------|
| Single column / 100% width (no layout table) | `oneColumn` |
| Content in layout table: narrow left + wide right | `oneThirdLeftColumn` |
| Content in layout table: wide left + narrow right | `oneThirdRightColumn` |
| Content in layout table: two equal columns | `twoColumns` |
| Content in layout table: three columns | `threeColumns` |
| Multiple table rows | Multiple sections (same column layout per row) |
| 66%/33% columns (wiki zones) | `oneThirdRightColumn` |
| 33%/66% columns (wiki zones) | `oneThirdLeftColumn` |
| Two 50% columns (wiki zones) | `twoColumns` |

### Step 2: Build Web Parts

**IMPORTANT: Always use `build_text_webpart` for HTML content.** It applies critical transformations: heading shifts (h1→h2), `<img>` → RTE inline images, table class mapping, script removal, and the wiki-HTML cleanups below.

**Wiki HTML sanitization (applied automatically by `build_text_webpart`):**
- Strip `<table id="layoutsTable">` (classic wiki layout wrapper — not real content)
- Unwrap Microsoft SafeLinks redirects (`https://*.safelinks.protection.outlook.com/?url=...`) back to the original URL
- Clean `data-auth` and related auth-tracking attributes that classic SharePoint injects into anchors

#### Image Handling

##### Same-Tenant Cross-Site Images

When migrating images that reference a **different site on the same tenant** (e.g., publishing page images from the source site), use `build_text_webpart` with the raw `<img>` HTML instead of `build_image_webpart`:

**When to pass `sourceUrl`:** Only pass `sourceUrl` to `build_text_webpart` for general HTML content (article body, captions, etc.) where you want relative links resolved to absolute URLs. Do NOT pass it for image-only content where you want to preserve server-relative image paths.

##### Cross-Tenant Assets

When source and destination are on **different tenants** (different SharePoint domains, e.g., `contoso.sharepoint.com` → `fabrikam.sharepoint.com`), assets (images, CSS, JS) from the source tenant will NOT render on the destination. Server-relative URLs only resolve within a single tenant.

**Automated workflow using MCP tools:**

1. **Discover assets:** Call `discover_page_assets(siteUrl, pageName, destSiteUrl)` — returns a structured inventory with `crossTenantAssets[]` listing every asset that needs migration.
2. **Migrate assets:** Call `migrate_assets(sourceSiteUrl, destSiteUrl, assets)` with the cross-tenant assets. This downloads each from the source and uploads to the destination's SiteAssets. Returns a URL mapping array.
3. **Rewrite URLs:** Call `rewrite_urls(content, urlMap, sourceSitePath, destSitePath)` on **every HTML block** before passing it to builder tools — this includes `wikiZones[].html`, publishing field `html` values, and `webParts[].resolvedHtml`. Any content fed to a builder tool should have its URLs rewritten first.
4. **Build web parts:** Pass the rewritten content to builder tools as usual.

##### Image Web Part vs Inline RTE

- **Use `build_image_webpart`** only when images are local to the destination site AND you have the full site metadata (`siteId`, `webId`, `listId`, `uniqueId`). Without this metadata, `imageSourceType: 2` renders blank or shows a stock placeholder — even for same-tenant absolute URLs.
- **After cross-tenant asset migration, always use `build_text_webpart`** with `<img>` tags using **server-relative destination paths** (e.g., `/sites/team/SiteAssets/photo.png`). This is the most reliable approach — images render correctly and support click-through links via wrapping `<a>` tags. Do NOT pass `sourceUrl` so the server-relative paths are preserved.
- **Never use `build_image_webpart` for cross-tenant migrated assets** — even after uploading to the destination's SiteAssets, the Image web part lacks the site metadata needed to resolve the image. Use text web parts with inline images instead.

##### Quick Links Thumbnail Limitations

- `rawPreviewImageUrl` with custom images (`thumbnailType: 3`) often renders as **generic globe/link icons** instead of actual images, especially for freshly uploaded or cross-tenant migrated images.
- Quick Links `layoutId` is stored but SPFx may render differently (e.g., always CompactCard).
- **For image-tile navigation grids**: Prefer individual text web parts with clickable inline images in a multi-column layout over Quick Links with custom thumbnails. This gives reliable visual rendering and faithful reproduction of the original tile appearance.

#### Zone-Aware Processing of Embedded Web Parts

Classic wiki and publishing pages can embed web parts inline within HTML content using `<div class="ms-rte-wpbox">` markers. The `extract_classic_page` tool returns a `wikiZones` array that splits the content around these markers.

**IMPORTANT: Always use `wikiZones` instead of `wikiHtml`** when building article content web parts. Using raw `wikiHtml` causes embedded web parts to be silently dropped.

Each zone has:
- `html` — HTML content (empty for web part zones)
- `webPartIds` — array of web part GUIDs (empty for HTML zones)

**Processing pattern:**

```
for each zone in wikiZones:
  if zone.webPartIds is not empty:
    → Find matching web part in content.webParts by position index
    → Tier 1: If web part has resolvedHtml → build_text_webpart with resolvedHtml
      (or classify content for richer web part: Quick Links, Image, etc.)
    → Tier 2: If web part has modernMapping → validate properties against the catalog schema before building:
      1. Call `get_modern_webpart_catalog()` and look up the web part by its `webPartId`
      2. Use only properties that exist in the catalog schema — drop non-schema properties from the CIM hints
      3. Resolve any missing required properties via REST API (e.g., list/view GUIDs on the destination site)
      4. Use the `dataVersion` from the catalog example (typically `"1.0"`)
      5. Call `build_any_webpart` with the validated properties
      For cross-site list web parts (XsltListViewWebPart / ListViewWebPart):
        - Resolve the DESTINATION site's equivalent library (e.g. source "Pages" → dest "Site Pages")
        - Call `resolve_list_info(siteUrl, listTitle)` on the DESTINATION site to get the list ID, default view ID, and server-relative URL
        - Use build_any_webpart with:
          - webPartType: f92bf067-bc19-489e-a556-7fe95f508720
          - dataVersion: "1.0" (NOT "2.1" or other versions)
          - properties: { selectedListId, selectedViewId, selectedListUrl, listTitle } — use the values returned by resolve_list_info
          - Only include properties from the schema — do NOT add isDocumentLibrary, hideCommandBar, or other non-schema properties
        - Do NOT fall back to text links or Quick Links — always create a real List web part
    → Tier 3 (last resort): text web part noting the classic type + modern alternatives
  else if zone.html is not empty:
    → build_text_webpart with zone.html and sourceUrl
```

Position-based matching: wpbox GUIDs in HTML don't match web part entry IDs — match by position index.

#### Standalone Web Parts (sourceWebPartId)

When a `transformationHints` entry has `sourceWebPartId` instead of `sourceField`, look up the web part in `content.webParts` by `id` and use its `modernMapping.transformStrategy`:

```
webPart = content.webParts.find(wp => wp.id === hint.sourceWebPartId)
strategy = webPart.modernMapping.transformStrategy
→ call strategy.action (e.g. build_embed_webpart) with strategy.parameters
```

Example: MediaWebPart → `build_embed_webpart({ embedUrl: "...", embedType: "video" })`

#### Content Pattern Quick Reference

| Content Pattern | Tool |
|----------------|------|
| Navigation link lists | `build_quick_links_webpart` |
| Pure text / formatted content | `build_text_webpart` |
| Standalone images (same site) | `build_image_webpart` (always pass `imgWidth`, `imgHeight`) |
| Images from another site | `build_text_webpart` (raw `<img>` HTML) |
| Embedded content / iframes | `build_embed_webpart` |
| Section separators | `build_divider_webpart` |
| Any known modern web part type | `build_any_webpart` |

### Step 3: Assemble & Create

1. Call `build_canvas_layout` with planned sections and web parts
2. Review validation warnings

#### Page Naming Rules

- **Different sites** (cross-site): use same page name as source
- **Same site**: append `-migrated` to avoid overwriting

#### Conflict Resolution

Before calling `create_modern_page`, check if a page with the target name already exists on the destination site. If it does, call `update_modern_page` with the existing page's ID. If the page exists but is currently checked out by another user, call `discardPage` to clear the checkout and retry the update. This ensures the migration process is resilient and can be re-run without manual cleanup.

3. Call `create_modern_page` (or `update_modern_page` if updating) to write the draft page

---

## Layout Reference

The layout mappings in [Step 1](#step-1-plan-the-layout) above cover the common patterns. For PnP selector functions and Community Script Editor details, see the `webpart-mapping-reference` skill.

---

## Examples

### Example 1: Simple Wiki Page

Wiki page with a heading, paragraph text, and an image.

```
1. extract_classic_page(siteUrl, "About-Us.aspx")
   → WikiField: <h2>About Us</h2><p>We are a team...</p><img src="/sites/team/images/team.jpg">

2. build_text_webpart(<h2>About Us</h2><p>We are a team...</p>)
   → text web part JSON

3. build_image_webpart("/sites/team/images/team.jpg", altText: "Team photo")
   → image web part JSON

4. build_canvas_layout([{ type: "oneColumn", webParts: [textWp, imageWp] }])
   → validated canvas layout

5. create_modern_page(siteUrl, "About Us", canvasLayout: layout)
   → draft page created
```

### Example 2: CEWP with Navigation Links

CEWP containing a styled link list — this is where AI classification adds value over dump-as-HTML tools.

```
1. extract_classic_page(siteUrl, "Resources.aspx")
   → CEWP content: <ul><li><a href="/hr">HR Portal</a></li>
                        <li><a href="/it">IT Help</a></li>
                        <li><a href="/finance">Finance</a></li></ul>

2. get_webpart_mapping_hints("ContentEditorWebPart", contentSnippet: "<ul>...")
   → Quick Links (confidence: 0.85), Text (confidence: 0.40)

3. build_quick_links_webpart(
     links: [{url: "/hr", text: "HR Portal"},
             {url: "/it", text: "IT Help"},
             {url: "/finance", text: "Finance"}],
     layoutId: "CompactCard")
   → Quick Links web part JSON

4. build_canvas_layout([{ type: "oneColumn", webParts: [quickLinksWp] }])

5. create_modern_page(siteUrl, "Resources", canvasLayout: layout)
   → Rich Quick Links web part instead of flat HTML
```

### Example 3: Mixed Page with Unsupported Content

Web part page with text, a jQuery dashboard, and an image.

```
1. extract_classic_page(siteUrl, "Dashboard.aspx")
   → Zone 1: <h1>Team Dashboard</h1><p>Welcome to the team dashboard.</p>
   → Zone 2: CEWP with <script src="jquery.min.js">...</script>
             <div id="kpi-widget">...</div>
   → Zone 3: ImageWebPart pointing to /sites/team/images/logo.png

2. Zone 1 → build_text_webpart(<h1>Team Dashboard</h1><p>Welcome...</p>)

3. Zone 2 → has <script> tags, can't convert directly
   → build_text_webpart(
       <h3>⚠️ Interactive Dashboard</h3>
       <p>This section contained a jQuery KPI dashboard that displayed live metrics.
          JavaScript content cannot run in modern pages.</p>
       <p><strong>Recommended alternatives:</strong></p>
       <ul>
         <li>Embed a Power BI dashboard for live KPI visualization</li>
         <li>Build a custom SPFx web part to replicate the functionality</li>
       </ul>)

4. Zone 3 → build_image_webpart("/sites/team/images/logo.png", altText: "Team logo")

5. build_canvas_layout([
     { type: "oneColumn", webParts: [textWp] },
     { type: "twoColumns", webParts: { left: [jsNoteWp], right: [imageWp] } }
   ])

6. create_modern_page(siteUrl, "Team Dashboard", canvasLayout: layout)
   → Report: 2/3 blocks converted natively, 1 block needed fallback (jQuery dashboard)
```

---

## Troubleshooting

### Graph API & Canvas Builder Gotchas

- **Never include `@odata.type` on a Graph API `StandardWebPart`.** The Graph endpoint rejects it with an OData parse error. Build the web part as a plain JSON object with `webPartId` + `data`/`properties`.
- **Builder output is Graph-shaped; canvas-converter rewrites it at the last mile.** Every `build_*_webpart` tool emits `serverProcessedContent` as Graph-style `[{key, value}]` arrays. `canvas-converter.ts` flips those into REST-shaped `{key: value}` objects only when assembling the final canvas. Reasoning about builder output? Expect arrays. Reasoning about the saved page JSON or REST payload? Expect objects. Don't hand-roll the conversion — let `build_canvas_layout` handle it.

### Large Pages

- Pages with many web parts (10+) may produce large canvas layouts
- Build and validate incrementally — create the page with a few sections first, then `update_modern_page` to add more
- Split very large pages into multiple updates if needed

### Content Edge Cases

- **Relative URLs:** Classic pages often use relative URLs (`/sites/team/SitePages/...`). For general HTML content, pass `sourceUrl` to `build_text_webpart` to resolve them to absolute. For images in cross-site migration, keep server-relative URLs (do NOT pass `sourceUrl`) — see [Same-Tenant Cross-Site Images](#same-tenant-cross-site-images).
- **Inline styles:** Modern text web parts accept a subset of HTML/CSS. Heavily styled content may lose some formatting.
- **Image sizing in text web parts:** HTML `width`/`height` attributes on `<img>` tags are preserved in the saved HTML but **ignored by SharePoint's modern RTE renderer** — images scale to fill their containing column regardless. To control image size, use multi-column section layouts (`threeColumns` = ~33% width each) to constrain the column width rather than relying on image dimensions.
- **Nested tables:** Layout tables inside content tables may not render well. Flatten where possible.
- **Cross-tenant images:** Image web parts with `imageSourceType: 2` (external URL) show stock placeholder images when the URL points to a different SharePoint tenant. The fix is to download the images from the source tenant and upload them to the destination site's SiteAssets library — see [Cross-Tenant Assets](#cross-tenant-assets).

---

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `build_text_webpart(innerHtml, sourceUrl?)` | Rich text web part |
| `build_quick_links_webpart(links[], layoutId)` | Quick Links |
| `build_image_webpart(imageUrl, altText?, captionText?, linkUrl?)` | Image web part |
| `build_embed_webpart(embedUrl, embedType?)` | Embed |
| `build_divider_webpart()` | Divider |
| `build_any_webpart(webPartType, dataVersion, title, properties, serverProcessedContent?)` | Any web part |
| `resolve_list_info(siteUrl, listTitle)` | Get list ID, default view ID, and URL for List web parts |
| `build_canvas_layout(sections[])` | Assemble page layout |
| `create_modern_page(siteUrl, title, pageName?, canvasLayout, titleArea?)` | Create draft page |
| `update_modern_page(siteUrl, pageId, canvasLayout?, title?, titleArea?)` | Update existing draft |
| `find_modern_page(siteUrl, pageName)` | Check if page exists |

### Action Layer

| Tool | Purpose |
|------|---------|
| `create_modern_page(siteUrl, title, pageName?, pageLayout?, canvasLayout, useBetaApi?, titleArea?)` | Create draft page |
| `update_modern_page(siteUrl, pageId, canvasLayout?, title?, titleArea?, useBetaApi?)` | Update existing draft |

### Cross-Tenant Asset Tools

| Tool | Purpose |
|------|---------|
| `discover_page_assets(siteUrl, pageName, destSiteUrl?)` | Scan page for all referenced assets; classify cross-tenant vs same-tenant |
| `migrate_assets(sourceSiteUrl, destSiteUrl, assets[])` | Download assets from source, upload to destination, return URL mapping |
| `rewrite_urls(content, urlMap[], sourceSitePath?, destSitePath?)` | Rewrite URLs in HTML/text content using explicit mappings + path substitution |
