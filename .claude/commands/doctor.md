---
description: Health-check the SharePoint Page Migration Agent environment
allowed-tools: Bash(node:*), Bash(npm:*), Read
argument-hint: "[--verbose]"
---

You are running **doctor mode** for the SharePoint Page Migration Agent. Perform a
quick, read-only health check of the local environment and report a concise
PASS / WARN / FAIL line per item. Do **not** modify any files. Extra args: `$ARGUMENTS`.

Run the checks below (skip the deeper ones only if an earlier hard dependency
fails), then print a short summary. Use ✅ PASS, ⚠️ WARN, ❌ FAIL.

1. **Node.js** — run `node -v`. FAIL if missing or older than v20.
2. **npm** — run `npm -v`. FAIL if missing.
3. **Dependencies** — check that `mcp-server/node_modules` exists.
   Fix hint: `cd mcp-server && npm install`.
4. **Build output** — check that `mcp-server/dist` exists (the server was built).
   Fix hint: `cd mcp-server && npm run build`.
5. **.mcp.json** — confirm `.mcp.json` exists in the repo root and is valid JSON
   containing a `classic-to-modern` server entry.
6. **MCP server startup** — run `node mcp-server/test/check-server-start.cjs`.
   PASS if it exits 0 (server completes the initialize handshake and lists tools).
7. **Playwright browser launch (auth)** — run `node mcp-server/test/check-browser-launch.cjs`.
   This actually launches a browser (Chrome, falling back to Edge) and opens a
   page — the same thing the auth flow does. PASS if it exits 0 and reports the
   working channel. This is best-effort: treat a failure as ⚠️ WARN, not ❌ FAIL.
   Fix hint: install Google Chrome or Microsoft Edge.
8. **Auth profile** — check whether `~/.classic-to-modern/browser-profile` exists.
   WARN if absent (user hasn't signed in yet); this is expected on first run.

Then print:

```
doctor summary: <N> passed, <N> warnings, <N> failed
```

Followed by the single most important next action if anything failed or warned
(e.g. run setup, run `npm run build`, or sign in on first migration). Keep the
whole report under ~20 lines.
