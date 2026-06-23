# PnP Page Transformation Details

Per-web-part PnP transformation details extracted from `webpartmapping.xml` v1.0.2111.0. Read this file when you need selector branches, property names, or migration specifics for a particular classic web part.

---

## Tier 1: Direct Mapping

### ClientSideWebPart
- **Selector:** None
- **Mapping:** `default` → Custom (passthrough: ControlId=`{ClientSideWebPartId}`, JsonControlData=`{JsonProperties}`)
- **Properties:** `ClientSideWebPartId` (guid), `ClientSideWebPartData` (via `ExtractWebpartProperties`)
- **Migration:** 100%. SPFx components work identically on modern pages. ~47% faster load, ~32% memory reduction without bridge overhead.

### ImageWebPart
- **Selector:** None
- **Mapping:** `default` → Image web part
- **Properties:** `ImageLink` (via `ReturnCrossSiteRelativePath`, `ImageLookup`, `ReturnFileName`), `AlternativeText`, `VerticalAlignment`, `HorizontalAlignment`, `BackgroundColor`
- **Migration:** ~95%. Lost: custom borders, image maps, alignment-specific CSS.

### TitleBarWebPart
- **Selector:** None
- **Mapping:** `default` → **Empty (dropped)**. Modern pages have built-in title/banner.
- **Properties:** `HeaderTitle`, `HeaderCaption`, `HeaderDescription`, `Image`

### ListViewWebPart
- **Selector:** `ListSelectorListLibrary({ListId},{ListViewXml})`

| Branch | Target | Behavior |
|---|---|---|
| List (default) | List WP (isDocumentLibrary: false) | Standard list view |
| Library | List WP (isDocumentLibrary: true) | Document library view |
| Calendar | Events WP | Calendar/events view |
| Issue | List WP (isDocumentLibrary: false) | Issue tracking list |
| TaskList | ClientSideText (error) | No OOB replacement |
| DiscussionBoard | ClientSideText (error) | No OOB replacement |
| Survey | ClientSideText (error) | No OOB replacement |
| Undefined | ClientSideText (error) | No mapping possible |

- **Properties:** `ListId`, `ListViewXml`, `ListName`, `ViewFlag`, `ViewFlags`, `ViewContentTypeId`, `PageType`
- **Migration:** ~85%. Lost: TaskList/DiscussionBoard/Survey types, custom CAML, datasheet view.

### ClientWebPart (Add-in Part)
- **Selector:** None
- **Mapping:** `default` → ClientWebPart (JsonControlData generated at runtime due to dynamic add-in nature)
- **Properties:** `FeatureId`, `ProductWebId`, `ProductId`
- **Migration:** ~95%. Add-in parts continue to work on modern pages.

### MembersWebPart
- **Selector:** None
- **Mapping:** `default` → ClientSideText: "Managing site members now is done using the **Settings -> Site Permissions pane**."
- **Properties:** `DisplayType`, `MembershipGroupId`, `Toolbar`
- **Migration:** ~3% (PnP). Text message only — no member data migrated. **Correction:** Original AI analysis incorrectly rated 8/10 with People WP target. PnP only produces a text message.

### GettingStartedWebPart
- **Selector:** None
- **Mapping:** `default` → **Empty (dropped)**. "Don't want to retain this web part."
- **Correction:** Original AI rated 7/10 — but PnP drops entirely with no content migrated.

### PictureLibrarySlideshowWebPart
- **Selector:** None
- **Mapping:** `default` → ImageGallery WP
- **Properties:** `LibraryGuid` (via `ListCrossSiteCheck`), `Layout`, `Speed`, `ShowToolbar`, `ViewGuid`
- **Migration:** ~80%. Lost: custom transitions, random ordering, specific view filtering.

### PageViewerWebPart
- **Selector:** `ContentEmbedSelectorSourceType({SourceType})`

| Branch | Target | Behavior |
|---|---|---|
| WebPage (default) | ContentEmbed WP | Embeds URL via iframe |
| ServerFolderOrFile | **Empty (dropped)** | Not supported in modern |

- **Properties:** `ContentLink`, `SourceType`
- **Migration:** ~90%. Lost: folder/file browsing. HTTP→HTTPS upgrade needed.

### UserDocsWebPart
- **Selector:** None
- **Mapping:** `default` → ContentRollup WP (via `UserDocumentsToHighlightedContentProperties`)
- **Migration:** ~85%. Integrates with OneDrive.

---

## Tier 2: Conditional Mapping

