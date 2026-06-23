---
name: extract-and-understand
description: Extract classic SharePoint pages and build a CIM (Canonical Intermediate Model) for migration.
model: opus
---

# Phase 1: Extract & Understand

Extract a classic SharePoint page (wiki, web part page, or publishing page), classify each content block by intent, build a CIM (Canonical Intermediate Model), and save it.

**After building and saving the CIM, immediately invoke the `transform-and-create` skill to proceed** — unless invoked from `migrate-site` (which extracts all pages first, then migrates in Phase 2).

---

## Principles

1. **Understand intent, not just tags.** Classify by WHAT the content is trying to DO.
2. **Try your best.** A creative approximation beats a bland fallback. Use `build_any_webpart` as escape hatch.
3. **Be honest about limits.** JavaScript-dependent content can't run in modern pages. Preserve as text with alternatives.
4. **Never silently drop content.**
5. **Be autonomous.** Make reasonable decisions without asking the user.

---

## When to Ask the User

Only ask when you **cannot proceed**:
- **Destination site URL is unknown** for a publishing site migration
- **Genuinely ambiguous content** that would significantly impact the result

Do NOT ask about layout choices, web part type, skipping empty web parts, or page naming.

---

## Workflow

### Step 0: Extract & Build CIM

1. Call `extract_classic_page` with the site URL and page name
2. Build a **CIM (Canonical Intermediate Model)** from the extracted bundle — a structured summary of:
   - What type of page is it? (wiki / web part page / publishing)
   - Page title, type (wiki / web part page / publishing), author, and layout
   - Content zones or wiki zones with their HTML content
   - Web parts found (type, title, resolved content), does any content have scripts?
   - For publishing pages: field controls from the layout ASPX, web part zones and column widths, publishing field values (images, byline, dates)
   - If the bundle has `publishingLayoutHtml`, this is hardcoded content from the page layout ASPX template (not stored in publishing fields or web parts). Analyze this HTML to identify content blocks (headings, navigation tiles, link grids, images, CTAs). This content is shared by ALL pages using this layout — it is template-level, not page-specific.
   - Proposed migration plan: what each content block / field / zone becomes in modern (text web part, image web part, quick links, etc.)
   - **Cross-tenant asset detection:** If the destination site is on a different tenant, call `discover_page_assets(siteUrl, pageName, destSiteUrl)` to get a structured inventory of all referenced assets (images, CSS, JS) classified as cross-tenant or same-tenant. Include the `crossTenantAssets` count and list in the CIM. Server-relative URLs (e.g., `/sites/pub1/images/photo.jpg`) only resolve within the same tenant.
