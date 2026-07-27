---
name: webpart-mapping-reference
description: Supplementary reference for PnP selector functions, Community Script Editor, Quick Links layouts, and JavaScript alternatives. Read on-demand for deeper migration details.
model: sonnet
---

# Web Part Mapping Reference (Supplementary)

Companion reference for the migration pipeline skills. Contains the authoritative mapping tables, CIM schema specification, and zone-aware processing details used during extraction (Phase 1) and transformation (Phase 2).

**For programmatic suggestions with confidence scores, always call `get_webpart_mapping_hints` first.** The reference tables below supplement the tool for cases requiring AI judgment.

---

## CIM Schema Specification

### Top-Level Structure

```json
{
  "schemaVersion": "1.0",
  "extractedAt": "<ISO 8601 timestamp>",
  "source": { "siteUrl": "", "pageUrl": "", "pageName": "", "pageType": "wiki|webpart|publishing", "title": "" },
  "metadata": { "author": {}, "created": "", "modified": "", "modifiedBy": "", "contentTypeId": "", "uniqueId": "" },
  "publishingLayout": { ... },     // publishing pages only
  "content": {
    "title": "",
    "publishingFields": { ... },   // publishing pages only
    "webParts": [ ... ],
    "wikiZones": [ ... ]           // wiki/publishing pages
  },
  "transformationHints": { ... }
}
```

### Publishing Fields Format

Each field in `content.publishingFields` has a `type` discriminator:

| Field Type | Properties | Transform Action |
|------------|------------|------------------|
| `image` | `html`, `imageUrl`, `altText` | `build_text_webpart(html)` without sourceUrl (cross-site) |
| `richHtml` | `html`, `plainText` | `build_text_webpart(html, sourceUrl)` |
| `text` | `value` | `build_text_webpart(<p>{value}</p>)` |
| `dateTime` | `value`, `isoDate` | `build_text_webpart(<p>{value}</p>)` |

### Web Part modernMapping

Each web part in `content.webParts` should include a `modernMapping` object with the recommended modern equivalent:

```json
{
  "id": "...",
  "typeName": "Microsoft.SharePoint.WebPartPages.XsltListViewWebPart",
  "title": "Pages",
  "listId": "...",
  "listUrl": "/sites/pub1/Pages",
  "modernMapping": {
    "modernType": "List",
    "webPartId": "f92bf067-bc19-489e-a556-7fe95f508720",
    "builderTool": "build_any_webpart",
    "properties": { "selectedListId": "...", "listTitle": "Pages", "selectedListUrl": "..." },
    "crossSiteNote": "For cross-site migration, resolve the destination site's equivalent library and update properties accordingly."
  }
}
```

**IMPORTANT — Property validation at transform time:** The `modernMapping.properties` stored in the CIM are extraction-time hints and may be incomplete or contain non-schema properties. Before calling `build_any_webpart`, the transform phase MUST:

1. Call `get_modern_webpart_catalog()` to retrieve the actual property schema for the target web part type
2. Include only properties that exist in the catalog schema — drop any non-schema properties
3. Ensure all **required** properties from the schema are populated (use `resolve_list_info` for list/view GUIDs on the destination site)
4. Use the `dataVersion` from the catalog example (typically `"1.0"`) — do not guess or use arbitrary versions

---

## Zone-Aware Processing

Classic wiki and publishing pages embed web parts inline within HTML content using `<div class="ms-rte-wpbox">` markers. The `extract_classic_page` tool returns a `wikiZones` array that splits content around these markers.

### Extract Phase (Phase 1)

When building the CIM for pages with embedded web parts:
1. Consult `get_webpart_mapping_hints` for each web part
2. Populate `modernMapping` on each web part in `content.webParts`
3. In `transformationHints`, add a `note` referencing the concrete strategy (not "render as placeholder")

### Transform Phase (Phase 2)

When processing `wikiZones` during transformation:

