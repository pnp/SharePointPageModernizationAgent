import * as cheerio from 'cheerio';

const EVENT_HANDLER_ATTRS = /^on[a-z]+$/i;
const HEX_COLOR_PATTERN = '#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})';
const HEX_COLOR = new RegExp(`^${HEX_COLOR_PATTERN}$`, 'i');
const CSS_LENGTH = /^(?:0|(?:\d+(?:\.\d+)?)(?:px|pt|em|rem|%))$/i;
const CSS_BOX_LENGTHS = /^(?:0|(?:\d+(?:\.\d+)?)(?:px|pt|em|rem|%))(?:\s+(?:0|(?:\d+(?:\.\d+)?)(?:px|pt|em|rem|%))){0,3}$/i;

const BLOCK_STYLE_PROPERTIES = new Set([
  'color',
  'font-size',
  'font-style',
  'font-weight',
  'margin-left',
  'text-align',
]);
const INLINE_STYLE_PROPERTIES = new Set([
  'color',
  'font-size',
  'font-style',
  'font-weight',
  'text-align',
  'width',
]);
const TABLE_STYLE_PROPERTIES = new Set([
  'border',
  'border-collapse',
  'margin-left',
  'text-align',
  'width',
]);
const CELL_STYLE_PROPERTIES = new Set([
  'background-color',
  'border',
  'color',
  'padding',
  'text-align',
  'width',
]);

function getStyleValue(style: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return match?.[1]?.trim();
}

function isSafeStyleValue(property: string, value: string): boolean {
  switch (property) {
    case 'background-color':
    case 'color':
      return HEX_COLOR.test(value);
    case 'border':
      return value === 'none'
        || value === '0'
        || /^0px$/i.test(value)
        || new RegExp(`^(?:\\d+(?:\\.\\d+)?px)\\s+(?:solid|dashed|dotted)\\s+${HEX_COLOR_PATTERN}$`, 'i').test(value);
    case 'border-collapse':
      return value === 'collapse' || value === 'separate';
    case 'font-size':
    case 'margin-left':
    case 'width':
      return CSS_LENGTH.test(value);
    case 'padding':
      return CSS_BOX_LENGTHS.test(value);
    case 'font-style':
      return value === 'normal' || value === 'italic' || value === 'oblique';
    case 'font-weight':
      return value === 'normal' || value === 'bold' || /^[1-9]00$/.test(value);
    case 'text-align':
      return ['left', 'right', 'center', 'justify', 'start', 'end'].includes(value);
    default:
      return false;
  }
}

function keepAllowedStyles(style: string, allowedProperties: Set<string>): string {
  const styles: string[] = [];
  for (const declaration of style.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (allowedProperties.has(property) && isSafeStyleValue(property, value)) {
      styles.push(`${property}:${value}`);
    }
  }
  return styles.join(';');
}

function convertStyledCallouts($: cheerio.CheerioAPI): void {
  $('div[style]').each((_, element) => {
    const $element = $(element);
    const style = $element.attr('style') ?? '';
    const background = getStyleValue(style, 'background-color') ?? getStyleValue(style, 'background');
    const padding = getStyleValue(style, 'padding');
    const border = getStyleValue(style, 'border');
    const borderLeft = getStyleValue(style, 'border-left');
    const borderColor = borderLeft?.match(new RegExp(`${HEX_COLOR_PATTERN}(?![0-9a-f])`, 'i'))?.[0];

    if (!background || !padding || (!border && !borderColor)) return;
    if (!HEX_COLOR.test(background) || !CSS_BOX_LENGTHS.test(padding)) return;

    const cellStyles = [
      `background-color:${background}`,
      `padding:${padding}`,
    ];
    if (border && isSafeStyleValue('border', border)) {
      cellStyles.push(`border:${border}`);
    } else if (borderColor) {
      cellStyles.push(`border:1px solid ${borderColor}`);
    }

    const color = getStyleValue(style, 'color');
    if (color && HEX_COLOR.test(color)) {
      cellStyles.push(`color:${color}`);
    }

    $element.replaceWith(
      `<table style="width:100%;border-collapse:collapse"><tbody><tr><td style="${cellStyles.join(';')}">${$element.html() ?? ''}</td></tr></tbody></table>`,
    );
  });
}

/**
 * Unwrap a SafeLinks URL to its original destination.
 * SafeLinks format: https://nam06.safelinks.protection.outlook.com/?url=<encoded-url>&data=...
 */
