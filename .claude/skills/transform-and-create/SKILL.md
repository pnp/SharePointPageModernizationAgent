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

Every migrated Site Page must have a visible title region. The REST `Title` field alone does not create one. Publishing fields are **body content**, not title area metadata. Use the extracted page title for a plain title area:

```json
{
  "title": "<content.title>",
  "layout": "plain",
  "showAuthor": false,
  "showPublishedDate": false,
  "showTextBlockAboveTitle": false
}
```

Pass this `titleArea` when creating every page. When updating a page, pass both the page `title` and `titleArea` unless the existing title region was already live-verified. The title region is independent from the first body heading; do not treat a body `<h1>` as a replacement.

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

**IMPORTANT: Always use `build_text_webpart` for HTML content.** It applies critical transformations: heading shifts (h1→h2), `<img>` → RTE inline images, table class mapping, script removal, Canvas RTE-safe presentation-style preservation, and the wiki-HTML cleanups below. This is part of every initial migration, regardless of the later comparison score.

**Wiki HTML sanitization (applied automatically by `build_text_webpart`):**
- Strip `<table id="layoutsTable">` (classic wiki layout wrapper — not real content)
- Unwrap Microsoft SafeLinks redirects (`https://*.safelinks.protection.outlook.com/?url=...`) back to the original URL
- Clean `data-auth` and related auth-tracking attributes that classic SharePoint injects into anchors

#### Canvas RTE-Safe Presentation Styles

Preserve high-value visual fidelity with the inline styles that Canvas RTE demonstrably retains: fixed hexadecimal `color`, `font-size`, `font-style`, `font-weight`, `text-align`, and `margin-left` on text; plus `width`, `border-collapse`, `border`, `padding`, `background-color`, and `color` on tables and table cells. `build_text_webpart` validates this subset and strips style blocks, custom classes, external URLs, positioning, layout CSS, and unsupported properties.

- Preserve the modern page title area instead of duplicating the classic `<h1>` in the first Text web part.
- Retain source heading/subtitle colors and simple typography as direct inline styles. Do not replace them with `fontColor*` or `highlightColor*` class names; those class names can persist without producing a visible effect in Canvas RTE.
- Convert a classic `<div>` callout that has background, padding, and a border into a one-cell full-width table. Canvas RTE reliably retains the table cell's `background-color`, `padding`, and a visible `border`; use a full border rather than `border-left`. Tenant styling can override the requested border color, so do not treat an exact border color as a fidelity guarantee.
- Keep styles semantic and local to the content. Do not reproduce font families, CSS variables, pseudo-elements, `display`, `position`, flex/grid, media queries, transforms, or arbitrary CSS classes.

#### Explicit Text Web Part Restyling

When a user explicitly requests a style refresh for an already migrated page, re-run this transformation in **update mode** rather than waiting for the comparison score gate:

1. Use the existing CIM's `modernPageId`, `modernPageUrl`, and `destinationSiteUrl` only after confirming the target with `find_modern_page`.
2. Rebuild every source-derived Text web part from the original CIM content through `build_text_webpart`, including HTML zones, publishing rich-HTML fields, resolved Content Editor HTML, and required yellow fallbacks. Do not copy the existing modern `innerHtml`, because it cannot gain newly supported styles.
3. Rebuild the complete canvas from the CIM so that existing non-Text web parts retain their original mappings and positions. Call `update_modern_page` with the verified existing page ID, title, title area, and rebuilt canvas; never create a second page.
4. Repeat live lookup, modern extraction, screenshot verification, and comparison. Persist `textWebpartStyleRefinedAt` and `textWebpartStyleRefinementReason: "explicit-user-request"` in the CIM after verification.

This direct restyling mode is deliberately independent of automated comparison scoring. It is for existing pages after a supported Text web-part transformation improvement, not for unrelated content changes.

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