- **HTML zone** (empty `webPartIds`): `build_text_webpart` with `zone.html` and `sourceUrl`
- **Web part zone** (non-empty `webPartIds`): find the matching web part in `content.webParts` by position index, then:
  1. **If `resolvedHtml` exists** (e.g., CEWP with fetched content): use `build_text_webpart` with the resolved HTML, or classify the content and use a richer web part (Quick Links, Image, etc.)
  2. **If `modernMapping` exists**: validate properties against the catalog schema before building (see **Property validation at transform time** above). Use the `modernMapping.builderTool` with `modernMapping.webPartId` and only schema-valid properties. For cross-site migrations where `crossSiteNote` warns about constraints, call `resolve_list_info` to resolve destination-site equivalents (list GUIDs, view GUIDs, URLs).
  3. **Last resort only**: if neither `resolvedHtml` nor `modernMapping` is available AND the web part type is truly unknown, build a yellow-highlighted text fallback noting the classic web part type and suggesting modern alternatives.

**Never silently skip embedded web parts** — the user should see what was there and what to do about it.

For every explanatory fallback, wrap the complete notice in `<span class="ms-rtebackcolor-3">...</span>`. `build_text_webpart` converts this to SharePoint's native yellow `highlightColorYellow` formatting. Do not highlight ordinary migrated content.

---

## Classic-to-Modern Type Mapping

| Classic Web Part | Primary Modern Equivalent | Builder Tool | Fallback | Notes |
|---|---|---|---|---|
| ContentEditorWebPart | *Varies by content* | See CEWP Classification below | `build_text_webpart` | AI adds the most value here |
| ImageWebPart | Image | `build_image_webpart` | — | Direct 1:1 mapping |
| XsltListViewWebPart | List | `build_any_webpart` | `build_text_webpart` (link to list) | May need beta API |
| ListViewWebPart | List | `build_any_webpart` | `build_text_webpart` (link to list) | Same as XsltListView |
| PageViewerWebPart | DocumentEmbed or Embed | `build_any_webpart` / `build_embed_webpart` | — | DocumentEmbed for docs, Embed for URLs |
| ScriptEditorWebPart | Embed (no scripts) or Text (with scripts) | `build_embed_webpart` / `build_text_webpart` | — | Scripts cannot run in modern pages |
| SummaryLinkWebPart | Quick Links | `build_quick_links_webpart` | — | Natural mapping |
| ContentByQueryWebPart | Highlighted Content | `build_any_webpart` | `build_text_webpart` | Complex queries may need manual config |
| TitleBarWebPart | Text | `build_text_webpart` | — | Simple heading/caption |
| Unknown types | Text + Any | `build_text_webpart` / `build_any_webpart` | — | AI should analyze content directly |

---

## CEWP Content Classification

ContentEditorWebPart (CEWP) is where AI adds the most value. These contain arbitrary HTML that existing migration tools just dump as-is. Classify by intent:

### Navigation / Link Lists

**Signals:** `<ul>` or `<ol>` where most `<li>` contain `<a>` tags
**Action:** `build_quick_links_webpart` — extract link text and URLs
**Layout hint:** See Quick Links Layout Guide below

### Embedded Content

**Signals:** `<iframe>`, `<embed>`, `<object>` tags
**Action:** `build_embed_webpart` with the `src` URL
**Special:** YouTube URLs auto-route to the YouTube web part

### Image Galleries / Hero Images

**Signals:** Multiple `<img>` tags, or a single large image with overlay text
**Action:**

- Single image → `build_image_webpart`
- Multiple images → consider `build_any_webpart` with the Image Gallery web part type
- Image with text overlay → consider Hero web part via `build_any_webpart`

### Data Tables

**Signals:** `<table>` with `<thead>` and `<tbody>`, structured data rows
**Action:** `build_text_webpart` — modern text web parts render tables well

### Styled Banners / Announcements

**Signals:** Large text, colored backgrounds, call-to-action buttons
**Action:** Consider Hero or Call to Action web parts via `build_any_webpart`, or `build_text_webpart` with the formatted HTML.

**CTA buttons — prefer styled `<a>` tags inside a text web part.** The Button and CallToAction web parts are unreliable (inconsistent rendering, lost styles, occasional silent drops on save). A styled anchor (`<a href="..." style="display:inline-block;padding:8px 16px;background:#0078d4;color:#fff;border-radius:2px;text-decoration:none">…</a>`) inside `build_text_webpart` is the most predictable way to reproduce a classic CTA.

