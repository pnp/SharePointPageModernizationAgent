---
name: extract-and-understand
description: Extract classic SharePoint pages and build a CIM (Canonical Intermediate Model) for migration.
model: sonnet
---

# Phase 1: Extract & Understand

Extract a classic SharePoint page (wiki, web part page, or publishing page), classify each content block by intent, build a CIM (Canonical Intermediate Model), and save it.

**After building and saving the CIM, immediately invoke the `transform-and-create` skill to proceed** — unless invoked from `migrate-site` (which extracts all pages first, then migrates in Phase 2).

---

## Core Rules

- **Understand intent, not just tags.** Classify by what the content is trying to do.
- **Try your best.** A creative approximation beats a bland fallback; use `build_any_webpart` as the escape hatch.
- **Be honest about limits.** JavaScript-dependent content cannot run in modern pages. Preserve it as text with alternatives.
- **Never silently drop content.**
- **Be autonomous.** Ask only when you cannot proceed:
  - the destination site URL is unknown for a publishing site migration where the Site Pages feature is not activated
  - the content is genuinely ambiguous in a way that would materially change the result
- Do **not** ask about layout choices, web part type, skipping empty web parts, or page naming.

---

## Workflow

### Step 0: Extract & Build CIM

1. Call `extract_classic_page(siteUrl, pageName)`.
2. Build a CIM from the extracted bundle that captures:
   - page title, type (`wiki` / `webpart` / `publishing`), author, and layout
   - content zones or wiki zones with their HTML
   - web parts found (type, title, resolved content) and whether any content contains scripts
   - for publishing pages: field controls from the layout ASPX, web part zones and column widths, and publishing field values such as images, byline, and dates
   - if `publishingLayoutHtml` is present, analyze it as hardcoded page-layout ASPX content shared by every page using that layout; identify headings, navigation tiles, link grids, images, CTAs, and similar template-level blocks
   - the proposed migration plan for each content block / field / zone (text web part, image web part, Quick Links, and so on)
   - **cross-tenant asset detection:** when the destination site is on a different tenant, call `discover_page_assets(siteUrl, pageName, destSiteUrl)` and include the `crossTenantAssets` count and list in the CIM. Server-relative URLs (for example, `/sites/pub1/images/photo.jpg`) resolve only within the same tenant.
3. Classify each content block by intent using [CEWP Content Classification](#cewp-content-classification):
   - consult the [Web Part Mapping Reference](#web-part-mapping-reference) table below for the modern equivalent
   - inspect the actual HTML content to understand what the user is trying to accomplish
   - consider the page as a whole (dashboard, wiki article, landing page, and so on)
4. Present a brief CIM summary to the user (page type, section count, key decisions) as informational output, but do **not** wait for confirmation; proceed immediately to saving and handoff.

### Step 1: Save CIM to File

1. Save to `<git_repo_path>\pageunderstanding\<sitename>\<pagename>.json`
   - `<sitename>`: derive from the site URL path and replace `/` with `-` (for example, `/sites/pub1` → `sites-pub1`)
   - `<pagename>`: page name without `.aspx`
2. Create `pageunderstanding/<sitename>/` if needed.
3. Always overwrite existing files without reading or merging them.

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

**Web part `modernMapping`:** For each web part in `content.webParts`, consult `get_webpart_mapping_hints` and add a `modernMapping` with the correct schema properties. See the `webpart-mapping-reference` skill for the authoritative List web part property schema and examples.

**Zone-aware hints:** When `PublishingPageContent` or `WikiField` contains embedded web parts, the `transformationHints` note must reference the concrete `modernMapping` strategy, not “render as placeholder”.

**HTML table layout detection:** When `PublishingPageContent` uses an outer `<table>` (typically `class="ms-rteTable-*"` or `width="100%"`) for multi-column layout, the CIM `transformationHints` **must** capture that structure:

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

This ensures `transform-and-create` builds multi-column modern sections instead of flattening everything into `oneColumn`. Inspect the top-level table's `<td>` widths or proportions to determine the column ratio.

**Image dimensions:** For every image in `contentBlocks` or `publishingFields`, capture `imgWidth` and `imgHeight` from the extracted data. The classic extraction already provides `naturalWidth`/`naturalHeight` or explicit `width`/`height` attributes, and the Image web part needs these values to avoid collapsing to `0×0`.

---

## Web Part Mapping Reference

Sorted by usage. Tier: 1 = Direct, 2 = Conditional, 3 = Complex, 4 = No OOB (SPFx needed), 5 = Deprecated/Dropped.

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

| Pattern | Signals | Action |
|---|---|---|
| Navigation / Link Lists | `<ul>` or `<ol>` where most `<li>` contain `<a>` tags | `build_quick_links_webpart` — extract link text and URLs |
| Embedded Content | `<iframe>`, `<embed>`, `<object>` tags | `build_embed_webpart` with the `src` URL. YouTube URLs auto-route to the YouTube web part. |
| Image Galleries / Hero Images | Multiple `<img>` tags, or one large image with overlay text | Single image → `build_image_webpart`; multiple images → `build_any_webpart` with Image Gallery; image with text overlay → Hero via `build_any_webpart` |
| Data Tables | `<table>` with `<thead>` and `<tbody>` | `build_text_webpart` — modern text web parts render tables well |
| Styled Banners / Announcements | Large text, colored backgrounds, call-to-action buttons | Hero or Call to Action via `build_any_webpart`, or `build_text_webpart` |
| JavaScript-Dependent Content | `<script>`, `onclick`, jQuery references, `SP.js` calls | `build_text_webpart` fallback whose complete explanatory note is wrapped in `<span class="ms-rtebackcolor-3">...</span>` |

Scripts cannot run in modern pages.

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
| Last resort / unknown | `build_text_webpart` | Fallback — preserve content as yellow-highlighted explanatory text |

---

## Troubleshooting & Tools

- If `extract_classic_page` fails, verify the site URL and page name.
- Publishing sites can host modern pages **only when the Site Pages feature is activated** (a Site Pages library exists). If activated, migrate in the same site; otherwise the user must specify a separate destination site.
- Permission errors mean the app needs at least `Sites.Read.All`.
- `extract_page_data` (used in `compare-and-refine`) only works on **modern** pages. It returns `No content container found` on classic wiki/publishing pages. Always use `extract_classic_page` for source extraction.

| Tool | Purpose |
|------|---------|
| `extract_classic_page(siteUrl, pageName)` | Extract classic page content (WikiField HTML, web parts, resolved CEWP content) |
| `get_modern_webpart_catalog(apiVersion?)` | Discover available modern web parts with schemas |
| `discover_page_assets(siteUrl, pageName, destSiteUrl?)` | Scan page assets and classify cross-tenant vs same-tenant |
