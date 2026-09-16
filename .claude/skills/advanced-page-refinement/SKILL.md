---
name: advanced-page-refinement
description: Refine an existing modern SharePoint page against its classic source through live comparison, targeted reconstruction, and verified in-place updates.
model: sonnet
---

# Advanced Page Refinement

Improve an existing modern SharePoint page so its content coverage, visual hierarchy, text presentation, supported functionality, and page structure are as faithful to its classic source as modern SharePoint permits.

Use this skill after an initial migration, when a user requests a visual refresh, wants missing placeholders improved, or asks for a higher-fidelity modern result. A direct request to run this skill is an explicit style-refinement request: refine every Text web part even when the structural comparison score would not otherwise open the automatic-refinement gate.

## Goals

- Preserve all source content and meaningful user-facing behavior.
- Align the modern page's visual hierarchy, layout, text presentation, images, and navigation with the source where supported.
- Visually refine every Text web part against the corresponding classic content and rendered source appearance; do not skip a Text web part because its text is structurally present or because the comparison score is already high.
- Prefer supported native modern controls over generic placeholders.
- Replace every untransformed source web part, modern web-part placeholder, and low-fidelity generic substitution with the closest supported modern equivalent, a faithful static representation, or an explicit fallback.
- Clearly preserve the intent and visible output of unsupported classic behavior without representing it as interactive or live.
- Update the existing target page only; never create a duplicate during refinement.
- Produce a verified comparison result and retain a reusable record of the refinement.

## Required Inputs

- Original classic page URL.
- Existing modern page URL or its site URL and page name.
- Existing CIM, when available. If no valid CIM exists, extract the source and create one before persisting refinement results.

## Tools and APIs

Use the local `classic-to-modern` MCP server as the primary action layer:

| Purpose | Tool/API |
|---|---|
| Resolve the authoritative target identity | `find_modern_page` |
| Extract the classic source | `extract_classic_page` |
| Inspect the live modern structure | `extract_page_data` |
| Review rendered source and target visuals | `take_page_screenshot`, `get_page_rendering_urls` |
| Discover supported control schemas | `get_modern_webpart_catalog` |
| Build supported page controls | Relevant `build_*_webpart` tools |
| Assemble the full page canvas | `build_canvas_layout` |
| Save an in-place refinement | `update_modern_page` |
| Measure content and structure coverage | `compare_migration_quality` |

Use the authenticated Playwright MCP tools when browser-level validation is needed:

| Purpose | Tool/API |
|---|---|
| Load the live target page | `browser_navigate` |
| Inspect rendered, user-visible structure | `browser_snapshot`, `browser_evaluate` |
| Capture visual evidence | `browser_take_screenshot` |
| Investigate page-rendering issues | `browser_console_messages` |

## Process

### 1. Establish Authoritative Source and Target

1. Resolve the modern page with `find_modern_page`.
2. Require a successful lookup, nonempty target URL, and stable page ID before making changes.
3. Extract the classic source and load the existing CIM when it is valid.
4. Treat the source extraction as the authoritative content record; do not rebuild source content from the current modern page.

### 2. Build a Baseline Assessment

1. Extract fresh structural data from the verified modern target.
2. Capture source and target screenshots.
3. Inspect the live browser rendering when structural extraction cannot reliably expose modern controls.
4. Identify differences in content, heading hierarchy, images, links, layout, control fidelity, rendering quality, and visible title area.
5. Separate true migration gaps from intentional modern equivalents and extractor limitations.
6. Create two working inventories before planning changes:
   - **Text web parts:** every rendered target Text web part, its source block or existing modern-only content, and the source/target visual differences in hierarchy, emphasis, alignment, colors, spacing, tables, callouts, images, and links.
   - **Web-part resolution:** every source web part and every target placeholder, generic substitution, error control, or untransformed control, its visible behavior, and its current or intended modern replacement.
7. Treat a screenshot-confirmed native/SPFx control as present even if structural extraction omits its DOM details. Treat a visible placeholder or generic web-part box as unresolved; it is not a completed conversion.

### 3. Plan the Refinement