- **Use `build_image_webpart`** only when images are local to the destination site AND you have the full site metadata (`siteId`, `webId`, `listId`, `uniqueId`) plus verified positive `imgWidth` and `imgHeight`. Pass those IDs, dimensions, and the source `fileName` so it writes the required image `customMetadata`. Do not invoke this builder with missing metadata or dimensions: `imageSourceType: 2` can render blank or at `0×0`, even for same-tenant absolute URLs.
- **SVG files:** Never call `build_image_webpart` for an SVG. Preserve it as sanitized linked `<img>` HTML in a Text web part instead. The modern Image web part can persist a valid SVG configuration but render nothing; retain the source link, alt text, and dimensions in the Text control.
- **After cross-tenant asset migration, always use `build_text_webpart`** with `<img>` tags using **server-relative destination paths** (e.g., `/sites/team/SiteAssets/photo.png`). This is the most reliable approach — images render correctly and support click-through links via wrapping `<a>` tags. Do NOT pass `sourceUrl` so the server-relative paths are preserved.
- **Never use `build_image_webpart` for cross-tenant migrated assets** — even after uploading to the destination's SiteAssets, the Image web part lacks the site metadata needed to resolve the image. Use text web parts with inline images instead.
- **Never duplicate an image:** Before assembling the canvas, inventory all source image URLs across `wikiZones`, content blocks, publishing fields, and standalone image web parts. Normalize URLs by removing rendition/query parameters for identity comparison. Each source image must produce exactly one target image: keep it in the transformed Text control when article HTML already contains it, or extract it into one dedicated Image/Text control and remove it from the article HTML. After save, inspect the canvas controls and rendered page to confirm the expected image count.

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
      For `SummaryLinkWebPart`, call `build_quick_links_webpart` with `title: webPart.title` and the extracted links. Do not use a generic or omitted heading; the classic web part title must remain visible above its Quick Links.
    → Tier 2: If web part has modernMapping → validate properties against the catalog schema before building:
      1. Call `get_modern_webpart_catalog()` and look up the web part by its `webPartId`
      2. Use only properties that exist in the catalog schema — drop non-schema properties from the CIM hints
      3. Resolve any missing required properties via REST API (e.g., list/view GUIDs on the destination site)
      4. Use the `dataVersion` from the catalog example (typically `"1.0"`)
      5. Call `build_any_webpart` with the validated properties
      For cross-site list web parts (XsltListViewWebPart / ListViewWebPart):
        - Identify the source list by its underlying `ListId`, `ListUrl`, or `TitleUrl` before considering the web part's display `title`. A display title such as "Documents" may actually point to `/Lists/Links`; never infer the list from the display title alone.
        - For same-site migration, preserve the exact source list when it still exists. Resolve using the underlying list URL/title and verify that the returned ID or server-relative URL matches the CIM.
        - For cross-site migration, resolve the DESTINATION site's intentional equivalent library (e.g. source "Pages" → dest "Site Pages"). If no unambiguous equivalent exists, preserve the source list content as links or a yellow-highlighted explanatory fallback rather than silently binding a different list.
        - Call `resolve_list_info(siteUrl, listTitle)` on the DESTINATION site using the underlying list's resolved title (derived from its ID/URL), not the web part display title, to get the list ID, default view ID, and server-relative URL
        - Use `build_list_webpart` with:
          - `siteUrl`: destination site URL
          - `listId`, `viewId`, `listUrl`, and `listTitle`: use the values returned by `resolve_list_info`
          - `title`: `webPart.title`
          - `isDocumentLibrary`: determine from the resolved destination list type
          - `webpartHeightKey`: 4 unless the classic configuration supplies a supported size
          - `hideCommandBar`: preserve a supported source preference; otherwise false
        - `build_list_webpart` adds the required web-relative list URL, root-folder path, searchable list title, and dynamic-data configuration. Do not hand-roll or omit these fields.
        - When the exact/equivalent list resolves unambiguously, create a real List web part rather than falling back to text links or Quick Links. Use fallback content only when no valid destination list exists.
        - After building, confirm `selectedListId` and `selectedListUrl` identify the intended source/equivalent list. Reject mappings where only the display title matches.
    → Tier 3 (last resort): yellow-highlighted text fallback noting the classic type + modern alternatives
  else if zone.html is not empty:
    → build_text_webpart with zone.html and sourceUrl
