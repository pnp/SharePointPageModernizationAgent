import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { getSharePointCookies, createBrowserPage, waitForSharePointAuth } from '../sharepoint/auth.js';

/**
 * JavaScript extraction script to run inside a SharePoint page via Chrome DevTools MCP.
 * Adapted from wiki-compare skill's extract-wiki-data.js.
 *
 * Extracts: headings, links, images, text content, tables, web parts, structural counts.
 * Works for both classic wiki pages and modern site pages.
 */
const EXTRACTION_SCRIPT = `async () => {
  // === Find scrollable container ===
  const s4 = document.getElementById('s4-workspace');
  let container;
  if (s4) {
    container = s4;
  } else {
    // Modern pages: find the largest scrollable container
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
      const st = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 50 &&
             (st.overflowY === 'scroll' || st.overflowY === 'auto') &&
             el.clientHeight > 200;
    });
    container = candidates.reduce((b, el) =>
      el.scrollHeight > (b ? b.scrollHeight : 0) ? el : b, null) || document.documentElement;
  }

  // === Scroll to trigger lazy-loaded images ===
  const step = container.clientHeight * 2;
  for (let pos = 0; pos < container.scrollHeight; pos += step) {
    container.scrollTop = pos;
    await new Promise(r => setTimeout(r, 150));
  }
  container.scrollTop = 0;
  document.querySelectorAll('img[loading="lazy"]').forEach(img => img.loading = 'eager');
  document.querySelectorAll('img[data-src]').forEach(img => {
    if (!img.src || img.src !== img.dataset.src) img.src = img.dataset.src;
  });

  // === Detect page type ===
  const isClassic = !!s4;
  const isModernPage = !!document.querySelector('[data-automation-id="pageContent"]');

  // === Find content area ===
  // Modern pages: CanvasZones are each wrapped in separate FluentProviders.
  // Use #spPageCanvasContent or .Canvas.grid as the common ancestor.
  let contentEl;
  if (isClassic) {
    contentEl = document.querySelector('[id*="WikiField"]') ||
                document.querySelector('.ms-wikicontent') ||
                document.querySelector('.ms-rte-layoutszone-inner');
  } else {
    contentEl = document.querySelector('[data-automation-id="pageContent"]') ||
                document.getElementById('spPageCanvasContent') ||
                document.querySelector('.Canvas.grid');
    if (!contentEl) {
      // Last resort: find parent of all CanvasZones
      const zones = document.querySelectorAll('.CanvasZone');
      if (zones.length > 1) {
        // Walk up from first zone to find common ancestor with second zone
        let el = zones[0].parentElement;
        while (el && !el.contains(zones[1])) el = el.parentElement;
        contentEl = el;
      } else if (zones.length === 1) {
        contentEl = zones[0];
      }
    }
    if (!contentEl) {
      contentEl = document.querySelector('[id*="WikiField"]') ||
                  document.querySelector('.ms-wikicontent');
    }
  }

  if (!contentEl) return {
    error: 'No content container found',
    pageType: isClassic ? 'classic' : 'modern',
    hint: isClassic ? 'No WikiField found' : 'No pageContent/CanvasZone found'
  };

  // === Extract headings ===
  const headings = Array.from(contentEl.querySelectorAll('h1, h2, h3, h4')).map(h => ({
    tag: h.tagName,
    text: h.textContent.trim().substring(0, 200)
  }));

  // === Extract links (href + text) ===
  const links = Array.from(contentEl.querySelectorAll('a[href]')).map(a => ({
    text: a.textContent.trim().substring(0, 100),
    href: a.href,
    isExternal: a.href.startsWith('http') && !a.href.includes(location.hostname)
  })).filter(l => l.text.length > 0 && !l.href.startsWith('javascript:'));

  // === Extract images ===
  let images;
  if (isClassic) {
    const imgs = Array.from(contentEl.querySelectorAll('img'));
    images = imgs.filter(img => img.naturalWidth > 20 && img.src && !img.src.includes('blank.gif'))
                 .map(img => ({
                   src: img.src.substring(0, 200),
                   alt: (img.alt || '').substring(0, 100),
                   width: img.naturalWidth,
                   height: img.naturalHeight
                 }));
  } else {
    // Modern pages may use data-imageurl containers or regular img tags
    const imgContainers = Array.from(contentEl.querySelectorAll('[data-imageurl]'));
    const regularImgs = Array.from(contentEl.querySelectorAll('img'));
    images = [
      ...imgContainers.map(el => ({
        src: (el.getAttribute('data-imageurl') || '').substring(0, 200),
        alt: (el.getAttribute('data-alttext') || '').substring(0, 100),
        width: parseInt(el.getAttribute('data-imagenaturalwidth') || '0'),
        height: parseInt(el.getAttribute('data-imagenaturalheight') || '0')
      })),
      ...regularImgs
        .filter(img => img.naturalWidth > 20 && img.src && !img.src.includes('blank.gif'))
        .filter(img => !img.closest('[data-imageurl]')) // avoid double-counting
        .map(img => ({
          src: img.src.substring(0, 200),
          alt: (img.alt || '').substring(0, 100),
          width: img.naturalWidth,
          height: img.naturalHeight
        }))
    ];
  }

  // === Extract full text ===
  const fullText = contentEl.innerText;

  // === Detect web parts (modern) ===
  const webParts = [];
  if (!isClassic) {
    const wpContainers = document.querySelectorAll('[data-sp-web-part]');
    wpContainers.forEach(wp => {
      try {
        const dataStr = wp.getAttribute('data-sp-web-part') || '{}';
        const data = JSON.parse(dataStr);
        webParts.push({
          id: data.id || '',
          instanceId: data.instanceId || '',
          title: data.title || wp.querySelector('[data-automation-id="titleRegion"]')?.textContent?.trim() || '',
          alias: data.alias || '',
          innerText: wp.innerText.substring(0, 500)
        });
      } catch { /* ignore parse errors */ }
    });
  }
  // Classic web parts
  if (isClassic) {
    const wpBoxes = contentEl.querySelectorAll('.ms-rte-wpbox, .ms-webpartzone-cell');
    wpBoxes.forEach(box => {
      webParts.push({
        id: box.id || '',
        title: box.querySelector('.ms-webpart-titleText')?.textContent?.trim() || '',
        innerText: box.innerText.substring(0, 500)
      });
    });
  }

  // === Structural counts ===
  return {
    pageType: isClassic ? 'classic' : 'modern',
    title: document.title || '',
    url: location.href,
    headings,
    headingCount: headings.length,
    links,
    linkCount: links.length,
    images,
    imageCount: images.length,
    webParts,
    webPartCount: webParts.length,
    textLength: fullText.length,
    textPreview: fullText.substring(0, 2000),
    tableCount: contentEl.querySelectorAll('table').length,
    codeBlockCount: contentEl.querySelectorAll('pre, code').length,
    iframeCount: contentEl.querySelectorAll('iframe').length,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight
  };
}`;

