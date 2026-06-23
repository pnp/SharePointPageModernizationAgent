# SharePoint Page Migration Agent (Preview version)

AI-assisted migration of **classic SharePoint pages** (wiki, web part, publishing) to **modern SharePoint pages**, driven by an AI agent (Claude Code, GitHub Copilot, or any MCP-capable host) talking to a local **Model Context Protocol (MCP) server**.

> ## Not an officially supported tool
>
> This project is provided **as-is** as an **open-source community sample**.
>
> - It is **not** an officially supported Microsoft product or feature.
> - Microsoft / PnP / SharePoint **Support will not help** with issues caused by running this tool.
> - You are solely responsible for testing it against a non-production environment first, reviewing every change it makes, and validating migration output before trusting it in production.
> - The maintainers will triage issues and PRs on a best-effort basis. There is **no SLA**.

---

## What this project does

Classic SharePoint pages cannot be opened in the modern page editor and do not benefit from modern features (responsive layout, modern web parts, Viva, Copilot surfaces, etc.). Microsoft provides a generic **page transformation** capability in PnP — see the official docs:

- [PnP Modernization — Page Transformation](https://learn.microsoft.com/sharepoint/dev/transform/modernize-classic-pages)
- [PnP PowerShell — `Invoke-PnPSiteTemplate` / page transformation cmdlets](https://pnp.github.io/powershell/)

`SPPageMigrationAgent` is a **complementary, AI-driven** approach. Instead of a fixed transformation pipeline, it uses an AI agent that:

1. **Extracts** the classic page (HTML, web parts, list data) into a Canonical Intermediate Model (CIM).
2. **Transforms** each piece into the closest modern web part, assembling a modern canvas layout.
3. **Creates** the modern page via the SharePoint REST / Graph APIs.
4. **Compares** the rendered classic and modern pages and **iteratively refines** the result until visual / structural parity is acceptable.

### When to use this vs. classic PnP page transformation

| Scenario | Recommended tool |
|---|---|
| Bulk, deterministic migration with well-defined web parts | **PnP page transformation** (PowerShell / .NET) — supported, predictable, scriptable |
| Pages with custom HTML, script editor blocks, or visual layouts that need judgment calls | **This project** — the AI agent can reason about content and pick reasonable modern equivalents |
| One-off high-fidelity migration where you want a human-in-the-loop review per page | **This project** |
| Production migration where you need an official support contract | **PnP page transformation** (not this project) |

If standard PnP transformation already meets your needs, **use that**. Reach for this project when you specifically want AI-driven decisions and a refinement loop.

---

## Architecture

```
.claude/skills/         skills (extract → transform → compare-and-refine, plus site-wide orchestration)
mcp-server/             Node.js / TypeScript MCP server exposing ~18 tools
  ├─ tools/             Extract, build web parts, create page, compare, screenshot, etc.
  ├─ webpart-builders/  Modern web part construction (text, image, quick links, video, embed, …)
  └─ canvas-converter   Converts Graph-style web-part arrays into REST canvas JSON
```

- **Auth**: Playwright browser-based cookie auth (FedAuth / rtFa) with a persistent browser profile at `~/.classic-to-modern/browser-profile/`. You sign in once per tenant; the profile is reused.
- **Hosts**: Any MCP-capable host works. Tested with **Claude Code** and **GitHub Copilot** in agent mode.

---

## Prerequisites

- Node.js 20+
- An MCP-capable AI host (e.g., Claude Code, GitHub Copilot with MCP, etc.)
- A SharePoint Online tenant with permission to read classic pages and create modern pages on the target site
- Chrome / Edge installed locally (Playwright drives a real browser for auth)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/pnp/SPPageMigrationAgent.git
cd SPPageMigrationAgent

# 2. Build the MCP server
cd mcp-server
npm install
npx tsc

# 3. Run unit tests (HTML sanitizer)
node test/test-safelinks.cjs
```

Then configure the MCP server in your host. Example for Claude Code or GitHub Copilot CLI (`.mcp.json`):

```jsonc
{
  "mcpServers": {
    "classic-to-modern": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/start.cjs"]
    },

    // OPTIONAL — only needed if Playwright MCP is not already available in your host. The visual-comparison and screenshot skills drive a browser through Playwright; if your host already provides a Playwright MCP server (e.g., bundled or installed globally), you can omit this block. Replace PLAYWRIGHT_MCP_EXTENSION_TOKEN with the token printed by the Playwright MCP browser extension on first launch — do NOT reuse the sample value below.
    "playwright": {
      "command": "cmd",
      "args": ["/c", "npx", "@playwright/mcp@latest", "--extension", "--browser", "chrome"],
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<your-extension-token-here>"
      }
    }
  }
}
```

> **Heads-up**: `.mcp.json` is parsed as strict JSON by most hosts — strip the `//` comments above before saving. Never commit real tokens; treat the Playwright extension token like any other secret.


### Run with GitHub Copilot CLI or Claude

This is a migration tool for a very specific scenario that requires user interaction. Install skills or tools globally is **NOT** recommended.

To use the agent/skills from GitHub Copilot CLI or Claude Code, go to the repo root and start CLI:

```powershell
copilot (or claude)
```

Then invoke one of the skills:

- `extract-and-understand` — pull a classic page into the CIM
- `transform-and-create` — generate the modern page
- `compare-and-refine` — score and improve fidelity interactively
- `migrate-site` — orchestrate the above across an entire site

If project skills are not auto-discovered by your Copilot CLI version, ask Copilot to read and follow the relevant `.claude/skills/<skill-name>/SKILL.md` file as the runbook.

---

## Contributing

We welcome contributions from the SharePoint community.

- **Issues**: Please file an issue describing the classic page pattern you hit, what the agent produced, and what you expected. Include the source page HTML (sanitized of any sensitive data) where possible.
- **Pull Requests**: Small, focused PRs are easiest to review. Please run `npx tsc` and the existing tests before opening a PR.
- **Coding conventions**: TypeScript strict mode, ESM imports, no fabricated ULS tags or GUIDs. See `CLAUDE.md` and `mcp-server/` for patterns already in use.
- **Triage**: Maintainers will look at issues and PRs on a best-effort cadence. Again — **no SLA**, and this is not a supported product.

For full guidelines see `CONTRIBUTING.md` (TODO) and `CODE_OF_CONDUCT.md` (TODO) once added.

### Working with GitHub Copilot / Claude Code

This repo is designed to be driven by an AI agent. If you contribute new MCP tools or skills, please:

- Test against both Claude Code and GitHub Copilot agent mode where feasible.
- Update the skill markdown files in `.claude/skills/` so other contributors' agents inherit the same context.
- Keep `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` in sync.

---

## Disclaimer

This sample is provided **without warranty of any kind**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from, out of, or in connection with the software or the use or other dealings in the software.

---

## License

Licensed under the [MIT License](LICENSE).