1. Retain the source content order and the intent of every source block.
2. Use supported modern controls where they provide an appropriate functional equivalent.
3. Perform the following **required Text web-part fidelity pass** for every target Text web part:
   - Rebuild source-derived Text web parts from the original CIM/source extraction through `build_text_webpart`; never restyle a source-derived block by copying the existing modern `innerHtml`, because it cannot recover source styling that was stripped during an earlier migration.
   - For a modern-only Text web part with no classic source block, preserve its exact user-visible content and links. Apply only evidence-based, Canvas RTE-safe presentation changes; never replace it with unrelated source content.
   - Use source screenshots and markup to retain the highest-value supported presentation: semantic heading hierarchy, direct fixed-hex text colors, font sizes, font weight/style, text alignment, indentation, table borders/cell padding/backgrounds, inline image dimensions, and callouts. Preserve the source intent rather than forcing all content into a generic paragraph style.
   - Keep the page title in the modern title area rather than duplicating the classic `<h1>` in a Text web part. Convert classic callouts to one-cell tables when needed so their background, padding, and border survive Canvas RTE.
   - Limit changes to Canvas RTE-safe local styles. Do not attempt to carry over font families, CSS variables, stylesheet classes, positioning, layout CSS, scripts, pseudo-elements, animations, or other unsupported CSS.
4. Apply the following **generic Text web-part alignment patterns** whenever source evidence supports them:

   | Classic content scenario | Required modern Text web-part treatment |
   |---|---|
   | Plain paragraphs | Preserve paragraphs and meaningful bold, italic, inline-code, and link semantics. Do not flatten structured prose into generic text. |
   | Page title and body headings | Keep the page title in the modern title area. Map body hierarchy to H2/H3/H4, preserving logical nesting even when the classic source skips heading levels. |
   | Colored body headings | Preserve a source-defined fixed hex color on the corresponding body headings. When the user explicitly requests a color copied from a reference page, inspect that rendered reference first, record the exact hex value and target heading scope, and apply it only to body headings. Never infer a color from a page name, theme, or unrelated source element. |
   | Font emphasis, sizing, alignment, and indentation | Retain only meaningful Canvas RTE-safe local styles: `color`, `font-size`, `font-weight`, `font-style`, `text-align`, and modest `margin-left`. Do not preserve font families, CSS classes, variables, absolute positioning, or stylesheet-driven effects. |
   | Bulleted and numbered lists | Retain semantic `<ul>`, `<ol>`, and `<li>` structures. Preserve list order and nested-list intent. |
   | Data tables | Preserve header cells, borders, padding, text alignment, simple cell backgrounds, and `width:100%` when the source table fills its content rail. Treat data tables as content, not page-layout tables. |
   | Callouts and notices | Rebuild a callout as a one-cell table with a supported fixed background, border, padding, and optional text color. Use yellow only for an unsupported-behavior fallback; do not use it for ordinary informational content. |
   | Inline images | Preserve verified dimensions, aspect ratio, alt text, and meaningful nearby caption/link text. When image-inside-link markup does not render reliably in Canvas, render the image and a visible sibling link instead. |
   | Image tiles or icon navigation | Preserve the classic tile count per row with percentage-width table cells. Keep images and links as siblings, not image-inside-link markup; use correct source dimensions and a contrasting tile background only when source evidence requires it. |
   | Linked HTML or Content Editor content | Rebuild the resolved, meaningful visible HTML through `build_text_webpart`. Add a yellow fallback stating that the live file dependency cannot continue and naming a supported Text, List, Library, SPFx, or Power Apps alternative. |
   | Script Editor, XML/XSL, or other runtime output | Prefer a dedicated modern control when one faithfully replaces the behavior. Otherwise preserve visible output as a static Text representation and add a complete yellow fallback naming the lost runtime behavior and recommended supported replacement. |
   | Classic navigation or Table of Contents | Prefer Quick Links or another supported native navigation control. If no direct equivalent exists, retain the meaningful links in a visible static Text representation or fallback. |
   | Narrow classic content rail | Reconstruct the closest supported modern canvas layout. Retain intentionally blank columns when they are needed to preserve the visual width and alignment of the source content rail. |

   When applying a reference heading color, add it to the source-derived heading markup **before** calling `build_text_webpart`, for example:

   ```html
   <h2 style="color:#498205">Section heading</h2>
   ```

   The final target heading level may be shifted by the builder. Apply the color to every source heading that maps to the requested final H2/H3/H4 scope, but never apply it to the modern title-area H1 unless the user explicitly requests a title-area change.