### JavaScript-Dependent Content

**Signals:** `<script>` tags, `onclick` handlers, jQuery references, `SP.js` calls
**Action:** `build_text_webpart` with the complete explanatory note wrapped in `<span class="ms-rtebackcolor-3">...</span>`. Cannot run scripts in modern pages.
**Common alternatives:** See JavaScript Alternatives table below
---
f
## Quick Links Layout Guide

| Layout | Use When |
|---|---|
| `CompactCard` | Compact navigation tiles |
| `List` | Detailed lists with descriptions |
| `Button` | Call-to-action buttons |
| `FilmStrip` | Horizontal scrollable links with thumbnails |
| `Grid` | Icon grid navigation |
| `Waffle` | Dense icon grid |

**Important caveat:** `layoutId` is persisted to the page JSON but SPFx currently renders **CompactCard regardless** of the value. Plan the visual design around CompactCard. If you need a true Button / FilmStrip / Grid look, fall back to a text web part with hand-built HTML.

## JavaScript Alternatives

| Classic Pattern | Modern Alternative |
|---|---|
| jQuery KPI dashboards | Power BI embed |
| SP REST API data fetchers | List web part or SPFx |
| Custom form handlers | Power Apps embed |
| Custom script web parts | SPFx web parts |

---

## PnP Selector Functions

| Function | Used By | Returns |
|---|---|---|
| `ListSelectorListLibrary({ListId},{XmlDefinition/ListViewXml})` | XsltListViewWP, ListViewWP | List, Library, Calendar, Issue, TaskList, DiscussionBoard, Survey, Undefined |
| `ContentEmbedSelectorContentLink({ContentLink},{Content},{FileContents},{UseCommunityScriptEditor})` | ContentEditorWP | Link, NonASPXLinkNoScript, NonASPXLink, ContentNoScript, Content, NonASPXUseCSE, ContentUseCSE |
| `ScriptEditorSelector({UseCommunityScriptEditor})` | ScriptEditorWP, SimpleFormWP | UseCommunityScriptEditor, NoScriptEditor |
| `ContentEmbedSelectorSourceType({SourceType})` | PageViewerWP | WebPage, ServerFolderOrFile |
| `ContentByQuerySelector({ListGuid},{ListName})` | ContentByQueryWP | Default, NoTransformation |
| `SummaryLinkSelector({SummaryLinksToQuickLinks})` | SummaryLinkWP | UseText, UseQuickLinks |
| `UserExistsSelector({PersonEmail})` | ContactFieldControl | ValidUser, InvalidUser |

## Community Script Editor (CSE)

**ControlId:** `3a328f0a-99c4-4b28-95ab-fe0847f657a3`

| Web Part | CSE Branch | Content Source |
|---|---|---|
| ScriptEditorWebPart | UseCommunityScriptEditor | Inline `{Script}` |
| ContentEditorWebPart | NonASPXUseCommunityScriptEditor | Linked file `{FileContentsEncoded}` |
| ContentEditorWebPart | ContentUseCommunityScriptEditor | Inline `{Script}` |
| SimpleFormWebPart | UseCommunityScriptEditor | Form `{Script}` |

**To enable:** Deploy [PnP react-script-editor](https://github.com/SharePoint/sp-dev-fx-webparts/tree/master/samples/react-script-editor) to tenant app catalog, then set `pti.MappingProperties["UseCommunityScriptEditor"] = "true"`. **Without this, all script-dependent web parts are dropped.**

---

## BaseWebPart Fallback

If a web part type has no specific mapping in PnP, the BaseWebPart default applies: `***Web part {Title} was not transformed***`. This is distinct from **empty mappings** (silently dropped, e.g., TitleBar/GettingStarted), **error text** (specific error, e.g., XmlWebPart/DataForm), and **unmapped** (properties catalogued but no mapping node, falls to BaseWebPart, e.g., RSSAggregator).

---

## Reference Files

| File | Contents | When to Read |
|---|---|---|
| `reference/pnp-transformations.md` | Per-webpart PnP details: selectors, branch tables, properties, migration %, corrections | Need exact PnP branch logic, property names, or migration specifics |

Source data: PnP `webpartmapping.xml` v1.0.2111.0.
