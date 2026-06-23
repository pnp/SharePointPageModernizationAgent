# SharePoint Page Modernization Agent

AI-powered classic SharePoint page to modern SharePoint page migration using MCP tools.

## Build and test

```powershell
Set-Location mcp-server
npm install
npm run build
node test/test-safelinks.cjs
```

## Architecture

- `mcp-server/` exposes the local `classic-to-modern` MCP server.
- `.claude/skills/` contains the migration playbooks used by Claude Code and GitHub Copilot CLI skills.
- `pageunderstanding/` stores generated CIM JSON files for extracted pages.
- Authentication uses Playwright browser cookies with a persistent browser profile at `~/.classic-to-modern/browser-profile/`.

## GitHub Copilot CLI workflow

1. Start Copilot CLI from the repository root with `copilot`.
2. Use `/mcp` to confirm the `classic-to-modern` MCP server from `.mcp.json` is loaded.
3. Use `/skills` to confirm the project skills are available.
4. For a single page, invoke the workflow in order: `extract-and-understand`, `transform-and-create`, then `compare-and-refine`.
5. For a site-wide migration, invoke `migrate-site` with the source site URL and, when needed, a destination site URL.

If the host does not automatically load project skills, read the corresponding `.claude/skills/<skill-name>/SKILL.md` file and follow it as the runbook.

## Key migration rules
- Never fabricate ULS tags or GUIDs.
- Never silently drop classic content; preserve unsupported or script-dependent content as explanatory text with modern alternatives.

## Coding conventions

- TypeScript strict mode.
- ESM imports (`"type": "module"` in `mcp-server/package.json`).
- Use the existing MCP tools and web part builders before adding new helpers.
- Keep Claude Code and GitHub Copilot CLI instructions in sync when changing migration behavior.
