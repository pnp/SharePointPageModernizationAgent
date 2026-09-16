---
name: migrate-site
description: Orchestrate bulk classic-to-modern SharePoint page migration for an entire site. Supports plan, migrate, and refine modes.
model: sonnet
---

# Site Migration

Orchestrate end-to-end migration of all classic pages in a SharePoint site to modern pages. This skill discovers pages, extracts CIMs, migrates each page in parallel (up to 5 at a time), scores quality, and produces a final summary with refinement recommendations.

**Be fully autonomous.** Ask once after discovery when valid existing CIMs require a reuse decision. Otherwise, do not ask questions unless there is an actual blocker (for example, the destination site URL is unknown for a publishing site that does **not** have the Site Pages feature activated).

---

## Hard Rule: Always Dispatch Subagents

Every `extract-and-understand` and `transform-and-create` invocation must run inside a dispatched subagent (`Agent` tool), with one subagent per page.

### Model selection when dispatching subagents

Subagents do **not** inherit the orchestrator's model, so specify it explicitly for every per-page task:
- Prefer an available Claude Haiku or `gpt-5.6-luna` task model with `reasoning_effort: "high"`.
- If neither is available, use an available fast/economic model with `reasoning_effort: "high"` (for example, `gpt-5-mini`).

---

## Workflow

### Phase 1: Plan — Discover & Extract All Pages

1. **Discover pages** with `list_site_pages(sourceSiteUrl)`:
   - use `library: "both"` to include both Site Pages and Pages
   - use `includeModernPages: false` to skip already-modern pages
   - present the page list as a summary table (name, type, library)
2. **Determine the destination site.** Same-site migration is preferred when possible, including publishing sites whose source site already has the **Site Pages** feature activated.
   - Treat `list_site_pages(..., library: "both")` as page discovery only. A response with `SitePages.count: 0` means that no matching pages were returned; it does **not** mean that the Site Pages library is absent.
   - For every publishing-site migration, call `resolve_list_info(sourceSiteUrl, "Site Pages")` before deciding that a separate destination is required. This is the authoritative Site Pages availability check.
   - If `resolve_list_info` succeeds, use the **same site** as the destination, even when page discovery returned zero Site Pages.
   - Ask for a separate destination site URL only when `resolve_list_info` confirms that Site Pages is unavailable, or cannot resolve it after its documented retries.
3. **Check for existing page-understanding JSON before dispatching extraction tasks.** For each discovered page:
   - derive `pageunderstanding/<sitename>/<page-name-without-aspx>.json`
   - treat a file as reusable only if it is valid JSON with `schemaVersion`, `source`, and `content`, and `source.siteUrl` / `source.pageName` match the discovered page
   - automatically reject invalid, unreadable, or source-mismatched files and report why they were rejected
   - if any reusable CIMs exist, present a table with page name, `extractedAt`, and `migrationStatus`, then ask the user **once** how to handle them:
     1. **Reuse all existing CIMs and skip page understanding (recommended)**
     2. **Re-extract all pages that already have CIMs**
     3. **Choose which existing CIMs to reuse**
   - if the user chooses individual pages, ask one follow-up question for the page names; reuse only those and re-extract the rest
   - if no reusable CIMs exist, do not ask anything and continue
4. **Extract only pages that are not being reused.** For each classic page without a reusable/selected CIM:
   - invoke `extract-and-understand`
   - `extract_classic_page` retries a failed extraction two times before returning an error (three total attempts); invoke it once and set the CIM status to `"error"` only after the tool exhausts its retries
   - extract and save the CIM only; do **not** auto-handoff to `transform-and-create`
5. **Mark CIMs as planned.** After each successful extraction, and for each existing CIM selected for reuse, update the file with:
   - `"migrationStatus": "planned"`
   - `"plannedAt": "<ISO timestamp>"`
   - reuse skips only `extract-and-understand`; the page still goes through transform, create/update, and comparison
   - if extraction fails, set `"migrationStatus": "error"`, `"error": "<message>"`, and `"lastAttemptAt": "<ISO timestamp>"`, then continue