interface PageData {
  error?: string;
  pageType: string;
  title: string;
  url: string;
  headings: Array<{ tag: string; text: string }>;
  headingCount: number;
  links: Array<{ text: string; href: string; isExternal: boolean }>;
  linkCount: number;
  images: Array<{ src: string; alt: string; width: number; height: number }>;
  imageCount: number;
  webParts: Array<{ id: string; title: string; innerText: string; alias?: string }>;
  webPartCount: number;
  textLength: number;
  textPreview: string;
  tableCount: number;
  codeBlockCount: number;
  iframeCount: number;
}

interface ComparisonResult {
  status: 'OK' | 'NEEDS_REVIEW' | 'SIGNIFICANT_GAPS';
  contentCoverage: number; // 0-100%
  summary: string;
  headingComparison: {
    classicCount: number;
    modernCount: number;
    matched: string[];
    matchedViaLinks: string[];
    missingInModern: string[];
    addedInModern: string[];
  };
  linkComparison: {
    classicCount: number;
    modernCount: number;
    missingLinks: Array<{ text: string; href: string }>;
    matchedCount: number;
  };
  textComparison: {
    classicLength: number;
    modernLength: number;
    ratio: number;
    missingPhrases: string[];
  };
  imageComparison: {
    classicCount: number;
    modernCount: number;
    missing: number;
    tileIcons: number;
    contentImages: number;
  };
  webPartComparison: {
    classicCount: number;
    modernCount: number;
  };
  issues: string[];
  suggestions: string[];
}

/**
 * Compare structural data extracted from classic and modern pages.
 */
