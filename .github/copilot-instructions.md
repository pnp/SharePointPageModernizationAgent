# GitHub Copilot instructions for SPPageMigrationAgent

Use this repository as an MCP-powered SharePoint classic-to-modern page migration agent.

Read `AGENTS.md` first for build commands, architecture, and migration invariants. The detailed migration runbooks live in `.claude/skills/*/SKILL.md`; they are intentionally shared with Claude Code and can be followed directly from GitHub Copilot CLI.

## Operating guidance

- **Always load the `migrate-site` skill first** at the start of any migration task, before any other skill. It is the entry-point orchestrator and routes to the phase skills as needed, even for a single page.
- Prefer the local `classic-to-modern` MCP server configured in `.mcp.json`.
- Use `migrate-site` for site-wide migrations, or the phase skills in order for a single page: `extract-and-understand`, `transform-and-create`, `compare-and-refine`.
- Be autonomous during migrations. Ask only for true blockers such as an unknown destination site for publishing-site migrations where the Site Pages feature is not activated, or an authentication failure that cannot be retried.
- Preserve all user content. If a classic artifact cannot run in modern SharePoint, create a clear text fallback describing the lost behavior and recommended modern alternative.

## Validation

Before considering code changes complete, run:

```powershell
Set-Location mcp-server
npm run build
node test/test-safelinks.cjs
```

Use `npm test` when changes affect TypeScript logic covered by Vitest tests.
