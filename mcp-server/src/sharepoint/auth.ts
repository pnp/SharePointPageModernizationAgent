/**
 * Browser-based cookie auth via Playwright.
 *
 * 3-tier cookie acquisition to minimize browser popups:
 *   Tier 1: Disk cache — cookies persisted to JSON, survives server restarts
 *   Tier 2: Headless browser — silent cookie refresh via persistent profile
 *   Tier 3: Visible browser — manual login fallback (only when AAD session expired)
 *
 * Uses a Playwright persistent browser profile so AAD session cookies
 * are preserved. First run: user logs in manually. After that: zero-click.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';
import type { BrowserContext, Page } from 'playwright-core';

// ── Constants ──

const CACHE_DIR = join(homedir(), '.classic-to-modern');
const BROWSER_PROFILE_DIR = join(CACHE_DIR, 'browser-profile');
const COOKIE_CACHE_FILE = join(CACHE_DIR, 'cookie-cache.json');
const COOKIE_CACHE_TMP = join(CACHE_DIR, 'cookie-cache.json.tmp');
const BUFFER_MS = 5 * 60 * 1000; // 5-minute buffer before expiry

// ── Cookie cache ──

interface CookieEntry {
  cookieHeader: string;
  expiresAt: number; // ms timestamp
}

interface DiskCacheData {
  version: 1;
  hosts: Record<string, CookieEntry>;
}

// In-memory cache: host → cookie entry
const cookieCache = new Map<string, CookieEntry>();

// ── Disk cache ──

let diskCacheLoaded = false;

function loadDiskCache(): Map<string, CookieEntry> {
  try {
    if (!existsSync(COOKIE_CACHE_FILE)) return new Map();
    const raw = readFileSync(COOKIE_CACHE_FILE, 'utf-8');
    const data: DiskCacheData = JSON.parse(raw);
    if (data.version !== 1 || !data.hosts) return new Map();
    return new Map(Object.entries(data.hosts));
  } catch (err) {
    logger.warn('Failed to load cookie cache from disk', { error: String(err) });
    return new Map();
  }
}

function saveDiskCache(): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const data: DiskCacheData = {
      version: 1,
      hosts: Object.fromEntries(cookieCache),
    };
    writeFileSync(COOKIE_CACHE_TMP, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(COOKIE_CACHE_TMP, COOKIE_CACHE_FILE);
    logger.info('Cookie cache persisted to disk', { hosts: cookieCache.size });
  } catch (err) {
    logger.warn('Failed to persist cookie cache to disk', { error: String(err) });
  }
}

function ensureDiskCacheLoaded(): void {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  const fromDisk = loadDiskCache();
  for (const [host, entry] of fromDisk) {
    if (!cookieCache.has(host)) {
      cookieCache.set(host, entry);
    }
  }
  if (fromDisk.size > 0) {
    logger.info('Loaded cookie cache from disk', { hosts: fromDisk.size });
  }
}

// ── Singleton browser context ──

const BROWSER_CHANNELS = ['chrome', 'msedge'] as const;
type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

let browserContext: BrowserContext | null = null;
let browserIsHeaded = false;
let workingChannel: BrowserChannel | null = null; // remember which channel worked this session
let contextLock: Promise<BrowserContext> | null = null; // mutex for context creation/upgrade

/**
 * Get or create a Playwright browser context with the persistent profile.
 * Uses a promise-based lock to prevent concurrent upgrade races.
 * @param headed - true for visible browser (screenshots, manual login), false for headless (silent auth)
 */
