---
name: migrate-site
description: Orchestrate bulk classic-to-modern SharePoint page migration for an entire site. Supports plan, migrate, and refine modes.
model: opus
---

# Site Migration

Orchestrate end-to-end migration of all classic pages in a SharePoint site to modern pages. This skill discovers pages, extracts CIMs, migrates each page in parallel (up to 5 at a time), scores quality, and produces a final summary with refinement recommendations.

**Be fully autonomous.** Do not ask the user questions during migration unless there is an actual blocker (e.g., destination site URL is unknown for a publishing site). Make reasonable decisions and keep moving.

---

## Hard Rule: Always Dispatch Subagents

**Every `extract-and-understand` and `transform-and-create` invocation run inside a dispatched subagent (`Agent` tool), one subagent per page.

## Workflow

### Phase 1: Plan — Discover & Extract All Pages

1. **Discover pages** — Call `list_site_pages` with the source site URL
   - Use `library: "both"` to find pages in both SitePages and Pages libraries
   - Use `includeModernPages: false` to skip pages that are already modern
   - Present the page list to the user as a summary table (name, type, library)

2. **Determine destination site** — For publishing sites (which cannot host modern pages), the user must have specified a destination site URL. For other sites, the destination is the same site. If the destination is unknown and the source is a publishing site, this is the **one case** where you should ask the user.

3. **Extract each page** — For each classic page found:
   - Invoke the `extract-and-understand` skill for that page
   - **Important:** Extract and save the CIM only — do NOT auto-handoff to `transform-and-create`
   - The `extract-and-understand` skill saves a CIM JSON file at `pageunderstanding/<sitename>/<pagename>.json`

4. **Mark CIMs as planned** — After each successful extraction, update the CIM JSON file:
   - Add `"migrationStatus": "planned"` at the top level
   - Add `"plannedAt": "<ISO timestamp>"` at the top level
   - If extraction fails, set `"migrationStatus": "error"`, `"error": "<message>"`, `"lastAttemptAt": "<ISO timestamp>"` and continue with the next page

5. **Report plan summary** — Display:
   - Total pages found vs. successfully extracted
   - Any pages that failed extraction (with error details)
   - Then proceed to Phase 2 after a user consent prompt ("Proceed to migrate the planned pages?")

### Phase 2: Migrate & Score — Parallel Page Migration

Process all planned pages by spawning parallel tasks (up to 5 concurrent). Each task handles one page end-to-end: transform → create → compare → score.

#### Per-Page Task

Each spawned task does the following for a single page:

1. **Invoke `transform-and-create`** — Reads the CIM file and creates the modern page
   - Do NOT ask the user any questions — make autonomous decisions on layout, web part choices, page naming
   - If a page with the same name already exists, update it (do not prompt)

2. **Update CIM on success** — After the modern page is created:
   - `"migrationStatus": "migrated"`
   - `"migratedAt": "<ISO timestamp>"`
   - `"modernPageId": "<page ID from Graph API>"`
   - `"modernPageUrl": "<page web URL>"`
   - `"destinationSiteUrl": "<destination site URL>"`

3. **Invoke `compare-and-refine`** — Compare only, do NOT refine
   - Run the structural comparison (extraction script on classic page, extraction script on modern page, then `compare_migration_quality`)
   - Record the comparison score but do NOT iterate or fix issues
   - Update the CIM with:
     - `"comparisonScore": <0-100 number>`
     - `"comparisonSummary": "<brief text: what's missing>"`
     - `"comparedAt": "<ISO timestamp>"`

4. **On failure** — If any step fails:
   - `"migrationStatus": "error"`
   - `"error": "<error message>"`
   - `"lastAttemptAt": "<ISO timestamp>"`
   - The task ends — failure does not affect other tasks

#### Parallelism

- Use the Task tool to spawn up to **5 concurrent tasks** at a time
- When a task completes, spawn the next pending page's task (maintain up to 5 in flight)
- Wait for all tasks to complete before proceeding to Phase 3
- A Phase 1 task is usually expected to take 1-2 minutes, a phase 2 task is usually expected to take less than 5 minutes depending on page complexity. If a Phase 1 task takes longer than 5 minutes or a Phase 2 task takes longer than 10 minutes, check it proactively for issues.

### Phase 3: Summary Report

