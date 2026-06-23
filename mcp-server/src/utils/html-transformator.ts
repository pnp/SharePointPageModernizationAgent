import * as cheerio from 'cheerio';

type CheerioAPI = ReturnType<typeof cheerio.load>;
type CheerioElement = ReturnType<CheerioAPI['root']>;

// ── Class mapping tables ──────────────────────────────────────────────

const FONT_SIZE_MAP: Record<string, string> = {
  '1': 'fontSizeSmall',
  '2': 'fontSizeMedium',
  '3': 'fontSizeMediumPlus',
  // 4 → remove (default size)
  '5': 'fontSizeXxLarge',
  '6': 'fontSizeXxxLarge',
  '7': 'fontSizeXxLargePlus',
  '8': 'fontSizeSuper',
};

const FORECOLOR_MAP: Record<string, string> = {
  '1': 'fontColorRedDark',
  '2': 'fontColorRed',
  '3': 'fontColorYellow',
  '4': 'fontColorYellowLight',
  '5': 'fontColorGreenLight',
  '6': 'fontColorGreen',
  '7': 'fontColorBlueLight',
  '8': 'fontColorBlue',
  '9': 'fontColorBlueDark',
  '10': 'fontColorPurple',
};

const THEME_FORECOLOR_MAP: Record<string, string> = {
  // 0 → remove
  '1': 'fontColorThemeSecondary',
  '2': 'fontColorThemePrimary',
  '3': 'fontColorThemeDarkAlt',
  '4': 'fontColorThemeDark',
  '5': 'fontColorThemeDarker',
};

const BACKCOLOR_MAP: Record<string, string> = {
  '1': 'highlightColorMaroon',
  '2': 'highlightColorRed',
  '3': 'highlightColorYellow',
  '4': 'highlightColorYellow',
  '5': 'highlightColorGreen',
  '6': 'highlightColorGreen',
  '7': 'highlightColorAqua',
  '8': 'highlightColorBlue',
  '9': 'highlightColorDarkBlue',
  '10': 'highlightColorPurple',
};

const TABLE_STYLE_MAP: Record<string, string> = {
  '0': 'simpleTableStyleNeutral',
  '3': 'simpleTableStyleNeutral',
  '1': 'bandedRowTableStyleNeutral',
  '2': 'filledHeaderTableStyleNeutral',
  '4': 'filledHeaderTableStyleTheme',
  '5': 'filledHeaderTableStyleTheme',
  '7': 'filledHeaderTableStyleTheme',
  '8': 'filledHeaderTableStyleTheme',
  '9': 'filledHeaderTableStyleTheme',
  '10': 'filledHeaderTableStyleTheme',
  '6': 'bandedRowTableStyleTheme',
};

const DEFAULT_TABLE_STYLE = 'borderHeaderTableStyleNeutral';

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Generic RTE class mapper: finds classes matching `prefix + number` (case-insensitive),
 * replaces them with the mapped modern class (or removes if mapped to empty/undefined).
 *
 * For compound suffixes like `ms-rteThemeForeColor-6-3`, the lookup key is the
 * **last digit** of the class name (matching PnP Framework behaviour).
 */
function mapRteClasses(
  $: CheerioAPI,
  prefix: string,
  map: Record<string, string>,
): void {
  const prefixLower = prefix.toLowerCase();
  const escapedPrefix = prefixLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the prefix (case-insensitive) followed by digits and optional dash-digit groups
  const regex = new RegExp(`^${escapedPrefix}[\\d-]+$`, 'i');
  $('*').each((_, el) => {
    const $el = $(el);
    const clsAttr = $el.attr('class') ?? '';
    if (!clsAttr.toLowerCase().includes(prefixLower)) return;
    const classes = clsAttr.split(/\s+/);
    const updated: string[] = [];
    for (const cls of classes) {
      if (regex.test(cls)) {
        // Extract the last digit as the lookup key (PnP convention)
        const lastDigitMatch = cls.match(/(\d+)$/);
        const key = lastDigitMatch ? lastDigitMatch[1] : '';
        const replacement = map[key];
        if (replacement) updated.push(replacement);
        // else: mapped to nothing → drop the class
      } else {
        updated.push(cls);
      }
    }
    if (updated.length) $el.attr('class', updated.join(' '));
    else $el.removeAttr('class');
  });
}