async function getBrowserContext(headed: boolean): Promise<BrowserContext> {
  // Fast path: existing context already satisfies the request
  if (browserContext && (browserIsHeaded || !headed)) {
    return browserContext;
  }

  // If another call is already creating/upgrading, wait for it then re-check
  if (contextLock) {
    await contextLock.catch(() => {});
    if (browserContext && (browserIsHeaded || !headed)) {
      return browserContext;
    }
  }

  const doCreate = async (): Promise<BrowserContext> => {
    if (browserContext) {
      logger.info('Upgrading browser context from headless to headed');
      await browserContext.close().catch(() => {});
      browserContext = null;
    }

    const { chromium } = await import('playwright-core');
    mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

    // Try channels in order, preferring whichever worked previously this session.
    const channelsToTry: BrowserChannel[] = workingChannel
      ? [workingChannel, ...BROWSER_CHANNELS.filter(c => c !== workingChannel)]
      : [...BROWSER_CHANNELS];

    const errors: string[] = [];
    for (const channel of channelsToTry) {
      try {
        const ctx = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
          channel,
          headless: !headed,
          viewport: null,
          args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
        });
        browserContext = ctx;
        browserIsHeaded = headed;
        workingChannel = channel;
        logger.info('Browser context created', { headed, channel });
        return ctx;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${channel}: ${message.split('\n')[0]}`);
        logger.warn('Browser channel failed, trying next', { channel, error: message.split('\n')[0] });
      }
    }

    throw new Error(`Failed to launch any browser channel (${channelsToTry.join(', ')}): ${errors.join(' | ')}`);
  };

  contextLock = doCreate();
  try {
    return await contextLock;
  } finally {
    contextLock = null;
  }
}

// ── Cookie acquisition via browser ──

function extractCookieEntry(authCookies: Array<{ name: string; value: string; expires: number }>): CookieEntry {
  const cookieHeader = authCookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Use the earliest cookie expiry, or default to 30 min
  const minExpiry = authCookies
    .filter(c => c.expires > 0)
    .reduce((min, c) => Math.min(min, c.expires), Infinity);
  const expiresAt = minExpiry < Infinity
    ? minExpiry * 1000 // Playwright cookie.expires is in seconds
    : Date.now() + 30 * 60 * 1000;

  return { cookieHeader, expiresAt };
}

/**
 * Try to acquire cookies using a browser context in the given mode.
 * In headless mode, throws if a login page is detected (caller should retry headed).
 */
async function openPageWithRecovery(headed: boolean): Promise<{ ctx: BrowserContext; page: Page }> {
  let ctx = await getBrowserContext(headed);
  try {
    const page = await ctx.newPage();
    return { ctx, page };
  } catch (err) {
    if (String(err).includes('has been closed')) {
      logger.info('Browser context was closed unexpectedly, recreating');
      resetBrowserContext();
      ctx = await getBrowserContext(headed);
      const page = await ctx.newPage();
      return { ctx, page };
    }
    throw err;
  }
}

async function tryAcquireCookies(siteOrigin: string, headed: boolean): Promise<CookieEntry> {
  const { ctx, page } = await openPageWithRecovery(headed);
  const siteHost = new URL(siteOrigin).hostname;
  const isOnSiteHost = (url: string | URL): boolean => {
    try {
      return new URL(typeof url === 'string' ? url : url.toString()).hostname === siteHost;
    } catch { return false; }
  };

  try {
    const mode = headed ? 'visible' : 'headless';
    logger.info(`Navigating browser (${mode}) for cookie auth`, { siteOrigin });

    await page.goto(`${siteOrigin}/_layouts/15/authenticate.aspx`, {
      waitUntil: 'domcontentloaded',
      timeout: headed ? 120_000 : 15_000,
    });

    // Check if we landed on a login page (not back on the target SharePoint host)
    if (!isOnSiteHost(page.url())) {
      if (!headed) {
        throw new Error('Login page detected in headless mode — AAD session may have expired');
      }
      // Headed: prompt user and wait for manual login
      console.error('\n  Sign in with your Microsoft account in the browser window.');
      console.error('  The session will be saved for future runs.\n');
      await page.waitForURL(url => isOnSiteHost(url), { timeout: 300_000 });
    }

    // Extract cookies for this SharePoint host
    const cookies = await ctx.cookies(siteOrigin);
    const authCookies = cookies.filter(c =>
      c.name === 'FedAuth' || c.name === 'rtFa',
    );

    if (authCookies.length === 0) {
      throw new Error(`No FedAuth/rtFa cookies found after navigating to ${siteOrigin}. Authentication may have failed.`);
    }

    const entry = extractCookieEntry(authCookies);

    logger.info('Cookies acquired via browser', {
      mode,
      cookies: authCookies.map(c => c.name),
      expiresAt: new Date(entry.expiresAt).toISOString(),
    });

    return entry;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Acquire cookies via browser: tries headless first (Tier 2), falls back to visible (Tier 3).
 */
async function acquireCookiesViaBrowser(siteUrl: string): Promise<CookieEntry> {
  const url = new URL(siteUrl);
  const siteOrigin = `${url.protocol}//${url.host}`;

  // Tier 2: Try headless first (silent, no popup)
  try {
    return await tryAcquireCookies(siteOrigin, false);
  } catch (err) {
    logger.info('Headless cookie acquisition failed, falling back to visible browser', { error: String(err) });
  }

  // Tier 3: Visible browser (user may need to log in)
  return await tryAcquireCookies(siteOrigin, true);
}

// ── Prevent concurrent acquisitions ──

const acquireInProgress = new Map<string, Promise<string>>();

// ── Main cookie acquisition (disk cache → memory cache → browser) ──

async function acquireCookies(siteUrl: string): Promise<string> {
  const url = new URL(siteUrl);
  const host = url.hostname;

  // Tier 0: Load disk cache on first call
  ensureDiskCacheLoaded();

  // Tier 1: In-memory cache (includes entries loaded from disk)
  const cached = cookieCache.get(host);
  if (cached && cached.expiresAt - Date.now() > BUFFER_MS) {
    return cached.cookieHeader;
  }

  // Prevent concurrent acquisitions for the same host
  const inProgress = acquireInProgress.get(host);
  if (inProgress) return inProgress;

  const promise = (async () => {
    const entry = await acquireCookiesViaBrowser(siteUrl);
    cookieCache.set(host, entry);
    saveDiskCache();
    return entry.cookieHeader;
  })();

  acquireInProgress.set(host, promise);
  try {
    return await promise;
  } finally {
    acquireInProgress.delete(host);
  }
}

// ── Exported getters ──

/**
 * Acquire a Cookie header string (FedAuth + rtFa) for SharePoint REST API calls.
 */
export async function getSharePointCookies(siteUrl: string): Promise<string> {
  return acquireCookies(siteUrl);
}

/**
 * Get the authenticated Playwright BrowserContext singleton (visible/headed).
 * Used by screenshot and compare tools that need to render pages.
 * If a headless context was created by auth, it is upgraded to headed.
 */
export async function getOrCreateBrowserContext(): Promise<BrowserContext> {
  return getBrowserContext(true);
}

/**
 * Force-reset the browser context singleton. Used for recovery when the
 * browser process has died unexpectedly (e.g., crash, user closed window).
 */
export function resetBrowserContext(): void {
  const old = browserContext;
  browserContext = null;
  browserIsHeaded = false;
  old?.close().catch(() => {});
}

/**
 * Gracefully close the browser context singleton.
 * Called on process exit to prevent orphaned Chrome processes.
 */
export async function closeBrowserContext(): Promise<void> {
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
    browserIsHeaded = false;
  }
}