function unwrapSafeLink(url: string): string {
  if (!url.includes('safelinks.protection.outlook.com')) return url;
  try {
    const parsed = new URL(url);
    const inner = parsed.searchParams.get('url');
    if (!inner) return url;
    // The inner URL may itself be a redirect wrapper (nam.safelink.emails.azure.net)
    if (inner.includes('safelink.emails.azure.net') && inner.includes('destination')) {
      try {
        const innerParsed = new URL(inner);
        const dest = innerParsed.searchParams.get('destination');
        if (dest) return decodeURIComponent(dest);
      } catch { /* fall through */ }
    }
    return decodeURIComponent(inner);
  } catch { return url; }
}

/**
 * Clean WikiField HTML for modern page migration.
 * Strips classic layout tables, unwraps SafeLinks, removes artifacts.
 */
export function cleanWikiHtml(html: string): { html: string; hadScripts: boolean } {
  const $ = cheerio.load(html, null, false);
  let hadScripts = false;

  // Remove <script> and <style> tags
  const scripts = $('script');
  if (scripts.length > 0) { hadScripts = true; scripts.remove(); }
  $('style').remove();

  // Remove event handler attributes
  $('*').each((_, el) => {
    const element = $(el);
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const attr of Object.keys(attribs)) {
      if (EVENT_HANDLER_ATTRS.test(attr)) { hadScripts = true; element.removeAttr(attr); }
    }
  });

  // Strip wiki layout table — unwrap content from <table id="layoutsTable">
  // Must collect ALL .ms-rte-layoutszone-inner content (multi-column layouts have multiple zones)
  $('table#layoutsTable').each((_, table) => {
    const $table = $(table);
    const zones = $table.find('.ms-rte-layoutszone-inner');
    const allContent: string[] = [];
    zones.each((__, zone) => {
      const content = $(zone).html();
      if (content) allContent.push(content);
    });
    if (allContent.length > 0) {
      $table.replaceWith(allContent.join('\n'));
    }
  });

  // Strip ms-rte-layoutszone wrappers (keep inner content)
  $('.ms-rte-layoutszone-outer, .ms-rte-layoutszone-inner').each((_, el) => {
    $(el).replaceWith($(el).html() ?? '');
  });

  // Remove web part box placeholders (empty markers for embedded WPs)
  $('div.ms-rte-wpbox').remove();

  // Strip Outlook/email presentation tables (class="x_ctaButton" or role="presentation")
  // Convert CTA tables to styled links
  $('table.x_ctaButton, table[role="presentation"]').each((_, table) => {
    const $table = $(table);
    const link = $table.find('a').first();
    if (link.length) {
      const href = link.attr('href') ?? '';
      const text = link.text().trim();
      if (text && href) {
        const cleanHref = unwrapSafeLink(href);
        // Mark with data-cta so we can re-apply styling after global style strip
        $table.replaceWith(
          `<p><a href="${cleanHref}" data-cta="true">${text}</a></p>`,
        );
        return;
      }
    }
    // Non-link presentation table — just unwrap content
    $table.replaceWith($table.html() ?? '');
  });

  // Unwrap all SafeLinks URLs and remove SafeLinks remnant attributes
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    if (href.includes('safelinks.protection.outlook.com')) {
      $a.attr('href', unwrapSafeLink(href));
    }
  });

  // Remove SafeLinks remnant attributes from all <a> tags
  $('a').each((_, el) => {
    const $a = $(el);
    // Remove SafeLinks-specific attributes
    $a.removeAttr('data-auth');
    $a.removeAttr('data-linkindex');
    $a.removeAttr('data-safelink');
    // Remove aria-label / title if they contain SafeLinks tooltip text
    const ariaLabel = $a.attr('aria-label') ?? '';
    if (ariaLabel.includes('Original URL') || ariaLabel.includes('Click or tap if you trust this link')) {
      $a.removeAttr('aria-label');
    }
    const title = $a.attr('title') ?? '';
    if (title.includes('Original URL') || title.includes('Click or tap if you trust this link')) {
      $a.removeAttr('title');
    }
    // Remove any remaining data-* attributes related to SafeLinks
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const attr of Object.keys(attribs)) {
      if (/^data-safe/i.test(attr) || /^data-auth/i.test(attr) || /^data-linkindex/i.test(attr)) {
        $a.removeAttr(attr);
      }
    }
  });

  // Remove empty elements and artifacts
  $('span:empty').remove();
  $('div:empty').remove();

  // Remove data- attributes that leak as visible text (e.g., "false,false,1")
  $('[data-olk-copy-source]').removeAttr('data-olk-copy-source');

  // Remove ExternalClass wrapper divs (Outlook artifact)
  $('div[class^="ExternalClass"]').each((_, el) => {
    $(el).replaceWith($(el).html() ?? '');
  });

  // Preserve Canvas RTE-safe presentation values and remove unsupported CSS.
  convertStyledCallouts($);

  // For <img> tags, promote width/height CSS values to HTML attributes before stripping,
  // so the downstream image transformer (getDimension) can still read them.
  $('*').each((_, el) => {
    const $el = $(el);
    const tagName = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    const style = $el.attr('style') ?? '';

    if (tagName === 'img') {
      if (style) {
        for (const prop of ['width', 'height'] as const) {
          if (!$el.attr(prop)) {
            const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
            if (match) {
              const pxMatch = /^(\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(match[1].trim());
              if (pxMatch) {
                $el.attr(prop, pxMatch[1]);
              }
            }
          }
        }
      }
      $el.removeAttr('style');
    } else if (tagName === 'table') {
      const preserved = keepAllowedStyles(style, TABLE_STYLE_PROPERTIES);
      if (preserved) $el.attr('style', preserved);
      else $el.removeAttr('style');
    } else if (tagName === 'td' || tagName === 'th') {
      const preserved = keepAllowedStyles(style, CELL_STYLE_PROPERTIES);
      if (preserved) $el.attr('style', preserved);
      else $el.removeAttr('style');
    } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote'].includes(tagName)) {
      const preserved = keepAllowedStyles(style, BLOCK_STYLE_PROPERTIES);
      if (preserved) $el.attr('style', preserved);
      else $el.removeAttr('style');
    } else if (['span', 'a', 'em', 'strong', 'b', 'i', 'u', 's'].includes(tagName)) {
      const preserved = keepAllowedStyles(style, INLINE_STYLE_PROPERTIES);
      if (preserved) $el.attr('style', preserved);
      else $el.removeAttr('style');
    } else {
      $el.removeAttr('style');
    }
  });

  // Re-apply CTA button styling (after global style strip)
  $('a[data-cta]').each((_, el) => {
    $(el).attr('style', 'background-color:#0078d4;color:white;padding:10px 28px;border-radius:4px;text-decoration:none;font-weight:600;display:inline-block;font-size:14px;');
    $(el).removeAttr('data-cta');
  });

  // Remove Outlook email x_ class artifacts from all elements
  $('[class*="x_"]').each((_, el) => {
    const cls = $(el).attr('class') ?? '';
    const cleaned = cls.split(/\s+/).filter(c => !c.startsWith('x_')).join(' ');
    if (cleaned) $(el).attr('class', cleaned);
    else $(el).removeAttr('class');
  });

  // Remove class attributes from content elements, but preserve ms-rte* classes
  $('p, span, div, h1, h2, h3, h4, a, strong, em, b, i, ul, ol, li').each((_, el) => {
    const cls = $(el).attr('class') ?? '';
    const rteClasses = cls.split(/\s+/).filter(c => c.startsWith('ms-rte'));
    if (rteClasses.length > 0) {
      $(el).attr('class', rteClasses.join(' '));
    } else {
      $(el).removeAttr('class');
    }
  });

  // Clean up excessive whitespace
  let result = $.html()
    .replace(/(<br\s*\/?>){3,}/gi, '<br/><br/>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Remove any remaining "false,false,1" or similar data artifacts
  result = result.replace(/false,false,\d+/g, '');

  // Convert double <br> sequences to paragraph breaks
  result = result
    .replace(/<br\/>\n<br\/>/gi, '</p><p>')
    .replace(/<br><br>/gi, '</p><p>');

  return { html: result, hadScripts };
}