function extractStyleValue(style: string, prop: string): string | undefined {
  const regex = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = regex.exec(style);
  return m ? m[1].trim() : undefined;
}

function removeStyleProp(style: string, prop: string): string {
  return style.replace(new RegExp(`\\s*${prop}\\s*:[^;]+(;|$)`, 'gi'), '$1').replace(/^;+|;+$/g, '').trim();
}

// ── Transform pipeline ───────────────────────────────────────────────

export function transformHtml(html: string, sourceUrl?: string): string {
  const $ = cheerio.load(html, null, false);

  // 1. Heading shift (process h6→h1 to avoid double-shifting)
  shiftHeadings($);

  // 2. RTE class mappings
  mapRteClasses($, 'ms-rtefontsize-', FONT_SIZE_MAP);
  mapRteClasses($, 'ms-rteforecolor-', FORECOLOR_MAP);
  mapRteClasses($, 'ms-rtethemeforecolor-', THEME_FORECOLOR_MAP);
  mapRteClasses($, 'ms-rtebackcolor-', BACKCOLOR_MAP);

  // ms-rtethemebackcolor-* → remove entirely (case-insensitive)
  $('*').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    if (!cls.toLowerCase().includes('ms-rtethemebackcolor-')) return;
    const classes = cls.split(/\s+/).filter(c => !c.toLowerCase().startsWith('ms-rtethemebackcolor-'));
    if (classes.length) $el.attr('class', classes.join(' '));
    else $el.removeAttr('class');
  });

  // ms-rtefontface-* → remove entirely (case-insensitive)
  $('*').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    if (!cls.toLowerCase().includes('ms-rtefontface-')) return;
    const classes = cls.split(/\s+/).filter(c => !c.toLowerCase().startsWith('ms-rtefontface-'));
    if (classes.length) $el.attr('class', classes.join(' '));
    else $el.removeAttr('class');
  });

  // 3. RTE style mapping
  mapRteStyles($);

  // 4. Table modernization
  modernizeTables($);

  // 5. Blockquote conversion
  convertBlockquotes($);

  // 6. <hr> → <span><br><br></span>
  $('hr').each((_, el) => {
    $(el).replaceWith('<span><br><br></span>');
  });

  // 7. Text decoration (inline style → semantic tags)
  handleTextDecoration($);

  // 8. Style cleanup
  cleanStyles($);

  // 9. Transform <img> tags to RTE inline image format (div.imagePlugin)
  transformImageTags($, sourceUrl);

  // 10. Final cleanup
  let result = $.html();
  // Strip zero-width spaces
  result = result.replace(/\u200B/g, '');
  // Remove any remaining ms-rte* classes (catch-all)
  // Use [a-zA-Z0-9_-]* instead of \S* to avoid eating closing quotes and HTML tags
  result = result.replace(/\bms-rte[a-zA-Z0-9_-]*/g, '');
  // Clean up empty class attributes left behind
  result = result.replace(/\s*class="\s*"/g, '');

  return result;
}

// ── Heading shift ─────────────────────────────────────────────────────

function shiftHeadings($: CheerioAPI): void {
  // Process from h6 down to h1 to avoid double-shifting
  for (let level = 6; level >= 1; level--) {
    $(`h${level}`).each((_, el) => {
      const $el = $(el);
      const textAlign = extractStyleValue($el.attr('style') ?? '', 'text-align');
      let newTag: string;
      if (level <= 3) {
        newTag = `h${level + 1}`;
      } else {
        newTag = 'div';
      }
      const style = textAlign ? ` style="text-align:${textAlign}"` : '';
      const cls = $el.attr('class') ? ` class="${$el.attr('class')}"` : '';
      $el.replaceWith(`<${newTag}${cls}${style}>${$el.html()}</${newTag}>`);
    });
  }
}