```

Position-based matching: wpbox GUIDs in HTML don't match web part entry IDs — match by position index.

Before saving, reconcile every `wikiZones[].webPartIds` entry against exactly one modern control or one yellow fallback. A `build_any_webpart` response may wrap its control in a `webpart` field; pass the inner control to the canvas or let `build_canvas_layout` unwrap it. Never pass an unrecognized wrapper directly to `create_modern_page` or `update_modern_page`, because it must fail rather than silently dropping the control.

#### Modern Fallback Notice Format

All explanatory fallbacks for unsupported, script-dependent, or unresolved classic web parts must be visually distinct from migrated page content. Build them as a Text web part with the complete notice in a Canvas RTE-safe yellow table callout:

```html
<table style="width:100%;border-collapse:collapse"><tbody><tr>
  <td style="background-color:#fff4ce;border:1px solid #ffb900;padding:12px">
    <strong>Modern fallback — {classic web part title or type}</strong><br>
    This section previously provided {lost behavior}. It cannot run as-is on a modern SharePoint page.<br>
    <strong>Recommended modern alternative:</strong> {specific replacement or next step}.
  </td>
</tr></tbody></table>
```

The complete notice must remain inside the yellow callout. The yellow background is the required visual distinction; tenant styling can override the border color. Do not use this treatment for ordinary migrated text.

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

3. Call `create_modern_page` (or `update_modern_page` if updating) with the title and required `titleArea` to write the draft page

4. Capture a rendered screenshot after creation/update. Verify that the title region visibly displays `content.title`, and that every Quick Links and List/SPFx web part title appears with its rendered control. `extract_page_data` can report `webPartCount: 0` for SPFx controls, so also verify that expected list titles or representative item labels appear in `textPreview`. Do not count source evidence tables, fallback notices, or ordinary body links as proof that a List web part rendered. If a title or expected list content is absent, correct the mapping before reporting success.

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
       <table style="width:100%;border-collapse:collapse"><tbody><tr>
       <td style="background-color:#fff4ce;border:1px solid #ffb900;padding:12px">
       <strong>Modern fallback — Interactive Dashboard</strong><br>
       This section contained a jQuery KPI dashboard that displayed live metrics.
       JavaScript content cannot run in modern pages.<br>
       <strong>Recommended modern alternatives:</strong> Embed a Power BI dashboard for
       live KPI visualization, or build a custom SPFx web part to replicate the
       functionality.</td></tr></tbody></table>)

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
- **Inline styles:** Preserve only the documented Canvas RTE-safe subset above. Convert callouts to one-cell tables; do not retain style blocks, custom classes, layout CSS, or font families.
- **Image sizing in text web parts:** HTML `width`/`height` attributes on `<img>` tags are preserved in the saved HTML but **ignored by SharePoint's modern RTE renderer** — images scale to fill their containing column regardless. To control image size, use multi-column section layouts (`threeColumns` = ~33% width each) to constrain the column width rather than relying on image dimensions.
- **Nested tables:** Layout tables inside content tables may not render well. Flatten where possible.
- **Cross-tenant images:** Image web parts with `imageSourceType: 2` (external URL) show stock placeholder images when the URL points to a different SharePoint tenant. The fix is to download the images from the source tenant and upload them to the destination site's SiteAssets library — see [Cross-Tenant Assets](#cross-tenant-assets).

---

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `build_text_webpart(innerHtml, sourceUrl?)` | Rich text web part |
| `build_quick_links_webpart(links[], layoutId)` | Quick Links |
| `build_list_webpart(siteUrl, listId, viewId, listUrl, listTitle, ...)` | List / library |
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