5. For any Text web-part style update, rebuild and submit the **complete canvas**. Retain all validated non-Text mappings, title-area settings, blank columns, and existing modern-only content. Never use a title-area-only update for a style change: it can cause SharePoint to clear the existing canvas.
6. Resolve each untransformed web part or placeholder in this order, recording exactly one final treatment for it:
   1. Use a dedicated modern builder when it provides a supported functional equivalent, such as List, Quick Links, Image, Video, Embed, or Divider.
   2. If no dedicated builder fits, use `get_modern_webpart_catalog` to validate a known modern mapping and build it with `build_any_webpart`. Use only catalog-supported properties and verified source/destination identifiers.
   3. When a live equivalent is unavailable but the classic control has meaningful visible content, recreate that visible experience with the closest supported control: for example, Text web part content with preserved formatting and links, Quick Links for a navigation collection, inline linked images for image tiles, or a List web part for a verified equivalent destination list.
   4. Only when no supported equivalent or faithful static representation is possible, create a Canvas RTE-safe yellow Text web-part fallback. It must name the original classic control, preserve its meaningful visible content or output, state the lost runtime behavior, and identify a specific recommended modern alternative.
7. Do not leave empty placeholder controls, generic "web part" notices, unresolved error controls, or a bare Rich Text substitution when a more faithful supported control or static rendering is available.
8. Reconstruct the complete canvas when a refinement changes the page composition, layout, control ordering, or any Text web part. Preserve the source section and column placement as closely as modern SharePoint supports.
9. Do not invent identifiers, metadata, runtime behavior, or content that is absent from the source.

### 4. Apply the Update

1. Build replacement controls for the complete Text web-part inventory and every resolved web-part gap, then validate the assembled canvas.
2. Call `update_modern_page` with the verified existing page ID and the complete validated canvas.
3. Preserve a visible title region and the target title during the update.
4. Do not create a new modern page as part of refinement.

### 5. Verify the Live Result

1. Resolve the page again with `find_modern_page` and confirm the page ID is unchanged.
2. Extract fresh modern page data after the update.
3. Capture fresh screenshots of both pages.
4. Verify that the title region, source-derived content, images, restored controls, and fallbacks are visibly rendered.
5. Compare every rebuilt Text web part with its source screenshot and source block. Confirm that its rendered heading hierarchy, emphasis, alignment, supported colors and sizes, tables/callouts, inline images, and links retain the closest feasible visual appearance.
6. Verify that every item in the web-part-resolution inventory now renders as a real modern control, a faithful static representation, or a complete yellow fallback. A generic placeholder, blank/error control, or missing source web part fails verification.
7. Use Playwright inspection when an SPFx or other modern control is present visually but omitted from structural extraction.
8. Retry a transient extraction or screenshot failure once before treating verification as inconclusive.

### 6. Compare and Decide Whether to Continue

1. Build cleaned classic comparison data from the original extraction, excluding classic page chrome.
2. Run `compare_migration_quality` against the fresh, verified modern extraction and visual assessment.
3. Treat link and DOM gaps reported for visibly rendered modern controls as diagnostic evidence, not automatic proof of a lost feature.
4. Continue refining only while a concrete, supported improvement remains.
5. Stop when the result meets the requested quality level or remaining differences are inherent to unsupported classic behavior or platform limitations.

### 7. Persist the Result

Update the CIM after live verification with:

```json
{
  "migrationStatus": "migrated",
  "modernPageId": "<verified page ID>",
  "modernPageUrl": "<verified modern URL>",
  "destinationSiteUrl": "<target site URL>",
  "comparisonScore": 0,
  "comparisonConfidence": "high | low",
  "comparisonSummary": "<verified outcome and remaining limitations>",
  "comparedAt": "<ISO 8601 timestamp>",
  "textWebpartStyleRefinedAt": "<ISO 8601 timestamp>",
  "textWebpartStyleRefinementReason": "explicit-user-request"
}
```

Use `comparisonScore: null` and `comparisonConfidence: "low"` when the live target cannot be reliably extracted or compared after the documented retry process.

## Completion Criteria

A refinement is complete only when:

- The target was updated in place and its page ID remains verified.
- The title region is visibly rendered.
- Every Text web part received a visual fidelity pass, and source-derived Text web parts were rebuilt through `build_text_webpart`.
- No source web part or target placeholder remains unresolved: each has a native modern mapping, faithful static representation, or complete yellow fallback.
- Source content is preserved or an explicit fallback explains the supported limitation.
- Rebuilt content and controls are visibly rendered on the live page.
- A final comparison and visual assessment were recorded.
- The CIM contains the target identity and final refinement metadata.

## Reporting

Report the completed improvements, the Text web-part visual refinements, the replacement chosen for each previously untransformed web part or placeholder, the validation outcome, and any remaining platform limitations. Clearly distinguish unresolved unsupported behavior from missing source content.