/** Legacy sanitizer — light-touch (scripts + event handlers only). Used by extract.ts. */
export function sanitizeHtml(html: string): { html: string; hadScripts: boolean } {
  const $ = cheerio.load(html, null, false);
  let hadScripts = false;
  const scripts = $('script');
  if (scripts.length > 0) { hadScripts = true; scripts.remove(); }
  $('style').remove();
  $('*').each((_, el) => {
    const element = $(el);
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const attr of Object.keys(attribs)) {
      if (EVENT_HANDLER_ATTRS.test(attr)) { hadScripts = true; element.removeAttr(attr); }
    }
  });
  return { html: $.html(), hadScripts };
}

/** Extract all link text+href pairs from HTML. */
export function extractLinks(html: string): { text: string; url: string }[] {
  const $ = cheerio.load(html, null, false);
  const links: { text: string; url: string }[] = [];

  $('a[href]').each((_, el) => {
    const $a = $(el);
    links.push({
      text: $a.text().trim(),
      url: $a.attr('href') ?? '',
    });
  });

  return links;
}

/** Detect if HTML contains a list of links (ul/ol whose children are mostly anchors). */
export function hasLinkListPattern(html: string): boolean {
  const $ = cheerio.load(html, null, false);

  for (const list of $('ul, ol').toArray()) {
    const $list = $(list);
    const items = $list.children('li');
    if (items.length === 0) continue;

    let linkCount = 0;
    items.each((_, li) => {
      if ($(li).find('a').length > 0) linkCount++;
    });

    if (linkCount / items.length >= 0.6) return true;
  }
  return false;
}
