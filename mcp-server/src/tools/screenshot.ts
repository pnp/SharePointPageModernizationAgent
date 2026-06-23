import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { getSharePointCookies, createBrowserPage, waitForSharePointAuth } from '../sharepoint/auth.js';
import { logger } from '../utils/logger.js';

export function registerScreenshotTool(server: McpServer): void {
  server.tool(
    'get_page_rendering_urls',
    'Get classic and modern rendering URLs for a SharePoint page, with instructions for the calling agent to take screenshots using its own browser automation tools.',
    {
      pageUrl: z.string().describe('Full URL of the SharePoint page'),
      renderMode: z.enum(['classic', 'modern']).default('classic').describe('Which rendering mode to highlight'),
    },
    async ({ pageUrl }) => {
      const base = pageUrl.split('?')[0];
      const result = {
        instructions: 'Use your browser automation tools to screenshot this page.',
        classicUrl: `${base}?UserPage_RenderAsModern=0`,
        modernUrl: `${base}?UserPage_RenderAsModern=1`,
        suggestedActions: [
          'Navigate to classicUrl to see the classic rendering',
          'Navigate to modernUrl to see the safe-mode modern rendering',
          'Take full-page screenshots of both for comparison',
        ],
        notes: 'The UserPage_RenderAsModern query parameter controls rendering: 0=classic, 1=modern safe render',
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'take_page_screenshot',
    'Take a screenshot of a SharePoint page using the authenticated Playwright browser. Returns the screenshot as a base64-encoded image.',
    {
      pageUrl: z.string().describe('Full URL of the SharePoint page to screenshot'),
      fullPage: z.boolean().default(true).describe('Take a full-page screenshot (true) or viewport only (false)'),
      filePath: z.string().optional().describe('Optional file path to save the screenshot PNG to'),
    },
    async ({ pageUrl, fullPage, filePath }) => {
      try {
        // Ensure cookies are fresh for this site
        const url = new URL(pageUrl);
        const siteOrigin = `${url.protocol}//${url.host}`;
        await getSharePointCookies(siteOrigin);

        const { page } = await createBrowserPage();
        await page.setViewportSize({ width: 1920, height: 1080 });

        try {
          logger.info('Navigating for screenshot', { pageUrl });
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });

          // Detect if we landed on a login page and wait for auth
          await waitForSharePointAuth(page, pageUrl);

          // Wait for content: classic (#s4-workspace) or modern (pageContent)
          await Promise.race([
            page.waitForSelector('#s4-workspace', { timeout: 10_000 }),
            page.waitForSelector('[data-automation-id="pageContent"]', { timeout: 10_000 }),
            page.waitForTimeout(10_000),
          ]).catch(() => {});

          // Scroll through page to trigger lazy-loaded images
          await page.evaluate(async () => {
            const s4 = document.getElementById('s4-workspace');
            const candidates = !s4 ? Array.from(document.querySelectorAll('*')).filter(el => {
              const st = getComputedStyle(el);
              return el.scrollHeight > el.clientHeight + 50 &&
                     (st.overflowY === 'scroll' || st.overflowY === 'auto') &&
                     el.clientHeight > 200;
            }) : [];
            const container = s4 || candidates.reduce<Element | null>((b, el) =>
              el.scrollHeight > (b ? b.scrollHeight : 0) ? el : b, null) || document.documentElement;
            const step = container.clientHeight * 2;
            for (let pos = 0; pos < container.scrollHeight; pos += step) {
              container.scrollTop = pos;
              await new Promise(r => setTimeout(r, 150));
            }
            container.scrollTop = 0;
          });
          await page.waitForTimeout(2000);

          // Expand inner scroll container AND ancestors for full-page capture.
          // SharePoint pages scroll inside #s4-workspace (classic) or a dynamic div (modern),
          // not the document body. fullPage:true only captures document height, so we must
          // expand the container and every ancestor that clips overflow.
          if (fullPage) {
            await page.evaluate(() => {
              const s4 = document.getElementById('s4-workspace');
              const candidates = !s4 ? Array.from(document.querySelectorAll('*')).filter(el => {
                const st = getComputedStyle(el);
                return el.scrollHeight > el.clientHeight + 50 &&
                       (st.overflowY === 'scroll' || st.overflowY === 'auto') &&
                       el.clientHeight > 200;
              }) : [];
              const container = s4 || candidates.reduce<Element | null>((b, el) =>
                el.scrollHeight > (b ? b.scrollHeight : 0) ? el : b, null);
              if (!container || !(container instanceof HTMLElement)) return;

              type SavedStyle = { el: HTMLElement; height: string; maxHeight: string; width: string; maxWidth: string; overflow: string; overflowX: string; overflowY: string };
              const origStyles: SavedStyle[] = [];

              const save = (el: HTMLElement): void => {
                origStyles.push({
                  el,
                  height: el.style.height, maxHeight: el.style.maxHeight,
                  width: el.style.width, maxWidth: el.style.maxWidth,
                  overflow: el.style.overflow, overflowX: el.style.overflowX, overflowY: el.style.overflowY,
                });
              };

              // Expand the scroll container itself
              save(container);
              container.style.height = container.scrollHeight + 'px';
              container.style.maxHeight = 'none';
              container.style.width = container.scrollWidth + 'px';
              container.style.maxWidth = 'none';
              container.style.overflow = 'visible';

              // Walk up ancestors to body, expanding anything that clips
              let ancestor = container.parentElement;
              while (ancestor && ancestor !== document.documentElement) {
                const st = getComputedStyle(ancestor);
                const clipsV = ancestor.scrollHeight > ancestor.clientHeight ||
                    st.overflowY === 'hidden' || st.overflowY === 'auto' || st.overflowY === 'scroll';
                const clipsH = ancestor.scrollWidth > ancestor.clientWidth ||
                    st.overflowX === 'hidden' || st.overflowX === 'auto' || st.overflowX === 'scroll';
                if (clipsV || clipsH || st.overflow === 'hidden' || st.overflow === 'auto' || st.overflow === 'scroll') {
                  save(ancestor);
                  ancestor.style.height = 'auto';
                  ancestor.style.maxHeight = 'none';
                  ancestor.style.width = 'auto';
                  ancestor.style.maxWidth = 'none';
                  ancestor.style.overflow = 'visible';
                }
                ancestor = ancestor.parentElement;
              }

              (window as any).__screenshotOrigStyles = origStyles;
            });

            // Resize viewport to match the now-expanded document
            const { width: docWidth, height: docHeight } = await page.evaluate(() => ({
              width: Math.max(
                document.documentElement.scrollWidth,
                document.body.scrollWidth,
                1920,
              ),
              height: Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
                1080,
              ),
            }));
            await page.setViewportSize({ width: docWidth, height: docHeight });
          }

          const buffer = await page.screenshot({
            fullPage,
            type: 'png',
            animations: 'disabled',
          });

          // Restore container and ancestor styles
          if (fullPage) {
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.evaluate(() => {
              type SavedStyle = { el: HTMLElement; height: string; maxHeight: string; width: string; maxWidth: string; overflow: string; overflowX: string; overflowY: string };
              const origStyles = (window as any).__screenshotOrigStyles as SavedStyle[] | undefined;
              if (origStyles) {
                for (const s of origStyles) {
                  s.el.style.height = s.height;
                  s.el.style.maxHeight = s.maxHeight;
                  s.el.style.width = s.width;
                  s.el.style.maxWidth = s.maxWidth;
                  s.el.style.overflow = s.overflow;
                  s.el.style.overflowX = s.overflowX;
                  s.el.style.overflowY = s.overflowY;
                }
              }
            }).catch(() => {});
          }

          if (filePath) {
            writeFileSync(filePath, buffer);
            logger.info('Screenshot saved', { filePath });
          }

          const base64 = buffer.toString('base64');

          return {
            content: [
              {
                type: 'image' as const,
                data: base64,
                mimeType: 'image/png',
              },
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  pageUrl,
                  fullPage,
                  ...(filePath ? { savedTo: filePath } : {}),
                  sizeBytes: buffer.length,
                }),
              },
            ],
          };
        } finally {
          await page.close().catch(() => {});
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('take_page_screenshot failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Screenshot failed: ${message}` }),
          }],
        };
      }
    },
  );

  server.tool(
    'extract_rendered_html',
    'Extract the fully rendered HTML of a SharePoint page using the authenticated Playwright browser. ' +
    'Unlike extract_classic_page (REST API) or extract_page_data (structured extraction), this returns ' +
    'the raw rendered DOM after JavaScript execution — useful for pages with dynamically loaded content.',
    {
      pageUrl: z.string().describe('Full URL of the SharePoint page'),
      selector: z.string().optional().describe('CSS selector to scope extraction to a specific element (returns innerHTML). Omit for full page HTML.'),
      waitForSelector: z.string().optional().describe('CSS selector to wait for before extracting (e.g. a JS-rendered element)'),
      waitTimeout: z.number().default(15000).describe('Max ms to wait for content to render'),
    },
    async ({ pageUrl, selector, waitForSelector, waitTimeout }) => {
      try {
        const url = new URL(pageUrl);
        const siteOrigin = `${url.protocol}//${url.host}`;
        await getSharePointCookies(siteOrigin);

        const { page } = await createBrowserPage();

        try {
          logger.info('Navigating for HTML extraction', { pageUrl });
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });

          // Detect if we landed on a login page and wait for auth
          await waitForSharePointAuth(page, pageUrl);

          // Wait for content: standard SharePoint selectors or custom
          const waitPromises: Promise<unknown>[] = [
            page.waitForSelector('#s4-workspace', { timeout: waitTimeout }),
            page.waitForSelector('[data-automation-id="pageContent"]', { timeout: waitTimeout }),
            page.waitForTimeout(waitTimeout),
          ];
          if (waitForSelector) {
            waitPromises.push(page.waitForSelector(waitForSelector, { timeout: waitTimeout }));
          }
          await Promise.race(waitPromises).catch(() => {});

          // Scroll through page to trigger lazy-loaded content
          await page.evaluate(async () => {
            const s4 = document.getElementById('s4-workspace');
            const candidates = !s4 ? Array.from(document.querySelectorAll('*')).filter(el => {
              const st = getComputedStyle(el);
              return el.scrollHeight > el.clientHeight + 50 &&
                     (st.overflowY === 'scroll' || st.overflowY === 'auto') &&
                     el.clientHeight > 200;
            }) : [];
            const container = s4 || candidates.reduce<Element | null>((b, el) =>
              el.scrollHeight > (b ? b.scrollHeight : 0) ? el : b, null) || document.documentElement;
            const step = container.clientHeight * 2;
            for (let pos = 0; pos < container.scrollHeight; pos += step) {
              container.scrollTop = pos;
              await new Promise(r => setTimeout(r, 150));
            }
            container.scrollTop = 0;
          });
          await page.waitForTimeout(2000);

          // Extract HTML
          let html: string;
          if (selector) {
            html = await page.evaluate((sel: string) => {
              const el = document.querySelector(sel);
              return el ? el.innerHTML : `<!-- No element found for selector: ${sel} -->`;
            }, selector);
          } else {
            html = await page.content();
          }

          const title = await page.title();

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                pageUrl,
                title,
                selector: selector || null,
                htmlLength: html.length,
                html,
              }),
            }],
          };
        } finally {
          await page.close().catch(() => {});
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('extract_rendered_html failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `HTML extraction failed: ${message}` }),
          }],
        };
      }
    },
  );
}