// ── RTE style mapping ─────────────────────────────────────────────────

function mapRteStyles($: CheerioAPI): void {
  $('[class*="ms-rtestyle-"]').each((_, el) => {
    const $el = $(el);
    const classes = ($el.attr('class') ?? '').split(/\s+/);
    const remaining: string[] = [];
    let wrapEm = false;
    let wrapU = false;
    let addClass: string | undefined;

    for (const cls of classes) {
      if (!cls.startsWith('ms-rtestyle-')) {
        remaining.push(cls);
        continue;
      }
      const style = cls.replace('ms-rtestyle-', '');
      switch (style) {
        case 'normal':
        case 'references':
          // remove — no transformation
          break;
        case 'quote':
          wrapEm = true;
          break;
        case 'intenseQuote':
          wrapEm = true;
          wrapU = true;
          break;
        case 'emphasis':
          wrapEm = true;
          addClass = 'fontColorBlue';
          break;
        case 'intenseEmphasis':
          wrapEm = true;
          wrapU = true;
          addClass = 'fontColorBlue';
          break;
        case 'intenseReferences':
          wrapU = true;
          break;
        case 'accent1':
          addClass = 'fontColorBlue';
          break;
        case 'accent2':
          addClass = 'fontColorBlueDark';
          break;
        default:
          // Unknown style — keep class
          remaining.push(cls);
      }
    }

    if (addClass) remaining.push(addClass);
    if (remaining.length) $el.attr('class', remaining.join(' '));
    else $el.removeAttr('class');

    // Wrap content in semantic tags
    const content = $el.html() ?? '';
    if (wrapEm && wrapU) {
      $el.html(`<em><u>${content}</u></em>`);
    } else if (wrapEm) {
      $el.html(`<em>${content}</em>`);
    } else if (wrapU) {
      $el.html(`<u>${content}</u>`);
    }
  });
}

// ── Table modernization ───────────────────────────────────────────────

function modernizeTables($: CheerioAPI): void {
  $('table[class*="ms-rteTable-"]').each((_, table) => {
    const $table = $(table);
    const classes = ($table.attr('class') ?? '').split(/\s+/);

    // Find the table style class and extract the code
    let modernClass = DEFAULT_TABLE_STYLE;
    const remaining: string[] = [];
    for (const cls of classes) {
      const m = /^ms-rteTable-(\d+)$/.exec(cls);
      if (m) {
        modernClass = TABLE_STYLE_MAP[m[1]] ?? DEFAULT_TABLE_STYLE;
      } else if (!cls.startsWith('ms-rteTable-')) {
        remaining.push(cls);
      }
      // ms-rteTable-default or other ms-rteTable-* → drop
    }
    remaining.push(modernClass);
    $table.attr('class', remaining.join(' '));

    // Convert <th> → <td><strong>
    $table.find('th').each((_, th) => {
      const $th = $(th);
      const content = $th.html() ?? '';
      const attrs: string[] = [];
      const thAttribs = (th as unknown as { attribs?: Record<string, string> }).attribs ?? {};
      for (const [k, v] of Object.entries(thAttribs)) {
        if (k !== 'class' || !v.startsWith('ms-rteTable-')) {
          attrs.push(`${k}="${v}"`);
        }
      }
      $th.replaceWith(`<td ${attrs.join(' ')}><strong>${content}</strong></td>`);
    });

    // Set default widths
    const DEFAULT_TABLE_WIDTH = 800;
    $table.attr('style', `width:${DEFAULT_TABLE_WIDTH}px`);
    const firstRow = $table.find('tr').first();
    const colCount = firstRow.children('td, th').length || 1;
    const cellWidth = Math.floor(DEFAULT_TABLE_WIDTH / colCount);
    $table.find('td').each((_, td) => {
      const $td = $(td);
      const existing = $td.attr('style') ?? '';
      // Preserve safe visual properties (background-color, color, text-align) from sanitizer
      const preserved: string[] = [`width:${cellWidth}px`];
      for (const prop of ['background-color', 'color', 'text-align']) {
        const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(existing);
        if (match) preserved.push(`${prop}:${match[1].trim()}`);
      }
      $td.attr('style', preserved.join(';'));
    });

    // Remove ms-rteTable-default from <td> elements
    $table.find('td[class*="ms-rteTable-"]').each((_, td) => {
      const $td = $(td);
      const tdClasses = ($td.attr('class') ?? '').split(/\s+/).filter(c => !c.startsWith('ms-rteTable-'));
      if (tdClasses.length) $td.attr('class', tdClasses.join(' '));
      else $td.removeAttr('class');
    });

    // Wrap in responsive wrapper
    const tableHtml = $.html($table);
    $table.replaceWith(
      `<div class="canvasRteResponsiveTable"><div class="tableWrapper">${tableHtml}</div></div>`,
    );
  });
}

