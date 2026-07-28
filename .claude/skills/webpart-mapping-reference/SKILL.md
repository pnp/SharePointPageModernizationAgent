---
name: webpart-mapping-reference
description: Supplementary reference for PnP selector functions, Community Script Editor, Quick Links layouts, and JavaScript alternatives. Read on-demand for deeper migration details.
model: sonnet
---

# Web Part Mapping Reference (Supplementary)

Companion reference for the migration pipeline skills. It contains the authoritative mapping tables, CIM schema details, and zone-aware rules used during extraction (Phase 1) and transformation (Phase 2).

**For programmatic suggestions with confidence scores, always call `get_webpart_mapping_hints` first.** Use the tables below when AI judgment or exact property details are still needed.

---

## CIM Schema Specification

```json
{
  "schemaVersion": "1.0",
  "extractedAt": "<ISO 8601 timestamp>",
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

### Publishing fields format

Each field in `content.publishingFields` has a `type` discriminator:

| Field Type | Properties | Transform Action |
|------------|------------|------------------|
| `image` | `html`, `imageUrl`, `altText` | `build_text_webpart(html)` without sourceUrl (cross-site) |
| `richHtml` | `html`, `plainText` | `build_text_webpart(html, sourceUrl)` |
| `text` | `value` | `build_text_webpart(<p>{value}</p>)` |
| `dateTime` | `value`, `isoDate` | `build_text_webpart(<p>{value}</p>)` |

### Web part `modernMapping`

Each entry in `content.webParts` should include a `modernMapping` object:

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

**Property validation at transform time is mandatory:**
1. call `get_modern_webpart_catalog()` to get the real property schema
2. keep only schema-valid properties
3. populate every **required** property, using `resolve_list_info` for destination-site list/view GUIDs as needed
4. use the catalog `dataVersion` example (typically `"1.0"`) instead of guessing

---

## Zone-Aware Processing

Classic wiki and publishing pages can embed web parts inline with `<div class="ms-rte-wpbox">` markers. `extract_classic_page` splits these into `wikiZones`.

### Extract phase (Phase 1)

When building the CIM:
1. consult `get_webpart_mapping_hints` for each web part
2. populate `modernMapping` on `content.webParts`
3. add a `transformationHints.note` that names the concrete strategy, not “render as placeholder”

### Transform phase (Phase 2)

When processing `wikiZones`:
- **HTML zone** (`webPartIds` empty): `build_text_webpart(zone.html, sourceUrl)`
- **Web-part zone** (`webPartIds` non-empty): match by **position index**, then:
  1. if `resolvedHtml` exists, use `build_text_webpart` or classify it into a richer web part such as Quick Links or Image
  2. if `modernMapping` exists, validate it against the catalog schema, then use `modernMapping.builderTool` with `modernMapping.webPartId` and only schema-valid properties; for cross-site list web parts, call `resolve_list_info` to resolve destination-site equivalents
  3. only if neither exists and the type is truly unknown, create a yellow-highlighted text fallback naming the classic type and the recommended modern alternative

Never silently skip embedded web parts.

For every explanatory fallback, wrap the entire notice in `<span class="ms-rtebackcolor-3">...</span>`. `build_text_webpart` converts this to SharePoint's native yellow `highlightColorYellow`. Do not highlight ordinary migrated content.

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
| Unknown types | Text + Any | `build_text_webpart` / `build_any_webpart` | — | Analyze content directly |

---

## CEWP Content Classification

| Pattern | Signals | Action |
|---|---|---|
| Navigation / Link Lists | `<ul>` or `<ol>` where most `<li>` contain `<a>` tags | `build_quick_links_webpart`; see [Quick Links Layout Guide](#quick-links-layout-guide) |
| Embedded Content | `<iframe>`, `<embed>`, `<object>` tags | `build_embed_webpart` with the `src` URL; YouTube auto-routes to the YouTube web part |
| Image Galleries / Hero Images | Multiple `<img>` tags, or a single large image with overlay text | Single image → `build_image_webpart`; multiple images → consider `build_any_webpart` with Image Gallery; image with text overlay → consider Hero via `build_any_webpart` |
| Data Tables | `<table>` with `<thead>` and `<tbody>` | `build_text_webpart` |
| Styled Banners / Announcements | Large text, colored backgrounds, CTA buttons | Consider Hero or Call to Action via `build_any_webpart`, or `build_text_webpart` |
| JavaScript-Dependent Content | `<script>`, `onclick`, jQuery references, `SP.js` calls | `build_text_webpart` with the full explanatory note wrapped in `<span class="ms-rtebackcolor-3">...</span>` |

**CTA buttons:** Prefer styled `<a>` tags inside a text web part. The Button and CallToAction web parts are unreliable (inconsistent rendering, style loss, occasional silent drops on save), so a styled anchor inside `build_text_webpart` is the most predictable reproduction.

### Quick Links Layout Guide

| Layout | Use When |
|---|---|
| `CompactCard` | Compact navigation tiles |
| `List` | Detailed lists with descriptions |
| `Button` | Call-to-action buttons |
| `FilmStrip` | Horizontal scrollable links with thumbnails |
| `Grid` | Icon grid navigation |
| `Waffle` | Dense icon grid |

**Important caveat:** `layoutId` is persisted to the page JSON, but SPFx currently renders **CompactCard regardless**. Plan the visual design around CompactCard. If you need a true Button / FilmStrip / Grid look, fall back to a text web part with hand-built HTML.

### JavaScript Alternatives

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

**To enable:** Deploy [PnP react-script-editor](https://github.com/SharePoint/sp-dev-fx-webparts/tree/master/samples/react-script-editor) to the tenant app catalog, then set `pti.MappingProperties["UseCommunityScriptEditor"] = "true"`. **Without this, all script-dependent web parts are dropped.**

---

## BaseWebPart Fallback

If a web part type has no specific PnP mapping, the BaseWebPart default is `***Web part {Title} was not transformed***`. This is distinct from:
- **empty mappings** — silently dropped (for example, TitleBar / GettingStarted)
- **error text** — specific error text (for example, XmlWebPart / DataForm)
- **unmapped** — properties catalogued but no mapping node, so the web part falls to BaseWebPart (for example, RSSAggregator)

---

## Reference Files

| File | Contents | When to Read |
|---|---|---|
| `reference/pnp-transformations.md` | Per-webpart PnP details: selectors, branch tables, properties, migration %, corrections | Need exact PnP branch logic, property names, or migration specifics |

Source data: PnP `webpartmapping.xml` v1.0.2111.0.