function comparePages(classic: PageData, modern: PageData): ComparisonResult {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // --- Heading comparison ---
  const classicHeadings = classic.headings.map(h => h.text.toLowerCase().trim());
  const modernHeadings = modern.headings.map(h => h.text.toLowerCase().trim());

  const matched: string[] = [];
  const missingInModern: string[] = [];
  const usedModern = new Set<number>();

  // Build a set of modern link texts for Quick Links cross-check
  const modernLinkTexts = new Set(modern.links.map(l => l.text.toLowerCase().trim()));
  const matchedViaLinks: string[] = []; // headings that became Quick Links tiles

  for (const ch of classic.headings) {
    const chLower = ch.text.toLowerCase().trim();
    // Try exact heading match, then case-insensitive substring
    let foundIdx = modernHeadings.findIndex((mh, i) => !usedModern.has(i) && mh === chLower);
    if (foundIdx < 0) {
      foundIdx = modernHeadings.findIndex((mh, i) => !usedModern.has(i) && (mh.includes(chLower) || chLower.includes(mh)));
    }
    if (foundIdx >= 0) {
      matched.push(ch.text);
      usedModern.add(foundIdx);
    } else if (modernLinkTexts.has(chLower)) {
      // Heading text appears as a link title in modern (e.g., Quick Links tile)
      // This is a valid conversion — tile headings become link labels
      matchedViaLinks.push(ch.text);
    } else {
      missingInModern.push(ch.text);
    }
  }

  const addedInModern = modern.headings.filter((_, i) => !usedModern.has(i)).map(h => h.text);

  if (missingInModern.length > 0) {
    issues.push(`Missing headings in modern: ${missingInModern.join(', ')}`);
    suggestions.push('Check if these sections were dropped during HTML cleaning or AI analysis');
  }
  if (matchedViaLinks.length > 0) {
    // Informational, not an issue — these headings were intentionally converted to link tiles
    suggestions.push(`${matchedViaLinks.length} heading(s) converted to Quick Links tiles: ${matchedViaLinks.join(', ')}`);
  }

  // --- Link comparison ---
  // Normalize URLs for comparison (strip protocol, trailing slash, query params)
  function normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return (u.hostname + u.pathname).replace(/\/$/, '').toLowerCase();
    } catch { return url.toLowerCase(); }
  }

  const classicLinkMap = new Map<string, { text: string; href: string }>();
  for (const link of classic.links) {
    const key = normalizeUrl(link.href);
    if (!classicLinkMap.has(key)) classicLinkMap.set(key, link);
  }

  const modernLinkUrls = new Set(modern.links.map(l => normalizeUrl(l.href)));
  const missingLinks: Array<{ text: string; href: string }> = [];

  for (const [normalizedUrl, link] of classicLinkMap) {
    if (!modernLinkUrls.has(normalizedUrl)) {
      // Also try matching by link text
      const textMatch = modern.links.some(ml => ml.text.toLowerCase() === link.text.toLowerCase());
      if (!textMatch) {
        missingLinks.push(link);
      }
    }
  }

  if (missingLinks.length > 0) {
    issues.push(`Missing links in modern: ${missingLinks.map(l => `"${l.text}" → ${l.href}`).join('; ')}`);
    suggestions.push('Ensure all navigation links and CTAs are preserved. Consider using Quick Links or Button web parts.');
  }

  // --- Text comparison ---
  // Extract significant phrases (sentences/paragraphs >20 chars) from classic, check if they appear in modern
  const classicText = classic.textPreview.toLowerCase();
  const modernText = modern.textPreview.toLowerCase();

  // Split into significant phrases (sentences)
  const classicPhrases = classicText.split(/[.\n\r]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const missingPhrases: string[] = [];
  for (const phrase of classicPhrases) {
    // Check if a significant portion of the phrase exists in modern text
    const words = phrase.split(/\s+/).filter(w => w.length > 3);
    const matchingWords = words.filter(w => modernText.includes(w));
    if (matchingWords.length < words.length * 0.5) {
      missingPhrases.push(phrase.substring(0, 100));
    }
  }

  const textRatio = classic.textLength > 0 ? modern.textLength / classic.textLength : 1;
  if (textRatio < 0.6) {
    issues.push(`Significant text loss: modern has ${Math.round(textRatio * 100)}% of classic text length (${modern.textLength} vs ${classic.textLength} chars)`);
  }
  if (missingPhrases.length > 0) {
    issues.push(`Missing text content: ${missingPhrases.length} significant phrases not found in modern page`);
    suggestions.push('Review the extraction pipeline — HTML cleaning may be too aggressive, or AI analysis dropped content blocks');
  }

  // --- Image comparison ---
  // Distinguish between standalone content images and tile/nav icons.
  // Tile icons are small images whose alt text or filename matches a link label — they
  // accompany navigation tiles and are decorative. Quick Links handles these as built-in
  // icons, so missing tile icons are a minor issue, not a content gap.
  const classicLinkTextsLower = new Set(classic.links.map(l => l.text.toLowerCase().trim()));
  let tileIconCount = 0;
  let contentImageMissing = 0;

  if (classic.imageCount > modern.imageCount) {
    for (const img of classic.images) {
      // Check if this image is already present in modern
      const inModern = modern.images.some(mi => mi.src === img.src || mi.alt === img.alt);
      if (inModern) continue;

      // Heuristic: tile icon if (a) small size, or (b) filename/alt matches a link label
      const isTileIcon =
        (img.width > 0 && img.width <= 200 && img.height > 0 && img.height <= 200) ||
        classicLinkTextsLower.has(img.alt.toLowerCase().trim()) ||
        classic.links.some(l => img.src.toLowerCase().includes(l.text.toLowerCase().replace(/\s+/g, '')));

      if (isTileIcon) {
        tileIconCount++;
      } else {
        contentImageMissing++;
      }
    }
  }

  const totalImagesMissing = Math.max(0, classic.imageCount - modern.imageCount);
  if (contentImageMissing > 0) {
    issues.push(`Missing content images: ${contentImageMissing} image(s) from classic not in modern`);
    suggestions.push('Use Image web part for each classic image. Check if image URLs need to be re-uploaded.');
  }
  if (tileIconCount > 0) {
    // Informational — tile icons converted to Quick Links are expected to be missing as standalone images
    suggestions.push(`${tileIconCount} tile icon(s) not carried over — these accompanied navigation links now handled by Quick Links`);
  }

  // --- Web part comparison ---
  if (classic.webPartCount > 0 && modern.webPartCount === 0) {
    issues.push(`No web parts in modern page — classic had ${classic.webPartCount} web part(s)`);
    suggestions.push('Classic web parts should be converted to modern equivalents (Quick Links, Button, List, etc.)');
  }

  // --- Overall coverage score ---
  let score = 100;
  score -= missingInModern.length * 10;       // -10 per truly missing heading
  // matchedViaLinks headings are NOT penalized — they're valid conversions
  score -= missingLinks.length * 5;            // -5 per missing link
  score -= missingPhrases.length * 3;          // -3 per missing phrase
  score -= contentImageMissing * 10;           // -10 per missing content image
  score -= tileIconCount * 2;                  // -2 per missing tile icon (minor, decorative)
  if (textRatio < 0.6) score -= 20;
  else if (textRatio < 0.8) score -= 10;
  score = Math.max(0, Math.min(100, score));

  // --- Status ---
  let status: ComparisonResult['status'] = 'OK';
  if (score < 50) status = 'SIGNIFICANT_GAPS';
  else if (score < 80 || issues.length > 0) status = 'NEEDS_REVIEW';

  const summary = status === 'OK'
    ? `Migration looks good! ${matched.length + matchedViaLinks.length}/${classic.headingCount} headings accounted for${matchedViaLinks.length > 0 ? ` (${matchedViaLinks.length} as Quick Links tiles)` : ''}, ${Math.round(textRatio * 100)}% text coverage.`
    : status === 'NEEDS_REVIEW'
    ? `Migration has some gaps. Coverage: ${score}%. ${issues.length} issue(s) found.`
    : `Migration has significant gaps. Coverage: ${score}%. ${issues.length} issue(s) need attention.`;

  return {
    status,
    contentCoverage: score,
    summary,
    headingComparison: {
      classicCount: classic.headingCount,
      modernCount: modern.headingCount,
      matched,
      matchedViaLinks,
      missingInModern,
      addedInModern,
    },
    linkComparison: {
      classicCount: classicLinkMap.size,
      modernCount: modern.linkCount,
      missingLinks,
      matchedCount: classicLinkMap.size - missingLinks.length,
    },
    textComparison: {
      classicLength: classic.textLength,
      modernLength: modern.textLength,
      ratio: Math.round(textRatio * 100) / 100,
      missingPhrases,
    },
    imageComparison: {
      classicCount: classic.imageCount,
      modernCount: modern.imageCount,
      missing: totalImagesMissing,
      tileIcons: tileIconCount,
      contentImages: contentImageMissing,
    },
    webPartComparison: {
      classicCount: classic.webPartCount,
      modernCount: modern.webPartCount,
    },
    issues,
    suggestions,
  };
}

