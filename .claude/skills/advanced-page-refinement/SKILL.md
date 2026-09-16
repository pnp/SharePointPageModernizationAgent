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
4. Resolve each untransformed web part or placeholder in this order, recording exactly one final treatment for it:
   1. Use a dedicated modern builder when it provides a supported functional equivalent, such as List, Quick Links, Image, Video, Embed, or Divider.
   2. If no dedicated builder fits, use `get_modern_webpart_catalog` to validate a known modern mapping and build it with `build_any_webpart`. Use only catalog-supported properties and verified source/destination identifiers.
   3. When a live equivalent is unavailable but the classic control has meaningful visible content, recreate that visible experience with the closest supported control: for example, Text web part content with preserved formatting and links, Quick Links for a navigation collection, inline linked images for image tiles, or a List web part for a verified equivalent destination list.
   4. Only when no supported equivalent or faithful static representation is possible, create a Canvas RTE-safe yellow Text web-part fallback. It must name the original classic control, preserve its meaningful visible content or output, state the lost runtime behavior, and identify a specific recommended modern alternative.
5. Do not leave empty placeholder controls, generic "web part" notices, unresolved error controls, or a bare Rich Text substitution when a more faithful supported control or static rendering is available.
6. Reconstruct the complete canvas when a refinement changes the page composition, layout, control ordering, or any Text web part. Preserve the source section and column placement as closely as modern SharePoint supports.
7. Do not invent identifiers, metadata, runtime behavior, or content that is absent from the source.

### 4. Apply the Update

1. Build replacement controls for the complete Text web-part inventory and every resolved web-part gap, then validate the assembled canvas.
2. Call `update_modern_page` with the verified existing page ID.
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
