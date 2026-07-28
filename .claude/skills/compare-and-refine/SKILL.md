---
name: compare-and-refine
description: Compare migrated modern page against the classic original using structural extraction, score quality, and refine until coverage is acceptable.
model: sonnet
---

# Phase 3: Compare & Refine

Compare the migrated modern page against the classic original using automated structural extraction, score migration quality, and iterate until coverage is acceptable.

Use `update_modern_page` for incremental fixes. For major rework (wrong layout, missing sections), re-run `transform-and-create`.

---

## Workflow

### Step 0: Load Knowledge Files

Read all files in `<git_repo_path>/.claude/knowledge/*.md`. Use them to:
- distinguish real gaps from intentional conversions (for example, a heading that became a Quick Links tile)
- choose higher-fidelity refinements
- interpret scores when knowledge files redefine what counts as a gap

### Step 1: Compare

1. **Extract the modern page** with `extract_page_data` on the modern destination page.
2. **Build cleaned classic comparison data from the Phase 1 bundle.** Do **not** call `extract_page_data` on the live classic page; classic chrome, list-view controls, duplicate wrappers, and data-URI UI icons create false headings, links, images, and web-part counts. Instead:
   - Parse `wikiHtml` / `PublishingPageContent` for headings, links, images, and text
   - Include web part content from `webParts[].resolvedHtml` when present
   - Exclude empty headings, `data:` images, SharePoint command-bar icons, edit/menu links, and other page chrome
   - Deduplicate web parts by source ID; when no stable ID exists, deduplicate identical title + normalized content pairs
   - Treat the underlying list URL/ID as the identity of a list web part, not its editable display title
   - Format the result to match the `extract_page_data` schema: `{headings, links, images, imageCount, linkCount, textLength, textPreview, ...}`
3. Call `compare_migration_quality(classicData, modernData)`.
4. Review the report for content coverage score, missing headings, missing links, missing text, and image/web-part counts. Cross-check:
   - whether missing headings became Quick Links tile labels
   - whether missing images are decorative tile icons or actual content images
   - whether a knowledge file describes a higher-fidelity approach for flagged content
5. **Apply the score sanity gate before persisting the result:**
   - Normalize heading levels before matching (`h1` → `h2`, `h2` → `h3` are expected in modern pages)
   - Check meaningful text coverage using normalized `textPreview` values
   - If the reported score is below 50 while modern text coverage is at least 70%, or most non-empty classic headings are present, treat the result as a suspected extraction false negative
   - For a suspected false negative, wait for SPFx rendering, re-run `extract_page_data` on the modern page once, rebuild the cleaned classic data, and call `compare_migration_quality` again
   - If the second result is still contradictory, take a screenshot and report the comparison as **inconclusive**. Do not persist a misleading numeric score such as 0; set `comparisonScore` to `null`, explain the extraction mismatch in `comparisonSummary`, and add `"comparisonConfidence": "low"` to the CIM
   - Persist `"comparisonConfidence": "high"` only when the structural score agrees with the text and heading checks

### Step 2: Refine

If coverage is below 80% or issues were found:
1. Match each gap against known patterns in the knowledge files
2. Rebuild the affected web parts using the knowledge-informed approach
3. Reassemble the canvas with `build_canvas_layout` and update via `update_modern_page`
4. Re-run comparison and repeat until acceptable

### Step 3: Report

Report:
- which content blocks were converted and how
- which knowledge files were consulted
- which blocks needed fallback treatment and why
- confidence level and any manual steps still needed

---

## Troubleshooting

- **Classic page extraction:** Always build classic comparison data from the Phase 1 extraction bundle as described above; do not structurally extract the live classic page.
- **Screenshot failures:** `take_page_screenshot` may fail with `Execution context was destroyed` because of navigation or auth-session churn. Retry once; if it keeps failing, assume the auth session expired and let the next API call re-authenticate automatically.
- **Cross-tenant asset verification:** Automated comparison counts only what the browser renders. If cross-tenant images do not load, they will not be counted even if the HTML references look correct. Verify that `migrate_assets` succeeded; re-run it for any failed items. Confirm that `rewrite_urls` was applied to every content block, no source-tenant URLs remain in the modern HTML, and take a screenshot for visual verification.
- **SPFx web part detection limits:** `extract_page_data` reads the rendered DOM. SPFx web parts (Quick Links, Hero, Highlighted Content, and similar components) may not emit standard `<a>`, `<img>`, or heading tags, so `compare_migration_quality` can report **0 links and 0 images** on a page whose content is actually present. When this happens, treat low link/image counts as a likely false negative, rely on `textPreview`, take a screenshot, and remember that `webPartCount: 0` does **not** prove that List, Quick Links, Hero, or other SPFx web parts are absent. Never let classic `data:` UI icons or duplicated wrapper nodes inflate the baseline.

---

## MCP Tool Reference

| Tool | Purpose |
|------|---------|
| `extract_page_data(pageUrl)` | Extract structural data from a **modern** page; do not use it on classic pages |
| `compare_migration_quality(classicData, modernData)` | Produce the quality score and gap report |
| `take_page_screenshot(pageUrl, fullPage?, filePath?)` | Capture an authenticated screenshot |
| `get_comparison_extraction_script` | Get the JavaScript extraction script if `extract_page_data` is unavailable |
| `get_page_rendering_urls(pageUrl, renderMode)` | Get classic/modern rendering URLs for visual comparison |
| `build_text_webpart(innerHtml, sourceUrl?)` | Rebuild rich text content |
| `build_quick_links_webpart(links[], layoutId)` | Rebuild Quick Links |
| `build_image_webpart(imageUrl, altText?, captionText?, linkUrl?)` | Rebuild images |
| `build_canvas_layout(sections[])` | Reassemble the page layout with validation |
| `update_modern_page(siteUrl, pageId, canvasLayout?, title?, titleArea?, useBetaApi?)` | Apply refinements to the existing draft |