3. For each content block, classify by intent using the [CEWP Content Classification](#cewp-content-classification) rules. For each web part, understand what it's doing:
   - Consult the [Web Part Mapping Reference](#web-part-mapping-reference) table below to determine the modern equivalent
   - Look at the actual HTML content — what is the user trying to accomplish?
   - Consider the page as a whole — is this a dashboard? A wiki article? A landing page?
4. **Present a brief CIM summary** to the user (page type, section count, key decisions) as informational output — but do NOT wait for confirmation. Proceed immediately to saving and handing off.

### Step 1: Save CIM to File

1. File path: `<git_repo_path>\pageunderstanding\<sitename>\<pagename>.json`
   - `<sitename>`: derive from site URL path, replace `/` with `-` (e.g., `/sites/pub1` → `sites-pub1`)
   - `<pagename>`: page name without `.aspx`
2. Create `pageunderstanding/<sitename>/` if needed
3. Always overwrite existing files without reading them (do not attempt to merge or preserve any existing data)

### CIM Schema

```json
{
  "schemaVersion": "1.0",
  "extractedAt": "<ISO 8601>",
  "source": { "siteUrl": "", "pageUrl": "", "pageName": "", "pageType": "wiki|webpart|publishing", "title": "" },
  "metadata": { "author": {}, "created": "", "modified": "", "modifiedBy": "", "contentTypeId": "", "uniqueId": "" },
  "publishingLayout": { ... },
  "content": {
    "title": "",
    "publishingFields": { ... },
    "webParts": [ ... ],
    "wikiZones": [ ... ]
  },
  "transformationHints": { ... }
}
```

**Publishing fields** in `content.publishingFields` use `type` discriminators:

| Type | Properties | Transform Action |
|------|-----------|-----------------|
| `image` | `html`, `imageUrl`, `altText`, `imgWidth`, `imgHeight` | `build_image_webpart` or `build_text_webpart(html)` without sourceUrl |
| `richHtml` | `html`, `plainText` | `build_text_webpart(html, sourceUrl)` |
| `text` | `value` | `build_text_webpart(<p>{value}</p>)` |
| `dateTime` | `value`, `isoDate` | `build_text_webpart(<p>{value}</p>)` |

**Web part modernMapping** — for each web part in `content.webParts`, consult `get_webpart_mapping_hints` and add a `modernMapping` with the correct schema properties. See the **webpart-mapping-reference** skill for the authoritative List web part property schema and examples.

**Zone-aware hints** — when PublishingPageContent or WikiField contains embedded web parts, the `transformationHints` note must reference the concrete `modernMapping` strategy (not "render as placeholder").

**HTML table layout detection** — when `PublishingPageContent` uses an outer `<table>` (typically `class="ms-rteTable-*"` or `width="100%"`) for multi-column layout, the CIM `transformationHints` MUST capture the table structure:

```json
{
  "transformationHints": {
    "layoutStrategy": "html-table",
    "tableLayout": {
      "columnRatio": "oneThirdLeftColumn",
      "rows": [
        { "leftContent": "hero image", "rightContent": "Getting Started through section X" },
        { "leftContent": "empty", "rightContent": "Section Y through Z" }
      ]
    }
  }
}
```

This ensures `transform-and-create` builds multi-column modern sections instead of flattening everything into `oneColumn`. Inspect the top-level table's `<td>` width styles or proportions to determine the column ratio.

**Image dimensions** — for every image in `contentBlocks` or `publishingFields`, capture `imgWidth` and `imgHeight` (in pixels) from the extracted data. The classic page extraction provides `naturalWidth`/`naturalHeight` or explicit `width`/`height` attributes. These dimensions are **required** for the Image web part to render correctly — without them, the image may collapse to 0×0.

---

## Web Part Mapping Reference

Sorted by usage. Tier: 1=Direct, 2=Conditional, 3=Complex, 4=No OOB (SPFx needed), 5=Deprecated/Dropped.

| # | Classic Web Part | Modern Target | Builder Tool | Tier | Notes |
|---|---|---|---|---|---|
| 1 | XsltListViewWebPart (3.1B/mo) | List / Events | `build_any_webpart` | 2 | TaskList/DiscussionBoard/Survey → no OOB |
| 2 | ContentEditorWebPart (2.3B/mo) | *See CEWP Classification* | varies | 2 | AI classification required — 7-branch PnP selector |
| 3 | ScriptEditorWebPart (1.6B/mo) | Text (scripts can't run) | `build_text_webpart` | 4 | Add explanatory note about lost scripts |
| 4 | ClientSideWebPart (311M/mo) | SPFx passthrough | `build_any_webpart` | 1 | 100% fidelity — reuse original component ID |
| 5 | ContentBySearchWebPart (223M/mo) | Highlighted Content | `build_any_webpart` | 3 | Lost: display templates, query rules |
| 6 | ContentByQueryWebPart (192M/mo) | Highlighted Content | `build_any_webpart` | 3 | Lost: cross-site CAML, XSL |
| 7 | SummaryLinkWebPart (184M/mo) | Quick Links / Text | `build_quick_links_webpart` | 1 | ~90% fidelity |
| 8 | ResultScriptWebPart (158M/mo) | Highlighted Content | `build_any_webpart` | 3 | Lost: JS display templates |
| 9 | ClientWebPart (139M/mo) | Add-in passthrough | `build_any_webpart` | 1 | ~95% fidelity |
| 10 | RSSAggregatorWebPart (137M/mo) | Text (no modern RSS) | `build_text_webpart` | 4 | Add note: no OOB RSS web part |
| 11 | ListFormWebPart (125M/mo) | Modern list forms | skip | 2 | Handled by modern form infrastructure |
| 12 | ListViewWebPart (125M/mo) | List / Events | `build_any_webpart` | 1 | Same branches as XsltListView |
| 13 | TitleBarWebPart (104M/mo) | Page title (auto) | skip | 5 | Modern pages have built-in title |
| 14 | SiteFeedWebPart (65M/mo) | News (imperfect) | `build_any_webpart` | 3 | Poor match for social feeds |
| 15 | PageViewerWebPart (60M/mo) | Embed | `build_embed_webpart` | 1 | Folder/file branch dropped |
| 16 | SearchBoxScriptWebPart (58M/mo) | Microsoft Search | skip | 4 | Global search replaces it |
| 17 | ImageWebPart (51M/mo) | Image | `build_image_webpart` | 1 | ~95% fidelity |
| 18 | MediaWebPart (46M/mo) | DocumentEmbed | `build_any_webpart` | 2 | Silverlight YouTube broken |
| 19 | SimpleFormWebPart (46M/mo) | Text (forms can't run) | `build_text_webpart` | 2 | Dropped without CSE |
| 20 | XmlWebPart (28M/mo) | Text (XSLT not supported) | `build_text_webpart` | 4 | Add note about lost XSLT |
| 21 | RefinementScriptWebPart (26M/mo) | PnP Modern Search | skip | 4 | No OOB refiners |
| 22 | BrowserFormWebPart (25M/mo) | PowerApps | skip | 4 | InfoPath deprecated |
| 23 | GettingStartedWebPart (24M/mo) | Not needed | skip | 5 | Dropped — modern onboarding exists |
| 24 | PictureLibrarySlideshowWP (21M/mo) | Image Gallery | `build_any_webpart` | 2 | ~80% fidelity |
| 25 | SearchNavigationWebPart (15M/mo) | PnP Modern Search | skip | 4 | No OOB search nav |
| 26 | DataFormWebPart (14M/mo) | Text (XSLT not supported) | `build_text_webpart` | 3 | Add note about lost XSLT |
| 27 | MembersWebPart (13M/mo) | People (manual) | `build_any_webpart` | 1 | PnP: text msg only, not People WP |
| 28 | AccessRequests* (3 types, ~11M ea) | N/A | skip | 5 | System pages — no migration needed |
| 29 | ErrorWebPart (11M/mo) | N/A | skip | 5 | System error placeholder |
| 30 | ExcelWebRenderer (11M/mo) | DocumentEmbed | `build_any_webpart` | 2 | Excel Services deprecated |
| 31 | UserDocsWebPart (9M/mo) | Highlighted Content | `build_any_webpart` | 1 | OneDrive integration |
| 32 | SPSlicerTextWebPart (7M/mo) | Power BI / SPFx | skip | 4 | No OOB slicer |
| 33 | ContactFieldControl (7M/mo) | People | `build_any_webpart` | 2 | Invalid users → error |
| 34 | DocumentSetContentsWP (7M/mo) | List + folder view | `build_any_webpart` | 4 | DocSet UI lost |
| 35 | QueryStringFilterWP (6M/mo) | SPFx dynamic data | skip | 4 | Filter WPs deprecated |
| 36 | WikiContentWebpart (6M/mo) | Text | `build_text_webpart` | 5 | Non-functional in SPO |
| 37 | SpListFilterWebPart (6M/mo) | SPFx dynamic data | skip | 4 | Filter WPs deprecated |
| 38 | DocumentSetPropertiesWP (5M/mo) | List + metadata | `build_any_webpart` | 4 | DocSet UI lost |
| 39 | SilverlightWebPart | None | skip | 5 | Dead technology (EOL 2021) |
| 40 | SPUserCodeWebPart | SPFx replacement | skip | 5 | Sandbox disabled in SPO |
| 41 | TableOfContentsWebPart | Site nav (auto) | skip | 5 | Modern nav replaces this |
| 42 | VisioWebAccess | DocumentEmbed | `build_any_webpart` | 2 | ~50%, Visio Services lost |

---

## CEWP Content Classification

ContentEditorWebPart (CEWP) contains arbitrary HTML. Classify by intent:

### Navigation / Link Lists
**Signals:** `<ul>` or `<ol>` where most `<li>` contain `<a>` tags
**Action:** `build_quick_links_webpart` — extract link text and URLs

### Embedded Content
**Signals:** `<iframe>`, `<embed>`, `<object>` tags
**Action:** `build_embed_webpart` with the `src` URL. YouTube URLs auto-route to the YouTube web part.

### Image Galleries / Hero Images
**Signals:** Multiple `<img>` tags, or a single large image with overlay text
**Action:** Single image → `build_image_webpart`. Multiple images → `build_any_webpart` with Image Gallery. Image with text overlay → Hero via `build_any_webpart`.

### Data Tables
**Signals:** `<table>` with `<thead>` and `<tbody>`, structured data rows
**Action:** `build_text_webpart` — modern text web parts render tables well

### Styled Banners / Announcements
**Signals:** Large text, colored backgrounds, call-to-action buttons
**Action:** Hero or Call to Action via `build_any_webpart`, or `build_text_webpart`

### JavaScript-Dependent Content
**Signals:** `<script>` tags, `onclick` handlers, jQuery references, `SP.js` calls
**Action:** `build_text_webpart` with explanatory note. Scripts cannot run in modern pages.

---

## Content Pattern → Tool Quick Reference

| Content Pattern | Tool | Notes |
|---|---|---|
| Navigation link lists | `build_quick_links_webpart` | Pick layout by density |
| Pure text / formatted content | `build_text_webpart` | Preserves rich HTML |
| Standalone images (same site) | `build_image_webpart` | Supports alt text, captions, links |
| Images from another site (cross-site) | `build_text_webpart` | Pass raw `<img>` HTML — inline RTE images for cross-site |
| Embedded content / iframes | `build_embed_webpart` | Auto-routes YouTube, Documents |
| Section separators | `build_divider_webpart` | — |
| Any known modern web part type | `build_any_webpart` | Escape hatch for any type by GUID |
| Last resort / unknown | `build_text_webpart` | Fallback — preserve content as formatted text |

---

## Troubleshooting

- If `extract_classic_page` errors, verify site URL and page name
- Publishing sites cannot host modern pages — user must specify a destination site
- Permission errors → app needs `Sites.Read.All` minimum

---

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `extract_classic_page(siteUrl, pageName)` | Extract classic page content (WikiField HTML, web parts, resolved CEWP content) |
| `get_modern_webpart_catalog(apiVersion?)` | Discover all available modern web parts with schemas |
| `discover_page_assets(siteUrl, pageName, destSiteUrl?)` | Scan page for all referenced assets; classify cross-tenant vs same-tenant |

> **Note:** `extract_page_data` (used in the compare-and-refine phase) only works on **modern** pages. It returns "No content container found" on classic wiki/publishing pages. Always use `extract_classic_page` for source page extraction. Use `extract_page_data` only for verifying the migrated modern destination page.