// ── Blockquote conversion ─────────────────────────────────────────────

function convertBlockquotes($: CheerioAPI): void {
  $('blockquote').each((_, el) => {
    const $el = $(el);
    const style = $el.attr('style') ?? '';
    const marginLeft = extractStyleValue(style, 'margin-left') ?? extractStyleValue(style, 'margin') ?? '40px';
    const px = parseInt(marginLeft, 10) || 40;
    const content = $el.html() ?? '';
    $el.replaceWith(`<p style="margin-left:${px}px">${content}</p>`);
  });
}

// ── Text decoration handling ──────────────────────────────────────────

function handleTextDecoration($: CheerioAPI): void {
  $('[style*="text-decoration"]').each((_, el) => {
    const $el = $(el);
    const style = $el.attr('style') ?? '';
    const td = extractStyleValue(style, 'text-decoration');
    if (!td) return;

    const content = $el.html() ?? '';
    let newContent = content;

    if (td.includes('line-through')) {
      newContent = `<s>${newContent}</s>`;
    }
    if (td.includes('underline')) {
      newContent = `<u>${newContent}</u>`;
    }

    $el.html(newContent);
    const cleaned = removeStyleProp(style, 'text-decoration');
    if (cleaned) $el.attr('style', cleaned);
    else $el.removeAttr('style');
  });
}

// ── Style cleanup ─────────────────────────────────────────────────────

const BLOCK_ELEMENTS = new Set(['p', 'div', 'h2', 'h3', 'h4', 'li', 'ul', 'ol', 'blockquote']);
const INLINE_ELEMENTS = new Set(['span', 'a', 'em', 'strong']);
const TABLE_ELEMENTS = new Set(['table']);
const CELL_ELEMENTS = new Set(['td', 'th']);
const BLOCK_KEEP = new Set(['margin-left', 'text-align']);
const INLINE_KEEP = new Set(['width', 'text-align']);
const TABLE_KEEP = new Set(['width', 'border-collapse', 'border', 'margin-left', 'text-align']);
const CELL_KEEP = new Set(['width', 'padding', 'border', 'background-color', 'color', 'text-align']);

function cleanStyles($: CheerioAPI): void {
  $('[style]').each((_, el) => {
    const $el = $(el);
    const tagName = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    let keepSet: Set<string> | undefined;

    if (TABLE_ELEMENTS.has(tagName)) keepSet = TABLE_KEEP;
    else if (CELL_ELEMENTS.has(tagName)) keepSet = CELL_KEEP;
    else if (BLOCK_ELEMENTS.has(tagName)) keepSet = BLOCK_KEEP;
    else if (INLINE_ELEMENTS.has(tagName)) keepSet = INLINE_KEEP;

    if (!keepSet) return; // leave unknown elements alone

    const style = $el.attr('style') ?? '';
    const parts = style.split(';').map(p => p.trim()).filter(Boolean);
    const kept: string[] = [];
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = part.substring(0, colonIdx).trim().toLowerCase();
      if (keepSet.has(prop)) kept.push(part);
    }

    if (kept.length) $el.attr('style', kept.join(';'));
    else $el.removeAttr('style');
  });
}

// ── Image tag → RTE inline image ──────────────────────────────────────

