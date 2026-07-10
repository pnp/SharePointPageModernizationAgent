# SharePoint Page Migration Agent (Preview)

AI-assisted migration of **classic SharePoint pages** (wiki, web part, publishing) to **modern SharePoint pages**. An AI agent (Claude Code, GitHub Copilot, or any MCP-capable host) drives a local **Model Context Protocol (MCP) server** to do the work.

---

## Why use it

Classic pages can't be opened in the modern editor and miss out on modern features (responsive layout, modern web parts, Viva, Copilot surfaces). Microsoft already provides a deterministic [PnP page transformation](https://learn.microsoft.com/sharepoint/dev/transform/modernize-classic-pages) pipeline — if that meets your needs, **use it**.

This project is a **complementary, AI-driven** alternative. Reach for it when pages have custom HTML, script editor blocks, or layouts that need judgment calls, and you want a human-in-the-loop review per page.

| Your situation | Use |
|---|---|
| Bulk, deterministic migration; official support needed | **PnP page transformation** |
| Custom HTML / script / layouts needing judgment | **This project** |
| One-off, high-fidelity migration with per-page review | **This project** |

---

## How it works

The agent runs a local MCP server and works through four skills:

- **extract-and-understand** — reads the classic page into an internal model.
- **transform-and-create** — maps each piece to the closest modern web part and creates the modern page.
- **compare-and-refine** — opens both pages, scores how closely they match, and iterates to improve fidelity.
- **migrate-site** — runs the above across every classic page in a site.

Sign-in uses a real browser via Playwright. You authenticate once per tenant; the session is saved to `~/.classic-to-modern/browser-profile/` and reused.

---

## Prerequisites

- Node.js 20+
- An MCP-capable AI host (Claude Code, GitHub Copilot with MCP, etc.)
- A SharePoint Online tenant with permission to read classic pages and create modern pages on the target site
- Chrome / Edge installed locally (Playwright drives a real browser for auth)

---

## Setup

```bash
git clone https://github.com/pnp/SharePointPageModernizationAgent.git
cd SharePointPageModernizationAgent
```

### Option A — one-step script (recommended)

The setup script checks Node.js, installs dependencies, builds the server, runs a
smoke test, verifies the MCP server starts (a real `initialize` handshake), and
creates `.mcp.json` for you. Run it from the repo root:

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

```bash
# macOS / Linux / WSL / Git Bash
./setup.sh
```

Then skip to [How to use](#how-to-use).

### Option B — manual steps

```bash
cd mcp-server
npm install
npx tsc
```

---

## How to use

Run everything from the repo root — do **not** install the skills or tools globally.

**1. Start your host** and confirm the server is loaded with `/mcp` (look for `classic-to-modern`):

```powershell
copilot     # GitHub Copilot CLI
claude      # Claude Code
```

**2. Sign in** when prompted — the agent opens a browser via Playwright the first time it touches a page. One sign-in per tenant.

**3. Migrate a page** by describing it in plain language:

> Migrate this classic page to a modern page:
> `https://contoso.sharepoint.com/sites/Marketing/SitePages/OldHome.aspx`

The agent extracts, transforms, creates, and refines automatically, then gives you the URL of the new modern page. Some variations:

> Just extract and analyze `https://contoso.sharepoint.com/sites/HR/SitePages/Policies.aspx` — don't create the modern page yet, show me what you found.

> Migrate this page but keep any script editor content as an explanatory text note instead of trying to reproduce it.

> Redo the migration for `OldHome.aspx` and overwrite the existing modern page.

> **Publishing pages** can't host a modern page in place. Tell the agent a **destination site**:
>
> Migrate `https://contoso.sharepoint.com/sites/News/Pages/Article.aspx` and create the modern page on `https://contoso.sharepoint.com/sites/NewsModern`.

**4. Migrate a whole site** by pointing the agent at it:

> Migrate all classic pages on `https://contoso.sharepoint.com/sites/Marketing` to modern pages.

It discovers the pages, migrates them (several in parallel), and reports quality scores plus any pages needing a closer look. You can also scope or plan first:

> List the classic pages on `https://contoso.sharepoint.com/sites/Marketing` and give me a migration plan first — don't migrate anything yet.

> Migrate only the pages under the `SitePages` library on `https://contoso.sharepoint.com/sites/Marketing`.

**5. Review and refine.** Open the generated pages against the originals before publishing or deleting anything. Content that can't be perfectly reproduced is preserved as explanatory text describing what was lost and a suggested modern alternative. Ask the agent to fix anything that's off:

> Compare the modern page you just created against the classic original and tell me the fidelity score.

> The layout is off on `OldHome.aspx` — please compare and refine that page again.

> The hero image didn't come across. Re-check the classic page and fix the image web part on the modern page.

### Tips

- **Start with a single page.** Validate results on one representative page before launching a site-wide run.
- **Mind the token cost.** Migrations are AI-powered and consume model tokens. Large pages and site-wide runs can use a lot, which may incur cost depending on your plan — another reason to test on one page first.
- **Be specific with URLs** — paste the full classic page or site URL.
- **Re-run refinement** if a page isn't close enough, e.g. *"the layout is off, please compare and refine that page again."*

---

## License

Licensed under the [MIT License](LICENSE).
