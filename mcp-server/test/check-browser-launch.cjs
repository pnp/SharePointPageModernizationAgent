/**
 * Playwright browser-launch check for doctor mode.
 *
 * Validates that Playwright can actually DRIVE a browser (not just that Chrome
 * or Edge is installed) by launching a persistent context, opening a page, and
 * navigating to about:blank — the same operations the SharePoint auth flow
 * performs. Tries the same channels, in the same order, as
 * src/sharepoint/auth.ts (chrome, then msedge).
 *
 * Uses a throwaway temp profile so it never touches the real auth profile at
 * ~/.classic-to-modern/browser-profile. Exits 0 and prints the working channel
 * if any browser launches; exits 1 with the per-channel errors otherwise.
 *
 * Requires the project's dependencies to be installed (playwright-core).
 */
'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Channels tried by the real auth flow (src/sharepoint/auth.ts BROWSER_CHANNELS).
const BROWSER_CHANNELS = ['chrome', 'msedge'];
const TIMEOUT_MS = 30000;

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (err) {
  console.error('playwright-core is not installed. Run: cd mcp-server && npm install');
  process.exit(1);
}

const profileDir = mkdtempSync(path.join(tmpdir(), 'c2m-doctor-'));

function cleanup() {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const timer = setTimeout(() => {
  console.error(`Browser launch check timed out after ${TIMEOUT_MS / 1000}s.`);
  cleanup();
  process.exit(1);
}, TIMEOUT_MS);

async function tryChannel(channel) {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel,
      headless: true,
      viewport: null,
    });
    const page = await ctx.newPage();
    await page.goto('about:blank');
    return true;
  } finally {
    if (ctx) { try { await ctx.close(); } catch { /* ignore */ } }
  }
}

(async () => {
  const errors = [];
  for (const channel of BROWSER_CHANNELS) {
    try {
      await tryChannel(channel);
      clearTimeout(timer);
      cleanup();
      console.log(`Playwright launched and opened a page OK (channel="${channel}").`);
      process.exit(0);
    } catch (err) {
      const message = (err && err.message ? err.message : String(err)).split('\n')[0];
      errors.push(`${channel}: ${message}`);
    }
  }

  clearTimeout(timer);
  cleanup();
  console.error(
    `Playwright could not launch any browser channel (${BROWSER_CHANNELS.join(', ')}).`,
  );
  for (const e of errors) console.error('  - ' + e);
  console.error('Fix: install Google Chrome or Microsoft Edge.');
  process.exit(1);
})();