const RTE_POSITION_MAP: Record<string, string> = {
  'ms-rtePosition-1': 'Left',
  'ms-rtePosition-2': 'Right',
  'ms-rtePosition-3': 'Top',
  'ms-rtePosition-4': 'Middle',
  'ms-rtePosition-5': 'Bottom',
};

/**
 * Parse a dimension string, stripping "px" suffix.
 * Returns the numeric string or null if not a valid px integer.
 */
function parsePx(dim: string | undefined): string | null {
  if (!dim) return null;
  const cleaned = dim.trim().toLowerCase().replace('px', '').trim();
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Get a dimension (width or height) from inline style first, then fall back
 * to the HTML attribute.
 */
function getDimension($el: { attr: (name: string) => string | undefined }, prop: string): string | undefined {
  const style = $el.attr('style') ?? '';
  const fromStyle = extractStyleValue(style, prop);
  if (fromStyle) return fromStyle;
  return $el.attr(prop) ?? undefined;
}

/**
 * Get alignment from ms-rtePosition-* class on the <img> element.
 */
function getAlignment($el: { attr: (name: string) => string | undefined }): string {
  const classes = ($el.attr('class') ?? '').split(/\s+/);
  for (const cls of classes) {
    const mapped = RTE_POSITION_MAP[cls];
    if (mapped) return mapped;
  }
  return 'Left';
}

/**
 * Resolve a potentially relative image URL to an absolute URL using the source site URL.
 * Handles server-relative (/sites/...) and already-absolute URLs.
 */
function resolveImageUrl(src: string, sourceUrl?: string): string {
  if (!sourceUrl || !src) return src;
  // Already absolute
  if (/^https?:\/\//i.test(src)) return src;
  // Server-relative path — prepend the source site origin
  if (src.startsWith('/')) {
    try {
      const origin = new URL(sourceUrl).origin;
      return origin + src;
    } catch { return src; }
  }
  return src;
}

/**
 * Transform <img> tags to the RTE inline image div format consumed by modern
 * SharePoint pages.  Skips images inside <a> tags (these are typically icons
 * used for link appearance).
 *
 * Based on ImageTag.cs from ClassicUserPageModernization.
 */
function transformImageTags($: CheerioAPI, sourceUrl?: string): void {
  $('img').each((_, el) => {
    const $img = $(el);

    // Skip images inside links — they are usually icons for link styling
    const parentTag = ($img.parent()[0] as unknown as { tagName?: string })?.tagName?.toLowerCase();
    if (parentTag === 'a') return;

    const src = resolveImageUrl($img.attr('src') ?? '', sourceUrl);
    if (!src) return;

    const alt = $img.attr('alt') ?? '';
    const alignment = getAlignment($img);

    const rawWidth = getDimension($img, 'width');
    const rawHeight = getDimension($img, 'height');
    const dataWidth = parsePx(rawWidth);
    const dataHeight = parsePx(rawHeight);

    // Build data attributes matching the RTE inline image format
    const attrs: string[] = [
      'class="imagePlugin"',
      'style="background-color:transparent;position:relative;"',
      `data-alignment="${alignment}"`,
      'data-contentprovider="undefined"',
    ];

    if (dataHeight === null) {
      // No height available — let modern RTE use image natural size
      attrs.push('data-imagenaturalheight="-1"');
      attrs.push('data-imagenaturalwidth="-1"');
    } else {
      attrs.push(`data-imagenaturalheight="${dataHeight}"`);
      if (dataWidth !== null) {
        attrs.push(`data-imagenaturalwidth="${dataWidth}"`);
      }
    }

    attrs.push(`data-imageurl="${escapeHtml(src)}"`);
    if (alt) {
      attrs.push(`data-alttext="${escapeHtml(alt)}"`);
    }
    attrs.push('data-uploading="0"');

    $img.replaceWith(`<div ${attrs.join(' ')}></div>`);
  });
}

/**
 * Minimal HTML attribute value escaping (equivalent to WebUtility.HtmlEncode
 * for the chars that matter inside attribute values).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
