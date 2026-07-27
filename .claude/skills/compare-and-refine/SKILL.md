---
name: compare-and-refine
description: Compare migrated modern page against the classic original using structural extraction, score quality, and refine until coverage is acceptable.
model: sonnet
---

# Phase 3: Compare & Refine

Compare the migrated modern page against the classic original using automated structural extraction, score migration quality, and iterate until coverage is acceptable.

For incremental fixes, use `update_modern_page` directly. For major rework (wrong layout, missing sections), re-run `transform-and-create`.

---

## Workflow

### Step 0: Load Knowledge Files

Read all files in `<git_repo_path>/.claude/knowledge/*.md` for known migration patterns. Use this knowledge when:
- **Diagnosing gaps** — a "missing" heading may be a valid tile conversion
- **Planning refinements** — knowledge files have specific HTML structures and sizing guidelines
- **Interpreting scores** — knowledge files may redefine what counts as a gap vs. intentional conversion

### Step 1: Compare (Structural Comparison)

**Use the automated comparison tool for objective quality assessment:**

1. **Extract the modern page:** Call `extract_page_data` on the **modern** destination page to get structural data (headings, links, images, text).

2. **Build classic page data:** Do **not** call `extract_page_data` on the live classic page. Classic page chrome, list-view controls, duplicated web-part wrappers, and data-URI UI icons produce false headings, links, images, and web-part counts. Instead, construct the classic comparison data from the `extract_classic_page` bundle you already have from Phase 1:
   - Parse `wikiHtml` / `PublishingPageContent` to extract headings, links, images, and text
   - Include web part content from `webParts[].resolvedHtml` if present
   - Exclude empty headings, `data:` images, SharePoint command-bar icons, edit/menu links, and other page chrome
   - Deduplicate web parts by source ID; when no stable ID exists, deduplicate identical title + normalized content pairs
   - Treat the underlying list URL/ID as the identity of a list web part, not its editable display title
   - Format as a JSON object matching the `extract_page_data` output schema: `{headings, links, images, imageCount, linkCount, textLength, textPreview, ...}`

3. Call `compare_migration_quality` with both JSON results (`classicData` from step 2, `modernData` from step 1).

4. Review the comparison report:
   - **Content coverage score** (0-100%) — overall migration quality
   - **Missing headings** — sections that were dropped
   - **Missing links** — navigation/CTAs that were lost
   - **Missing text** — phrases from classic not found in modern
   - **Image/web part counts** — structural element comparison
5. Cross-reference findings against knowledge files:
   - Do missing headings match a tile conversion pattern? (heading text → Quick Links tile label)
   - Are missing images decorative tile icons or actual content images?
   - Does a known knowledge file describe a higher-fidelity approach for any flagged content?

6. **Apply the score sanity gate before persisting the result:**
   - Normalize heading levels before matching (`h1` becoming `h2`, or `h2` becoming `h3`, is expected in modern pages)
   - Check meaningful text coverage using normalized `textPreview` values
   - If the reported score is below 50 while modern text coverage is at least 70%, or most non-empty classic headings are present, treat the result as a suspected extraction false negative
   - For a suspected false negative, wait for SPFx rendering, re-run `extract_page_data` on the modern page once, rebuild the cleaned classic data, and call `compare_migration_quality` again
   - If the second result is still contradictory, take a screenshot and report the comparison as **inconclusive**. Do not persist a misleading numeric score such as 0; set `comparisonScore` to `null`, explain the extraction mismatch in `comparisonSummary`, and add `"comparisonConfidence": "low"` to the CIM
   - Persist `"comparisonConfidence": "high"` only when the structural score agrees with the text and heading checks

### Step 2: Refine (Knowledge-Driven Fixes)

If coverage < 80% or issues found:

1. Match each gap against known patterns in knowledge files
2. Rebuild affected web parts using MCP tools with knowledge-informed approach
3. Reassemble canvas with `build_canvas_layout` and update via `update_modern_page`
4. Re-run comparison to verify — repeat until acceptable

### Step 3: Report

- Which content blocks were converted and how
- Which knowledge files were consulted
- Which blocks needed fallback treatment and why
- Confidence level and any manual steps needed

---

## Troubleshooting

### Classic Page Extraction

- See Step 1 above for how to handle classic pages (construct comparison data from the Phase 1 extraction bundle).

### Screenshot Failures

- `take_page_screenshot` may fail with "Execution context was destroyed" due to browser navigation or auth session timeouts.
- **Retry once** — the second attempt usually succeeds after the browser session stabilizes.
- If screenshots repeatedly fail, the browser auth session may have expired. The next API call will re-authenticate automatically.

### Cross-Tenant Asset Verification

- The automated comparison counts images by what the browser renders. Cross-tenant images that fail to load won't be counted, even if the HTML references are correct.
- Verify that `migrate_assets` was called during the transform phase and all assets uploaded successfully. If any failed, re-run `migrate_assets` for the failed items.
- After asset migration, verify that `rewrite_urls` was applied to all content — check that no source-tenant URLs remain in the modern page HTML.
- Always take a screenshot for visual verification of image rendering — automated comparison alone may miss broken images that appear as placeholders.

### SPFx Web Part Detection Limitations

- `extract_page_data` extracts content from the rendered DOM. SPFx web parts (Quick Links, Hero, Highlighted Content, etc.) render via React/JavaScript and may not produce standard `<a>`, `<img>`, or heading tags in the DOM.
- This means `compare_migration_quality` may report **0 links and 0 images** for a page that actually has all content present inside SPFx components — producing misleadingly low coverage scores.
- **When interpreting results**: If the modern page uses primarily SPFx web parts and the text titles are present (check `textPreview`), a low link/image count is likely a **false negative**, not actual content loss.
- **Always take a screenshot** for visual verification when SPFx web parts are involved — the screenshot is more reliable than structural comparison for these components.
- **Consider the text match**: If `textPreview` contains all expected titles/labels and `missingPhrases` is empty, the content is likely present even if links/images show as missing.
- A modern `webPartCount` of 0 does **not** prove that List, Quick Links, Hero, or other SPFx web parts are absent. Check their rendered labels and list-item text in `textPreview`.
- Never let classic `data:` UI icons or duplicated wrapper nodes contribute to the content-image or web-part baseline.

---

## MCP Tool Reference

### Comparison Tools

| Tool | Purpose |
|------|---------|
| `extract_page_data(pageUrl)` | Extract structural data from a **modern** page (fails on classic pages — see Troubleshooting) |
| `compare_migration_quality(classicData, modernData)` | Compare extracted data and produce a quality score and gap report |
| `take_page_screenshot(pageUrl, fullPage?, filePath?)` | Take a screenshot using authenticated Playwright browser |
| `get_comparison_extraction_script` | Get the JavaScript extraction script (fallback if extract_page_data unavailable) |
| `get_page_rendering_urls(pageUrl, renderMode)` | Get classic/modern rendering URLs for visual comparison |

### Action Layer (for refinement)

| Tool | Purpose |
|------|---------|
| `build_text_webpart(innerHtml, sourceUrl?)` | Rich text web part (use for table tiles, formatted content) |
| `build_quick_links_webpart(links[], layoutId)` | Quick Links web part |
| `build_image_webpart(imageUrl, altText?, captionText?, linkUrl?)` | Image web part |
| `build_canvas_layout(sections[])` | Assemble page layout with validation |
| `update_modern_page(siteUrl, pageId, canvasLayout?, title?, titleArea?, useBetaApi?)` | Update existing draft to fix content gaps |