6. **Report the plan summary** with totals, reused vs freshly extracted CIMs, and any extraction failures, then proceed directly to Phase 2.

### Phase 2: Migrate & Score — Parallel Page Migration

Process all planned pages in parallel, up to **5 concurrent tasks**. Each task handles one page end-to-end.

#### Per-page task

1. **Invoke `transform-and-create`.** Read the CIM and create or update the modern page. Do not ask the user about layout, web part choices, or page naming.
   - `create_modern_page` retries a failed `SavePage` operation two times before reporting failure; invoke it once and do not repeat the create request after an ambiguous response
   - Every source-derived HTML block must be rebuilt through `build_text_webpart` during this initial transform so that the current Canvas RTE-safe style transformation is applied before the first save. This is migration behavior, not score-gated refinement behavior.
2. **Verify the newly created or updated modern page before recording success.**
   - For a create, retain the page ID and URL returned by the operation. For an update, retain the page ID supplied to the operation and use the post-update lookup URL. Never invent them or derive them from the intended file name.
   - Call `find_modern_page(destinationSiteUrl, targetPageName)`. It must return `found: true`, a nonempty URL, and a page ID equal to the create result or update input (compare IDs as strings).
   - Call `extract_page_data` on the verified lookup URL after rendering. It must return a modern page without an extraction error.
   - Capture a screenshot and verify that the page title is visibly rendered in its title region. A matching document title or a body heading alone is insufficient.
   - If any verification step fails, set `migrationStatus` to `"error"` with the exact failure and `lastAttemptAt`; do not invoke comparison and do not persist migration or score fields.
3. **Update the CIM only after live-page verification** with:
   - `"migrationStatus": "migrated"`
   - `"migratedAt": "<ISO timestamp>"`
   - `"modernPageId": "<page ID from Graph API>"`
   - `"modernPageUrl": "<page web URL>"`
   - `"destinationSiteUrl": "<destination site URL>"`
4. **Invoke `compare-and-refine` in compare-only mode.**
   - score the original classic page against the verified, newly created modern page--never one CIM against another CIM and never a CIM against a guessed destination URL
   - build cleaned classic comparison data from the original Phase 1 extraction bundle; do **not** structurally extract the live classic page
   - use the fresh verified modern-page extraction, capture screenshots of the live classic and verified modern pages, run `compare_migration_quality` with its screenshot-based visual assessment, and apply the `compare-and-refine` score sanity gate
   - if comparison/scoring returns an error, an unparseable report, or no finite score after its internal retries, rebuild normalized classic data, refresh the verified modern extraction and both screenshots, then retry the complete comparison once
   - if a score below 50 conflicts with strong text or heading coverage, re-extract once before deciding
   - if the comparison retry fails or the comparison remains contradictory, record `comparisonScore: null` and `comparisonConfidence: "low"` with an inconclusive summary instead of a misleading zero; retain `migrationStatus: "migrated"` when live-page verification succeeded
   - persist the initial result to the CIM with `comparisonScore`, `comparisonConfidence`, `comparisonSummary`, and `comparedAt`
   - **Automatic refinement gate:** when the persisted initial `comparisonScore` is finite and below `80`, immediately invoke `compare-and-refine` in refinement mode inside the same per-page task. Do not ask the user to approve this follow-up.
     - Refine the existing verified page only. Use its authoritative page ID with `update_modern_page`; never create a duplicate page.
     - Preserve all source content. Unsupported or script-dependent behavior must remain a yellow-highlighted explanatory fallback with a supported modern alternative.
     - After every update, repeat live lookup, modern extraction, screenshots, and comparison before persisting the new result.
     - Continue while the score remains below `80` and the report identifies a concrete, supported remediation. Stop when the score reaches `80` or above, or when no further supported remediation can improve the result. Persist the final verified comparison fields to the CIM.
   - Do not automatically refine a score of `80` or higher. A null or low-confidence score remains inconclusive and must not trigger automatic refinement.
   - Do not trigger automatic refinement solely to apply Text web-part styles: visual styles are not a comparison-scored dimension. When a user explicitly requests a style refresh for existing migrated pages, route the request to `transform-and-create` in update mode. It rebuilds all source-derived Text web parts from the CIM with the current `build_text_webpart` transformation, retains non-Text mappings, updates the verified existing page ID, and persists the explicit-restyle fields documented in `compare-and-refine`.