/**
 * Create a new page from the headed browser context, with automatic recovery
 * if the context was unexpectedly closed (browser crash, etc.).
 */
export async function createBrowserPage(): Promise<{ ctx: BrowserContext; page: Page }> {
  let ctx = await getOrCreateBrowserContext();
  try {
    const page = await ctx.newPage();
    return { ctx, page };
  } catch (err) {
    if (String(err).includes('has been closed')) {
      logger.info('Browser context was closed unexpectedly, recreating');
      resetBrowserContext();
      ctx = await getOrCreateBrowserContext();
      const page = await ctx.newPage();
      return { ctx, page };
    }
    throw err;
  }
}

/**
 * After navigating a page, detect if it landed on a login page and wait for
 * the user to complete authentication. Call after page.goto() in tools that
 * render SharePoint pages. Returns immediately if already on SharePoint.
 */
export async function waitForSharePointAuth(page: Page, intendedUrl: string, timeoutMs = 300_000): Promise<void> {
  let intendedHost: string;
  let currentHost: string;
  try {
    intendedHost = new URL(intendedUrl).hostname;
    currentHost = new URL(page.url()).hostname;
  } catch {
    return;
  }

  if (currentHost === intendedHost) return;

  logger.info('Login page detected during page rendering, waiting for authentication', { currentHost, intendedUrl });
  console.error('\n  Browser redirected to login. Sign in with your Microsoft account.');
  console.error('  The page will continue loading after authentication.\n');

  await page.waitForURL(url => {
    try {
      return new URL(url).hostname === intendedHost;
    } catch { return false; }
  }, { timeout: timeoutMs });

  // After login, re-navigate to the intended page
  await page.goto(intendedUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
}