### XsltListViewWebPart
- **Selector:** `ListSelectorListLibrary({ListId},{XmlDefinition})`
- **Branches:** Same 8 branches as ListViewWebPart (List/Library/Calendar/Issue/TaskList/DiscussionBoard/Survey/Undefined)
- **Properties:** `ListId`, `XmlDefinition`, `JSLink`, `PageSize`, `ViewFlags`, `Direction`, `AllowEdit`, `GhostedXslLink`, `XslLink`, `DataSourceMode`, and many more
- **Key Functions:** `ListCrossSiteCheck`, `ListAddWebRelativeUrl`, `ListAddServerRelativeUrl`, `ListDetectUsedView`, `ListHideToolBar`
- **Migration:** Varies by complexity: standard views ~85%, custom XSLT ~30-40%, JSLink customizations require SPFx Field Customizer rewrite. Lost: XSLT, JSLink, custom toolbar actions, server-side query processing, connected web parts (IRowProvider/IFilterConsumer).
- **Source note:** CSR (Client-Side Rendering) disabled when: server render mode, ECB mode, customized XSL, v4 UI, or inline edit. Timeline and hierarchy rendering not migrated.
- **Correction:** Added missing `Undefined` branch (error text).

### ContentEditorWebPart
- **Selector:** `ContentEmbedSelectorContentLink({ContentLink}, {Content}, {FileContents}, {UseCommunityScriptEditor})`

| Branch | Target | Behavior |
|---|---|---|
| Link (default) | ContentEmbed WP | ASPX file links — embedded via iframe |
| NonASPXLinkNoScript | ClientSideText | Non-ASPX linked file without script — rendered as text |
| NonASPXLink | ClientSideText (error) | Non-ASPX linked file WITH script — error about renaming to .aspx |
| ContentNoScript | ClientSideText | Inline content without script — rendered as clean text |
| Content | ClientSideText (error) | Inline content WITH script — error message |
| NonASPXUseCommunityScriptEditor | Custom (CSE) | Linked file with script, CSE enabled. Uses `{FileContentsEncoded}` |
| ContentUseCommunityScriptEditor | Custom (CSE) | Inline content with script, CSE enabled. Uses `{Script}` |

- **Properties:** `ContentLink`, `Content`, `ChromeType`, `PartStorage` (derived: `FileContents`, `Script`, `CleanedContents`, `CleanedFileContents`, `FileContentsEncoded`)
- **Content resolution priority:** `_partContent` → `_content` → empty. Token replacement applies 6 types: `_WPQ_`, `_WPR_`, `_WPSRR_`, `_WPID_`, `_LogonUser_`, `_WebLocaleId_`.
- **Migration:** ~70%. Lost: JS execution, form submissions, ActiveX/plugins.
- **Corrections:** (1) Split CSE into two branches: NonASPX vs Content. (2) Fixed mapping name from "Link (ASPX)" to "Link".

### SummaryLinkWebPart
- **Selector:** `SummaryLinkSelector({SummaryLinksToQuickLinks})`

| Branch | Target | Behavior |
|---|---|---|
| UseText (default) | ClientSideText | Transforms SummaryLinkStore HTML via `TextCleanUpSummaryLinks` |
| UseQuickLinks | QuickLinks WP | Converts links to QuickLinks JSON via `SummaryLinksToQuickLinksProperties` |

- **Properties:** `SummaryLinkStore` (HTML), `ChromeType`, `Xsl`, `QuickLinksJsonProperties`
- **Migration:** ~90%. Lost: custom XSL styling, complex group structures.

### ContentByQueryWebPart
- **Selector:** `ContentByQuerySelector({ListGuid},{ListName})`

| Branch | Target | Behavior |
|---|---|---|
| Default (default) | ContentRollup WP | Converts CAML query via `ContentByQueryToHighlightedContentProperties` |
| NoTransformation | ClientSideText (error) | Unsupported cases |

- **Properties:** `WebUrl`, `ListGuid`, `ListName`, `ServerTemplate`, `ContentTypeBeginsWithId`, filter chains (FilterField1-3, FilterOperator1-3, FilterDisplayValue1-3), `SortBy`, `GroupBy`, `ItemLimit`, `DisplayColumns`, `DataMappings`, many more
- **Scope detection:** List (WebUrl + ListGuid/ListName), WebAndBelow (WebUrl only), SiteCollection (neither). Supports 8 filter types: Text, User, Date, Lookup, Taxonomy, TaxonomyMulti, Choice, Number. Audience filtering multiplies ItemLimit by 5 for post-filtering.
- **Migration:** ~55% overall. Standard list queries ~70-80%, cross-site with taxonomy ~30-40%, with audience targeting ~20-30%. Lost: cross-site collection scope, complex CAML joins, XSL templates, server-side aggregation.