After all pages have been processed, call `get_comparison_summary` with the page-understanding site directory path to retrieve all comparison scores and summaries in a single lightweight call. Then produce the report:

#### Migration Summary Table

| Page | Type | Status | Score | Issues |
|------|------|--------|-------|--------|
| page1.aspx | wiki | migrated | 92% | — |
| page2.aspx | publishing | migrated | 65% | Missing 3 links, 1 image |
| page3.aspx | webpart | error | — | Auth timeout |

#### Statistics

- Total pages discovered
- Pages successfully migrated
- Pages with errors
- Average comparison score

#### Refinement Recommendations

For each migrated page with a comparison score below 95%, or with notable missing content:

- **Page name** — score, what's missing, and a recommendation

---

## CIM Status Fields

These fields are added to the top level of each CIM JSON file to track migration progress:

| Field | Type | Description |
|-------|------|-------------|
| `migrationStatus` | `"planned" \| "migrated" \| "error"` | Current status of the page migration |
| `plannedAt` | ISO 8601 string | When the CIM was created/planned |
| `migratedAt` | ISO 8601 string | When the modern page was created |
| `modernPageId` | string | Graph API page ID of the modern page |
| `modernPageUrl` | string | Web URL of the modern page |
| `destinationSiteUrl` | string | Site URL where the modern page was created |
| `comparisonScore` | number (0–100) | Content coverage score from structural comparison |
| `comparisonSummary` | string | Brief summary of comparison findings |
| `comparedAt` | ISO 8601 string | When the comparison was performed |
| `error` | string | Error message from the last failed attempt |
| `lastAttemptAt` | ISO 8601 string | When the last failed attempt occurred |

---

## Autonomy Rules

During the entire migration, do NOT ask the user about:

- Layout choices — use the CIM's `modernMapping` or best-match layout
- Which web part type to use — follow classification rules
- Whether to skip empty/placeholder web parts — skip automatically
- Page naming — use same name for cross-site, `-migrated` suffix for same-site
- Page conflicts — update existing pages automatically
- Whether to proceed after planning — just proceed

**Only ask when truly blocked:**

- Destination site URL is unknown for a publishing site migration
- Authentication failure that cannot be retried

---

## Example

```
User: "Migrate https://contoso.sharepoint.com/sites/pub1 to https://contoso.sharepoint.com/sites/pub1-modern"

Phase 1 — Plan:
  list_site_pages → found 8 classic pages
  extract-and-understand × 8 → 8 CIMs saved as "planned"

Phase 2 — Migrate & Score (5 parallel):
  [task 1] pubSample1 → transform → create → compare → score: 91%
  [task 2] pubSample2 → transform → create → compare → score: 78%
  [task 3] pubSample3 → transform → create → compare → score: 85%
  [task 4] pubSample4 → transform → create → error: "timeout"
  [task 5] pubSample5 → transform → create → compare → score: 44%
  ... (tasks 6-8 start as slots free up)

Phase 3 — Summary:
  7/8 migrated, 1 error
  Average score: 76%
  Recommendations:
    - pubSample2 (78%): Run compare-and-refine — missing 2 navigation links
    - pubSample4: Retry migration — failed due to timeout
    - pubSample5 (44%): Run compare-and-refine — missing hero banner and 5 links
```

---

## MCP Tool Reference

| Tool | Purpose |
|------|---------|
| `list_site_pages(siteUrl, library?, includeModernPages?)` | Discover all pages in a site |
| `extract_classic_page(siteUrl, pageName)` | Extract a single classic page (used via extract-and-understand skill) |
| `find_modern_page(siteUrl, pageName)` | Check if a modern page already exists |
| `get_comparison_summary(directory)` | Load all comparison scores/summaries from a page-understanding directory |

### Skills Invoked

Each sub-agent should load **only its own skill** — skills are self-contained and do not need to reference each other.

| Skill | Phase | Where it runs | Notes |
|-------|-------|---------------|-------|
| `extract-and-understand` | Phase 1 | Inside a per-page subagent | Extract + CIM only, no handoff to transform |
| `transform-and-create` | Phase 2 | Inside a per-page subagent | Reads CIM, creates modern page |
| `compare-and-refine` | Phase 2 | Inside the SAME per-page subagent (after transform) | Compare only (no refinement), produces score |
