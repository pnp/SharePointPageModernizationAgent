// Isolate the Chrome launch problem
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE_DIR = join(homedir(), '.classic-to-modern', 'browser-profile-test');
mkdirSync(PROFILE_DIR, { recursive: true });

async function tryLaunch(label, opts) {
  console.error(`\n=== ${label} ===`);
  try {
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts);
    console.error('OK - context created');
    const page = await ctx.newPage();
    await page.goto('about:blank');
    console.error('OK - page opened');
    await ctx.close();
    console.error('OK - closed');
    return true;
  } catch (err) {
    console.error('FAILED:', err.message.split('\n')[0]);
    return false;
  }
}

// Edge channel
await tryLaunch('channel=msedge, headless=true', {
  channel: 'msedge',
  headless: true,
  viewport: null,
});

await tryLaunch('channel=msedge, headless=false', {
  channel: 'msedge',
  headless: false,
  viewport: null,
});

// chrome-beta / chrome-canary if available
await tryLaunch('channel=chrome-canary, headless=true', {
  channel: 'chrome-canary',
  headless: true,
  viewport: null,
});

process.exit(0);