### MediaWebPart
- **Selector:** None
- **Mapping:** `default` → DocumentEmbed WP
- **Properties:** `AutoPlay`, `MediaSource`, `Loop`, `PreviewImageSource`, `TemplateSource`, `DisplayMode`, `ShowEmbedControl`, `VideoSetEmbedCode`, `VideoSetSource`, `ConfigureFromContext`
- **Note:** MediaSource only set when preview image also set. Silverlight-based YouTube playback is already broken in modern browsers.
- **Migration:** ~75%. Lost: Silverlight playback, custom playback controls, legacy formats.

### SimpleFormWebPart
- **Selector:** `ScriptEditorSelector({UseCommunityScriptEditor})`

| Branch | Target | Behavior |
|---|---|---|
| UseCommunityScriptEditor (default) | Custom (CSE) | Form content preserved via CSE |
| NoScriptEditor | **Empty (dropped)** | Cannot transform without CSE |

- **Properties:** `Content`
- **Migration:** ~60% with Microsoft Forms. Lost: HTML form embedding, server-side postback, IRowProvider.

### ContactFieldControl
- **Selector:** `UserExistsSelector({PersonEmail})`

| Branch | Target | Behavior |
|---|---|---|
| ValidUser (default) | People WP | Maps user details from `LookupPerson` |
| InvalidUser | ClientSideText (error) | "User with ID {ContactLoginName} could not be found" |

- **Properties:** `ContactLoginName` (via `LookupPerson`) → derived: `PersonEmail`, `PersonName`, `PersonUPN`, `PersonRole`, `PersonDepartment`, `PersonPhone`, `PersonSip`
- **Migration:** ~55%. Lost: non-person contacts, custom field layouts, vCard export.

### ExcelWebRenderer
- **Selector:** None
- **Mapping:** `default` → DocumentEmbed WP
- **Properties:** `WorkbookUri`, `TitleUrl`, `VisibleItem` (→ `chartitem`), `AllowInteractivity`, `TypingAndFormulaEntry`, `AllowSorting`, `AllowFiltering`, `AllowPivotSpecificOperation`
- **Migration:** ~40%. Lost: Excel Services (deprecated), parameter provider connections, typing/formula entry, pivot operations.

---

## Tier 3: Complex / High Complexity

### ContentBySearchWebPart
- **Selector:** None
- **Mapping:** `default` → ContentRollup WP (via `ContentBySearchToHighlightedContentProperties`)
- **Properties:** `DataProviderJSON` (JSON array for query rules, result sources, KQL templates), `SelectedPropertiesJson` (managed property mapping), `ResultsPerPage`, `RenderTemplateId`, many display/behavior flags
- **Feature dependency:** Requires `SearchDrivenContent` feature activation. `SmallBusinessWebsite` feature blocks it.
- **Migration:** ~60%. Lost: display templates (JS), custom result types, advanced query rules, query variables.

### ResultScriptWebPart
- **Selector:** None
- **Mapping:** `default` → ContentRollup WP (same `ContentBySearchToHighlightedContentProperties` function as CBS)
- **Properties:** `DataProviderJSON`, `SelectedPropertiesJson`, `ResultsPerPage`, `RenderTemplateId`, `QueryGroupName`, many display flags
- **Migration:** ~40%. Lost: JS display templates, query groups, hit highlighting, connected refinement.

### SiteFeedWebPart
- **Selector:** None
- **Mapping:** `default` → News WP. XML comment: "News is not the perfect mapping, currently there's no OOB replacement for site feed data"
- **Properties:** `IsIncluded`, `Dir`, `IsIncludedFilter`
- **Migration:** ~35%. Lost: classic newsfeeds (deprecated), site-specific social feeds, MySite integration.

### DataFormWebPart
- **Selector:** None
- **Mapping:** `default` → ClientSideText error: "The DataFormWebPart (List: {ListName}, Id: {ListId}) could not be transformed."
- **Properties:** `ListName`, `ListId`, `PageType`, `FormType`, `ControlMode`, `ViewFlag`, `ViewFlags`, `ListItemId`, `DataFields`, `DataSourceID`
- **Data source types:** SPDataSource (SharePoint lists), XMLDataSource, ObjectDataSource, SqlDataSource. Parameter binding from QueryString, Form, Postback, WPVariable, CAMLVariable, SSOTicket. Runtime functions include FormatDate, GenFireServerEvent, DataBind, URLLookup.
- **Migration:** ~0% automated. Everything lost: XSLT, multi-source joins, conditional formatting, parameter binding, form operations (Insert/Update/Delete).

### ScriptEditorWebPart
- **Selector:** `ScriptEditorSelector({UseCommunityScriptEditor})`

| Branch | Target | Behavior |
|---|---|---|
| UseCommunityScriptEditor (default) | Custom (CSE, ControlId: 3a328f0a-...) | Uses CSE SPFx web part |
| NoScriptEditor | **Empty (dropped)** | Web part dropped entirely |