5. **On failure,** set `"migrationStatus": "error"`, `"error": "<error message>"`, and `"lastAttemptAt": "<ISO timestamp>"`. The failed page stops; other pages continue.

#### Parallelism

- Use the Task tool to keep up to **5** page tasks in flight
- Set the model explicitly for every dispatched task as described above
- Start the next pending page whenever a slot frees up
- Wait for all tasks before Phase 3
- A Phase 1 task normally takes 1–2 minutes and a Phase 2 task usually takes under 5 minutes; if Phase 1 exceeds 5 minutes or Phase 2 exceeds 10 minutes, check it proactively

### Phase 3: Summary Report

After all pages finish, call `get_comparison_summary` with the page-understanding site directory path, then report:
- a migration summary table with page, type, status, score, and issues
- totals for discovered pages, successfully migrated pages, pages with errors, and the average comparison score
- refinement recommendations for every migrated page below 95% or with notable missing content

---

## CIM Status Fields

Add or maintain these top-level fields in each CIM JSON file:

| Field | Type | Description |
|-------|------|-------------|
| `migrationStatus` | `"planned" \| "migrated" \| "error"` | Current migration state |
| `plannedAt` | ISO 8601 string | When the CIM was created/planned |
| `migratedAt` | ISO 8601 string | When the modern page was created |
| `modernPageId` | string | Graph API page ID |
| `modernPageUrl` | string | Modern page web URL |
| `destinationSiteUrl` | string | Site URL where the modern page was created |
| `comparisonScore` | number (0–100) or `null` | Structural comparison score |
| `comparisonConfidence` | `"high" \| "low"` | Confidence in the comparison result |
| `comparisonSummary` | string | Brief summary of comparison findings |
| `comparedAt` | ISO 8601 string | When comparison ran |
| `textWebpartStyleRefinedAt` | ISO 8601 string | When an explicit Text web-part style refresh was verified |
| `textWebpartStyleRefinementReason` | `"explicit-user-request"` | Why the style refresh bypassed score-gated automatic refinement |
| `error` | string | Error from the last failed attempt |
| `lastAttemptAt` | ISO 8601 string | When the last failed attempt occurred |

---

## Autonomy Rules

Do **not** ask the user about:
- layout choices
- which web part type to use
- whether to skip empty/placeholder web parts
- page naming (`same name` cross-site, `-migrated` same-site)
- page conflicts (update existing pages automatically)
- whether to proceed after planning

Only these confirmations are allowed:
- the destination site URL is unknown for a publishing site migration where the Site Pages feature is not activated
- an authentication failure cannot be retried
- the single grouped decision about reusing valid existing page-understanding JSON files from Phase 1 Step 3

---

## MCP Tool Reference

| Tool | Purpose |
|------|---------|
| `list_site_pages(siteUrl, library?, includeModernPages?)` | Discover all pages in a site |
| `extract_classic_page(siteUrl, pageName)` | Extract a single classic page (used via `extract-and-understand`) |
| `find_modern_page(siteUrl, pageName)` | Check whether a modern page already exists |
| `get_comparison_summary(directory)` | Load all comparison scores and summaries from a page-understanding directory |

### Skills Invoked

Each subagent should load **only its own skill**.

| Skill | Phase | Where it runs | Notes |
|-------|-------|---------------|-------|
| `extract-and-understand` | Phase 1 | Inside a per-page subagent | Extract + CIM only, no handoff to transform |
| `transform-and-create` | Phase 2 | Inside a per-page subagent | Reads CIM, creates modern page |
| `compare-and-refine` | Phase 2 | Inside the **same** per-page subagent after transform | Compare first; automatically refine only when the initial verified score is below 80. Explicit user-requested Text web-part restyling bypasses the score gate and re-runs transform in update mode. |