export function registerCompareTool(server: McpServer): void {
  // Tool 1: Get the extraction script for the AI to run via Chrome DevTools
  server.tool(
    'get_comparison_extraction_script',
    'Get a JavaScript extraction script to run on both classic and modern pages via Chrome DevTools evaluate_script. ' +
    'Run this on the classic source page and the migrated modern page, then pass both results to compare_migration_quality.',
    {},
    async () => {
      const instructions = {
        script: EXTRACTION_SCRIPT,
        usage: [
          '1. Navigate Chrome to the classic page URL',
          '2. Run this script via evaluate_script → save result as classicData',
          '3. Navigate Chrome to the modern migrated page URL',
          '4. Run this script via evaluate_script → save result as modernData',
          '5. Pass both JSON results to compare_migration_quality',
        ],
        notes: [
          'The script handles lazy image loading by scrolling through the page first',
          'Works on both classic wiki pages (WikiField) and modern pages (CanvasZone)',
          'Returns headings, links, images, text, web parts, and structural counts',
        ],
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(instructions, null, 2) }] };
    },
  );

  // Tool 2: Compare extracted data from both pages
  server.tool(
    'compare_migration_quality',
    'Compare structural data extracted from a classic page and its migrated modern version. ' +
    'Input is the JSON output from running the extraction script on both pages. ' +
    'Returns a detailed comparison report with content coverage score, missing items, and improvement suggestions.',
    {
      classicPageData: z.string().describe('JSON string of extraction data from the classic source page'),
      modernPageData: z.string().describe('JSON string of extraction data from the modern migrated page'),
    },
    async ({ classicPageData, modernPageData }) => {
      try {
        const classic: PageData = JSON.parse(classicPageData);
        const modern: PageData = JSON.parse(modernPageData);

        if (classic.error) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Classic page extraction failed: ${classic.error}` }) }] };
        }
        if (modern.error) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Modern page extraction failed: ${modern.error}` }) }] };
        }

        const result = comparePages(classic, modern);

        // Also include raw data summary for the AI to use
        const report = {
          ...result,
          rawDataSummary: {
            classic: {
              title: classic.title,
              url: classic.url,
              headings: classic.headings.map(h => h.text),
              linkCount: classic.linkCount,
              imageCount: classic.imageCount,
              textLength: classic.textLength,
            },
            modern: {
              title: modern.title,
              url: modern.url,
              headings: modern.headings.map(h => h.text),
              linkCount: modern.linkCount,
              imageCount: modern.imageCount,
              textLength: modern.textLength,
            },
          },
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('compare_migration_quality failed', { error: message });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Comparison failed: ${message}` }) }] };
      }
    },
  );

  // Tool 3: Extract page data via Playwright (replaces Chrome DevTools workflow)
  server.tool(
    'extract_page_data',
    'Navigate to a SharePoint page and extract structural data (headings, links, images, text, web parts) ' +
    'using the authenticated Playwright browser. Returns the same JSON as the extraction script. ' +
    'Use this instead of get_comparison_extraction_script + Chrome DevTools evaluate_script.',
    {
      pageUrl: z.string().describe('Full URL of the SharePoint page to extract data from'),
    },
    async ({ pageUrl }) => {
      try {
        const url = new URL(pageUrl);
        const siteOrigin = `${url.protocol}//${url.host}`;
        await getSharePointCookies(siteOrigin);

        const { page } = await createBrowserPage();

        try {
          logger.info('Navigating for data extraction', { pageUrl });
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });

          // Detect if we landed on a login page and wait for auth
          await waitForSharePointAuth(page, pageUrl);

          // Wait for content: classic or modern
          await Promise.race([
            page.waitForSelector('#s4-workspace', { timeout: 10_000 }),
            page.waitForSelector('[data-automation-id="pageContent"]', { timeout: 10_000 }),
            page.waitForTimeout(10_000),
          ]).catch(() => {});

          await page.waitForTimeout(2000);

          // Run the extraction script in the page context
          const result = await page.evaluate(`(${EXTRACTION_SCRIPT})()`);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
          };
        } finally {
          await page.close().catch(() => {});
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('extract_page_data failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Extraction failed: ${message}` }),
          }],
        };
      }
    },
  );
}
