# SharePoint Page Modernization Agent

AI-powered classic SharePoint page → modern page migration using MCP tools.

## Getting started
- **Always load the `migrate-site` skill first** at the start of any migration task, before any other skill. It is the entry-point orchestrator and routes to the phase skills (`extract-and-understand`, `transform-and-create`, `compare-and-refine`) as needed — even for a single page.
- After discovery, if matching page-understanding JSON already exists, ask once whether to reuse those CIMs and skip extraction for those pages or re-extract them.
- After a transform/save, persist the initial verified comparison. When its finite score is below 80, automatically refine the same existing modern page; do not auto-refine scores of 80 or higher, or null/low-confidence results.

## Build & Test
```bash
cd mcp-server && npm install   # first time only
cd mcp-server && npx tsc       # build TypeScript
cd mcp-server && node test/test-safelinks.cjs  # verify HTML sanitizer
```

## Architecture
- `mcp-server/` — MCP server (Node.js/TypeScript) with 17 tools
- `.claude/skills/` — 5 skills: extract-and-understand, transform-and-create, compare-and-refine, migrate-site, webpart-mapping-reference
- Auth: Playwright browser-based cookie auth + persistent browser profile at ~/.classic-to-modern/browser-profile/

## Key migration rules
- Never fabricate ULS tags or GUIDs.
- Never silently drop classic content; preserve unsupported or script-dependent content as a yellow-highlighted explanatory text fallback with modern alternatives.

## Coding Conventions
- TypeScript strict mode
- ESM imports (type: "module" in package.json)
- No fabricated ULS tags or GUIDs
- Keep Claude Code and GitHub Copilot CLI instructions in sync when changing migration behavior.