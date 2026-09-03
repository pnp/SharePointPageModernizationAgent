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

1. **Verify the live page pair before scoring.** A score is valid only for the original classic page versus the modern page that SharePoint actually created or updated.
   - Require the original classic page URL, the destination site URL, and the authoritative modern page identity: the ID/URL returned by create, or the update input ID plus the post-update lookup URL.
   - Call `find_modern_page` using the destination site and modern page name. It must return `found: true`, a nonempty URL, and the same page ID returned by create or supplied to update (compare IDs as strings).
   - Do not infer a destination URL from a file name, reuse a URL from an earlier CIM, or accept an agent-provided ID without the live lookup.
   - If verification fails, do not call `compare_migration_quality` and do not persist a numeric `comparisonScore`. Set `migrationStatus` to `"error"` with the lookup failure and `lastAttemptAt`.
2. **Extract the verified modern page** with `extract_page_data` on the lookup URL. Require a modern page result with no extraction error. This fresh result is the only valid modern comparison input.
3. **Build cleaned classic comparison data from the original Phase 1 extraction.** Do **not** call `extract_page_data` on the live classic page; classic chrome, list-view controls, duplicate wrappers, and data-URI UI icons create false headings, links, images, and web-part counts. The extraction bundle is a normalized representation of the original source page, not the comparison target and not a prior score. Never use CIM `modernPage*`, `comparison*`, or prior assessment fields as comparison data. Instead:
   - Parse `wikiHtml` / `PublishingPageContent` for headings, links, images, and text
   - Include web part content from `webParts[].resolvedHtml` when present
   - Preserve each classic web part's `id`, `typeName`, `title`, and extracted text; include `kind: "rte"` only for a true Rich Text web part
   - Include `layout.sections[].columns` from `publishingLayout.modernMapping` or the classic zone structure so column counts and relative widths can be compared strictly
   - Exclude empty headings, `data:` images, SharePoint command-bar icons, edit/menu links, and other page chrome
   - Deduplicate web parts by source ID; when no stable ID exists, deduplicate identical title + normalized content pairs
   - Treat the underlying list URL/ID as the identity of a list web part, not its editable display title
   - Format the result to match the `extract_page_data` schema: `{headings, links, images, imageCount, linkCount, textLength, textPreview, webParts, layout, ...}`
4. **Capture both live rendered pages** with `take_page_screenshot`: the original classic URL and the verified modern lookup URL. Inspect the screenshots alongside the source extraction and fresh modern DOM data, then build a visual assessment:
   ```json
   {
     "status": "MATCH | MISMATCH | INCONCLUSIVE",
     "layoutMatches": true,
     "confirmedWebParts": ["classic web part ID or title"],
     "confirmedImages": ["classic image URL or alt text"],
     "notes": ["specific visual difference or confirmation"]
   }
   ```
   Use `confirmedWebParts` and `confirmedImages` only when the screenshot proves the content is present but an SPFx control did not expose it in the DOM.
5. Call `compare_migration_quality(classicData, modernData, visualAssessment)`. The inputs must represent the original classic page and the verified, live modern page; never compare two CIM snapshots.
   - The scorer retries an internal scoring failure twice. If the tool still returns an error, an unparseable report, or no finite `contentCoverage` score, rebuild the cleaned classic data (including normalizing optional text fields), refresh the verified modern extraction, recapture both screenshots, and retry the full comparison once.
   - If the full comparison retry fails, persist `comparisonScore: null`, `comparisonConfidence: "low"`, a `comparisonSummary` containing both attempt errors, and `comparedAt`. Keep the page's successful `migrationStatus: "migrated"`; do not report a failed comparison as a page-migration failure.
6. Review the report for content coverage score, missing headings, missing links, missing text, image dimensions, web-part fidelity, layout mapping, and visual findings. Cross-check:
   - whether missing headings became Quick Links tile labels
   - whether a knowledge file describes a higher-fidelity approach for flagged content