- **Properties:** `Content` (→ `{Script}` via `HtmlEncodeForJson`)
- **IMPORTANT:** `UseCommunityScriptEditor` is Default="true" but only activates when explicitly configured. Without it, NoScriptEditor effectively applies.
- **Migration:** ~5% without CSE. Lost: JS execution, custom business logic, DOM manipulation, global variables.

### XmlWebPart
- **Selector:** None
- **Mapping:** `default` → ClientSideText error: "The XmlWebPart reads XML and then uses XSL to produce HTML. This is currently not supported."
- **Properties:** `XMLLink`, `XML`, `XSLLink`, `XSL`, `PartStorage`
- **Migration:** ~0% automated. Lost: XSLT processing, XML/XSL architecture, server-side transformation.

### BrowserFormWebPart (InfoPath)
- **Selector:** None
- **Mapping:** `default` → **Empty (dropped)**. XML comment: "TODO: dropping for now"
- **Note:** No Properties section defined in PnP XML — "Still to investigate: why don't I see the needed properties?"
- **Migration:** ~0%. InfoPath is deprecated. Rebuild with PowerApps, SPFx, or third-party.

---

## Tier 4: Unmapped in PnP

These web parts have property definitions in the PnP XML but **no mapping node**. They fall through to BaseWebPart default: `***Web part {Title} was not transformed***`.

| Web Part | Key Properties | Modern Alternative |
|---|---|---|
| RSSAggregatorWebPart | `FeedUrl`, `Feed`, `FeedLimit`, `CacheDuration`, `XslUrl`. Supports RSS 2.0, RDF/RSS 1.0, Atom 1.0/0.3. Uses 4 XSL templates. Has `IWebPartField` connections. | SPFx RSS reader, Power Automate + List |
| SearchBoxScriptWebPart | `QueryStringParameterName`, `InitialPrompt`, `TrySharePointSearch` | Microsoft Search (global), PnP Modern Search |
| RefinementScriptWebPart | `SelectedRefinementControlsJson`, `RenderTemplateId`, `StatesJson` | PnP Modern Search Refiners, SPFx |
| SearchNavigationWebPart | `QueryGroupName`, `MaxLinksBeforeOverflow` | PnP Modern Search, SPFx tabs |
| SPSlicerTextWebPart | _(minimal)_ | Power BI slicers, SPFx filter |
| SpListFilterWebPart | _(minimal)_ | SPFx dynamic data providers |
| QueryStringFilterWebPart | _(minimal)_ | SPFx dynamic data + URL params |
| DocumentSetContentsWebPart | _(minimal)_ | List WP + folder view |
| DocumentSetPropertiesWebPart | _(minimal)_ | List WP + metadata view, Page Properties WP |

---

## Tier 5: Deprecated / System

### SilverlightWebPart
- **Mapping:** `Drop` → ClientSideText: "No modern equivalent for Silverlight ({Url} / {ApplicationXml})."
- Dead technology (EOL October 2021). Complete rebuild required.

### SPUserCodeWebPart
- **Mapping:** `default` → **Empty (dropped)**. "Feature does not work anymore in SPO."
- Sandbox solutions disabled in SPO. Rebuild as SPFx.

### TableOfContentsWebPart
- **Mapping:** `default` → **Empty (dropped)**. "Closely resembles the site navigation."
- Modern sites have built-in hub/mega menu navigation.

### WikiContentWebpart
- **Mapping:** `default` → ClientSideText: "Not functional anymore in SPO...hence it's not migrated."
- Content property not reliably exported. No migration path.

### VisioWebAccess
- **Selector:** None
- **Mapping:** `default` → DocumentEmbed WP
- **Properties:** `DiagramPath` (via `ReturnServerRelativePath`, `DocumentEmbedLookup`), `ShapeDataNames`, `ShowBackground`, `ShowPageNavigation`, many interactive controls
- **Migration:** ~50%. Lost: Visio Services features (shape data overlay, auto-refresh, interactive selection, zoom controls).

### ErrorWebPart
- Properties: `ErrorMessage`, `ErrorType`. No Mappings element. System error placeholder — not user content.

### AccessRequests* (3 types)
- `AccessRequestsHideOldRequestsLink`, `AccessRequestsCSRBridge`, `AccessRequestsHideOldRequestsOnLoad`
- System web parts from `/Access Requests/pendingreq.aspx`. Not user content. No migration needed.

### ListFormWebPart
- **Not in PnP XML.** Handled by modern list form infrastructure directly.
- ~75% via built-in modern forms. Lost: custom templates, InfoPath forms, JSLink. Custom: PowerApps, SPFx form customizers.