7. **Apply the score sanity gate before persisting the result:**
   - Normalize heading levels before matching (`h1` → `h2`, `h2` → `h3` are expected in modern pages)
   - Check meaningful text coverage using normalized `textPreview` values
   - If the reported score is below 50 while modern text coverage is at least 70%, or most non-empty classic headings are present, treat the result as a suspected extraction false negative
   - For a suspected false negative, wait for SPFx rendering, re-run `extract_page_data` on the modern page once, rebuild the cleaned classic data, recapture the modern screenshot, and call `compare_migration_quality` again
   - If the second result is still contradictory, take a screenshot and report the comparison as **inconclusive**. Do not persist a misleading numeric score such as 0; set `comparisonScore` to `null`, explain the extraction mismatch in `comparisonSummary`, and add `"comparisonConfidence": "low"` to the CIM
   - Persist `"comparisonConfidence": "high"` only when the structural score agrees with the text and heading checks
   - Never persist a score from missing screenshots, a failed live-page lookup, or an unverified modern-page extraction

### Score deductions

Start at 100 and apply only these deductions:

- 20 points for each classic web part missing from both DOM analysis and visual review
- 5 points for each non-RTE classic web part rendered as a Rich Text web part
- 10 points for each missing image or matched image with a zero width or height
- 10 points when the layout does not strictly match in DOM analysis or visual review
- 5 points for each missing heading

Link and text analysis remain diagnostic signals; they identify refinement work but do not deduct points.

### Step 2: Refine

When `migrate-site` invokes this skill immediately after a page is transformed and saved, run and persist the initial verified comparison first. Automatically enter refinement only when its finite `comparisonScore` is below 80:

- Do not automatically refine a score of 80 or higher, even if it reports non-blocking issues.
- Do not automatically refine a null or low-confidence score. Preserve it as inconclusive according to Step 1.
- Once the gate has opened, stop automatic refinement when coverage reaches 80 or when no concrete, supported remediation remains.

For a page eligible for automatic refinement:
1. Match each gap against known patterns in the knowledge files
2. Replace Rich Text substitutions with purpose-built modern web parts, restore missing or zero-sized images, and rebuild any layout whose column mapping differs
3. Reassemble the canvas with `build_canvas_layout` and update via `update_modern_page`
4. Re-run live verification and comparison, then persist the final verified CIM fields

A direct, user-requested `compare-and-refine` run may still refine a page above this threshold when the user explicitly asks for it.

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
- **SPFx web part detection limits:** `extract_page_data` reads the rendered DOM. SPFx web parts (Quick Links, Hero, Highlighted Content, and similar components) may not emit standard `<a>`, `<img>`, or heading tags. When screenshots confirm a classic web part or image is visibly present despite absent DOM metadata, record its classic ID/title or image URL/alt text in `confirmedWebParts` or `confirmedImages` so it is not scored as missing. Never use visual confirmation for zero-sized matched images or Rich Text substitutions.

---

## MCP Tool Reference

| Tool | Purpose |
|------|---------|
| `extract_page_data(pageUrl)` | Extract structural data from a **modern** page; do not use it on classic pages |
| `compare_migration_quality(classicData, modernData, visualAssessment)` | Produce the combined DOM and screenshot-based quality score and gap report |
| `take_page_screenshot(pageUrl, fullPage?, filePath?)` | Capture an authenticated screenshot |
| `get_comparison_extraction_script` | Get the JavaScript extraction script if `extract_page_data` is unavailable |
| `get_page_rendering_urls(pageUrl, renderMode)` | Get classic/modern rendering URLs for visual comparison |
| `build_text_webpart(innerHtml, sourceUrl?)` | Rebuild rich text content |
| `build_quick_links_webpart(links[], layoutId)` | Rebuild Quick Links |
| `build_image_webpart(imageUrl, altText?, captionText?, linkUrl?)` | Rebuild images |
| `build_canvas_layout(sections[])` | Reassemble the page layout with validation |
| `update_modern_page(siteUrl, pageId, canvasLayout?, title?, titleArea?, useBetaApi?)` | Apply refinements to the existing draft |
