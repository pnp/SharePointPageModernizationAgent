# High-Fidelity Tile Migration for Classic-to-Modern SharePoint Pages

## Problem
Classic SharePoint pages with navigation tiles (icon + label + link) don't map cleanly to modern Quick Links web parts because:
1. Quick Links don't support custom tile images in the same visual style
2. Need to preserve both the visual design (icons, colors, layout) and functionality (links)

## Solution: HTML Table Tiles in Text Web Parts

Use `build_text_webpart` with carefully structured HTML tables to recreate tile layouts with full fidelity.

## Critical Implementation Rules

### 0. **Match the Classic Layout (CRITICAL)**
Always match the classic page's **tile-per-row count**. Do NOT split tiles into fewer columns per row unless the images are too large for the cell width. Check the classic rendering (screenshot or `extract_rendered_html`) to determine the original layout:
- Classic has 4 tiles per row → use 4 `<td>` at `width:25%`
- Classic has 5 tiles per row → use 5 `<td>` at `width:20%`
- Classic has 3 tiles per row → use 3 `<td>` at `width:33.33%`

If the classic has N tiles total in a single row, use the same N. If tiles span multiple rows, replicate the same row structure with empty `<td>` cells for padding.

### 1. **Image-Link Structure (CRITICAL)**
Images must **NOT** be direct children of `<a>` tags. The HTML transform pipeline skips img-inside-link to avoid converting decorative navigation icons.

**❌ Wrong:**
```html
<a href="..."><img src="..." /></a>
```

**✅ Correct (for small icons ≤120px):**
```html
<img src="..." style="width:120px;height:120px;">
<br>
<a href="..."><strong>Label</strong></a>
```

**Why:** The `transformImageTags()` function in `html-transformator.ts` checks if an img's parent is `<a>` and skips conversion:
```typescript
const parentTag = ($img.parent()[0] as unknown as { tagName?: string })?.tagName?.toLowerCase();
if (parentTag === 'a') return;
```

Images inside links stay as raw `<img>` tags, which don't render reliably in modern pages. By making them siblings, the img gets converted to `<div class="imagePlugin">` format.

### 1a. **Bypass imagePlugin for Large Tile Images (CRITICAL)**
The `imagePlugin` renderer applies `object-fit: cover` CSS that **crops** images when the container is smaller than the image. For large tile images (>200px), bypass imagePlugin entirely by using raw `<img>` tags with `width="100%"`.

**Do NOT** pass through `build_text_webpart` — construct the text web part JSON manually:
```json
{
  "@odata.type": "#microsoft.graph.textWebPart",
  "innerHtml": "<table style=\"width:100%\"><tbody><tr><td style=\"text-align:center;width:25%;padding:10px;border:none\"><img src=\"/sites/.../image.png\" alt=\"...\" width=\"100%\"><br><a href=\"...\"><strong>Label</strong></a></td>...</tr></tbody></table>"
}
```

**Key**: `width="100%"` makes the image scale to fill the cell while preserving aspect ratio — no cropping. The images won't get imagePlugin editing controls, but they render correctly.

**When to use raw `<img>` vs imagePlugin:**
- **Small icons (≤120px)**: Use `build_text_webpart` → imagePlugin conversion (no cropping at small sizes)
- **Large tile images (>200px)**: Use raw `<img width="100%">` → bypass imagePlugin (prevents cropping)

### 2. **Cross-Site Image Paths**
For images from a different site (e.g., publishing site → team site):
- Use server-relative paths: `/sites/team-a/PublishingImages/icon.png`
- **Do NOT pass `sourceUrl`** parameter to `build_text_webpart`
- The transform pipeline converts `<img>` to `div.imagePlugin` with `data-imageurl`
- SharePoint resolves server-relative URLs tenant-wide

**Example:**
```javascript
const tileHtml = `<img src="/sites/team-a/PublishingImages/icon.png" alt="Icon" style="width:120px;height:120px;">`;
const tileWp = await mcp.callTool('build_text_webpart', {
  innerHtml: tileHtml
  // NO sourceUrl parameter
});
```

### 3. **Table Styling**

#### Full-width tiles filling the section:
```html
<table style="border-collapse:collapse;border:none;width:100%;">
<tr>
  <td style="text-align:center;padding:20px;border:none;width:20%;">
    <!-- 5 tiles = 20% each -->
  </td>
  <!-- Repeat 4 more times -->
</tr>
</table>
```

#### Colored-background tiles (e.g., for a top-level navigation row):
```html
<td style="text-align:center;padding:20px;background-color:#0078d4;color:white;border:none;width:20%;">
  <img src="/sites/team-a/PublishingImages/icon.png" alt="Team A" style="width:120px;height:120px;">
  <br>
  <a href="https://contoso.sharepoint.com/sites/team-a" style="color:white;text-decoration:none;">
    <strong style="font-size:1.2em;">Team A</strong>
  </a>
  <br>
  <span style="font-size:0.9em;">Short description of the section</span>
</td>
```

#### Default-background tiles (e.g., for a secondary set of links):
```html
<td style="text-align:center;padding:20px;border:none;width:20%;">
  <img src="/sites/team-a/PublishingImages/icon.png" alt="Resources" style="width:120px;height:120px;">
  <br>
  <a href="https://contoso.sharepoint.com/sites/resources" style="text-decoration:none;">
    <strong style="font-size:1.2em;">Resources</strong>
  </a>
</td>
```

### 4. **Sizing Guidelines**
- **Images**: Always use the **actual source image file pixel dimensions** for `style="width:Xpx;height:Ypx"`. Do NOT use the classic page's CSS width/height — the classic CSS may downscale (e.g., CSS says 250px but file is 375px). Using smaller values causes cropping and content loss. To check actual dimensions: navigate to the image URL directly in the Playwright browser, or append `?width=9999` to get the original size. The sanitizer promotes CSS dimensions to HTML attributes, then the transformator sets `data-imagenaturalwidth`/`height`.
- **Cell padding**: 20px for spacious layout (10px for compact)
- **Cell width**:
  - 5 tiles: `width:20%` each
  - 4 tiles: `width:25%` each
  - 3 tiles: `width:33.33%` each
- **Table width**: `width:100%` to fill section (CRITICAL — without this, table auto-sizes to content)
- **Font sizes**:
  - Labels: `font-size:1.2em` (larger, prominent)
  - Descriptions: `font-size:0.9em` (smaller, secondary)


### 5. **White Icons on Colored Backgrounds**
If tile icons are white PNGs (common for icon libraries):
- Add `background-color:#0078d4` (Microsoft blue) or other contrasting color to `<td>`
- Set `color:white` on `<td>` for text
- Set `style="color:white;"` on `<a>` links to override default link colors
- Use `text-decoration:none` to remove underlines

**Example:**
```html
<td style="text-align:center;padding:20px;background-color:#0078d4;color:white;border:none;width:20%;">
  <img src="/sites/team-a/PublishingImages/white-icon.png" alt="Icon" style="width:120px;height:120px;">
  <br>
  <a href="..." style="color:white;text-decoration:none;">
    <strong style="font-size:1.2em;">Label</strong>
  </a>
  <br>
  <span style="font-size:0.9em;">Description</span>
</td>
```

## Transform Pipeline Behavior

### The `build_text_webpart` tool triggers:
1. **`cleanWikiHtml()`**: Strips scripts, layout tables, SafeLinks
2. **`transformHtml()`**:
   - Converts `<img>` (not in `<a>`) → `<div class="imagePlugin">` with `data-imageurl`
   - Shifts headings (h1→h2, since modern pages reserve h1 for page title)
   - Modernizes tables (responsive wrappers, class mapping)
   - Maps RTE classes for fonts/colors

### Image Conversion Details
Located in `mcp-server/src/utils/html-transformator.ts`:

```typescript
function transformImageTags($: CheerioAPI, sourceUrl?: string): void {
  $('img').each((_, el) => {
    const $img = $(el);

    // Skip images inside links — they are usually icons for link styling
    const parentTag = ($img.parent()[0] as unknown as { tagName?: string })?.tagName?.toLowerCase();
    if (parentTag === 'a') return;

    const src = resolveImageUrl($img.attr('src') ?? '', sourceUrl);
    // ... builds <div class="imagePlugin"> with data-imageurl, data-alttext, etc.
  });
}
```

**Images inside `<a>` are left as raw `<img>` tags** — this is intentional for decorative link icons, but doesn't render reliably in modern pages. Always structure tiles with image and link as siblings.

## Comparison Tool Improvements

`mcp-server/src/tools/compare.ts` handles tile migrations intelligently:

### 1. Heading-to-Link Matching
Before penalizing a "missing" heading, the comparison checks if the heading text appears as a link title in the modern page (e.g., Quick Links tile labels). If found, it counts as `matchedViaLinks` instead of `missingInModern` — **no score penalty**.

```typescript
// Build a set of modern link texts for Quick Links cross-check
const modernLinkTexts = new Set(modern.links.map(l => l.text.toLowerCase().trim()));
const matchedViaLinks: string[] = [];

for (const ch of classic.headings) {
  const chLower = ch.text.toLowerCase().trim();
  // Try exact heading match first...
  if (foundIdx >= 0) {
    matched.push(ch.text);
  } else if (modernLinkTexts.has(chLower)) {
    // Heading text appears as a link title — valid tile conversion
    matchedViaLinks.push(ch.text);
  } else {
    missingInModern.push(ch.text);
  }
}
```

### 2. Tile Icon Classification
Distinguishes decorative navigation icons from content images using heuristics:
- **Tile icon**: Small (≤200×200px), alt text matches link label, or filename contains link text
- **Content image**: Everything else

```typescript
const classicLinkTextsLower = new Set(classic.links.map(l => l.text.toLowerCase().trim()));
let tileIconCount = 0;
let contentImageMissing = 0;

for (const img of classic.images) {
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
```

### 3. Updated Scoring
```typescript
// Tile icons: -2 per image (minor, decorative)
// Content images: -10 per image (major content gap)
score -= contentImageMissing * 10;
score -= tileIconCount * 2;
```

**Results Interface:**
```typescript
headingComparison: {
  matched: string[];
  matchedViaLinks: string[];  // headings converted to tile labels
  missingInModern: string[];
}

imageComparison: {
  missing: number;
  tileIcons: number;          // decorative navigation icons
  contentImages: number;      // actual content images
}
```

## Example Comparison Results

### Before Improvements
```json
{
  "status": "SIGNIFICANT_GAPS",
  "contentCoverage": 0,
  "issues": [
    "Missing headings: Team A, Team B, ... (10 total)",
    "Missing images: 10 image(s)"
  ]
}
```

### After Improvements
```json
{
  "status": "OK",
  "contentCoverage": 80,
  "summary": "Migration looks good! 13/13 headings accounted for (10 as Quick Links tiles), 96% text coverage.",
  "headingComparison": {
    "matched": ["Welcome to the Hub", "Featured Dashboards", "Browse by Topic"],
    "matchedViaLinks": ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F", "Team G", "Team H", "Team I", "Team J"],
    "missingInModern": []
  },
  "imageComparison": {
    "missing": 10,
    "tileIcons": 10,
    "contentImages": 0
  },
  "suggestions": [
    "10 heading(s) converted to Quick Links tiles: Team A, Team B, ...",
    "10 tile icon(s) not carried over — these accompanied navigation links now handled by Quick Links"
  ]
}
```

## Complete Example: Navigation Tiles

```javascript
const tilesHtml = `<table style="border-collapse:collapse;border:none;width:100%;">
<tr>
<td style="text-align:center;padding:20px;background-color:#0078d4;color:white;border:none;width:20%;">
  <img src="/sites/team-a/PublishingImages/team-a-icon.png" alt="Team A" style="width:120px;height:120px;">
  <br>
  <a href="https://contoso.sharepoint.com/sites/team-a" style="color:white;text-decoration:none;">
    <strong style="font-size:1.2em;">Team A</strong>
  </a>
  <br>
  <span style="font-size:0.9em;">Short description of Team A's area</span>
</td>
<td style="text-align:center;padding:20px;background-color:#0078d4;color:white;border:none;width:20%;">
  <img src="/sites/team-b/PublishingImages/team-b-icon.png" alt="Team B" style="width:120px;height:120px;">
  <br>
  <a href="https://contoso.sharepoint.com/sites/team-b" style="color:white;text-decoration:none;">
    <strong style="font-size:1.2em;">Team B</strong>
  </a>
  <br>
  <span style="font-size:0.9em;">Short description of Team B's area</span>
</td>
<!-- Repeat for remaining tiles -->
</tr>
</table>`;

const tilesWp = await mcp.callTool('build_text_webpart', {
  innerHtml: tilesHtml
  // NO sourceUrl — keeps server-relative image paths
});
```

## File References
- **Comparison tool**: `mcp-server/src/tools/compare.ts`
- **HTML transformer**: `mcp-server/src/utils/html-transformator.ts`
- **Image transform logic**: `mcp-server/src/utils/html-transformator.ts` (search for `transformImageTags`)

## imagePlugin Dimension Rules (CRITICAL)

The `build_text_webpart` transform converts `<img>` tags to `<div class="imagePlugin">` with `data-imagenaturalwidth` and `data-imagenaturalheight` attributes. SharePoint renders these images at **exactly** the specified dimensions. Getting this wrong causes major visual issues.

### How dimensions are determined
The transform reads `width` and `height` from the `<img>` tag's `style` attribute:
- `style="width:300px;height:80px;"` → `data-imagenaturalwidth="300" data-imagenaturalheight="80"` ✅
- `style="width:120px;height:120px;"` on a wide image → squished/distorted ❌
- No style dimensions → `data-imagenaturalwidth="-1" data-imagenaturalheight="-1"` → renders as tiny thumbnail ❌

### Common mistakes

**❌ Unknown dimensions (-1):**
```html
<img src="..." alt="Banner">
<!-- No width/height → imagePlugin gets -1/-1 → tiny thumbnail -->
```

**❌ Wrong aspect ratio (square on wide image):**
```html
<img src="..." alt="Mobile App" style="width:120px;height:120px;">
<!-- App logo is 300x80 → gets squished into a square -->
```

**✅ Correct: match the actual aspect ratio:**
```html
<img src="..." alt="Banner" style="width:1297px;height:247px;">
<!-- Banner renders at proper wide format -->

<img src="..." alt="Mobile App" style="width:300px;height:80px;">
<!-- App logo renders at proper wide format -->
```

### How to determine image dimensions
1. **Check classic page HTML** for `width`/`height` attributes on `<img>` tags
2. **Check the classic screenshot** to visually estimate aspect ratio
3. **Common patterns:**
   - Banner images: typically 1000-1400px wide, 200-300px tall
   - App/product logos: typically 250-400px wide, 60-100px tall
   - Navigation tile icons: typically 60-120px square
   - Article images: check `width`/`height` attributes in source HTML
4. **When in doubt**: estimate wider-than-tall for logos/banners, square for icons

### Image web part dimensions
The Image web part (`build_image_webpart`) also benefits from `imgWidth`/`imgHeight` in properties:
```json
{
  "properties": {
    "imgWidth": 500,
    "imgHeight": 332
  }
}
```
Without these, the Image web part may render at an unexpected size.

## Key Takeaways
1. **Structure matters**: Images and links must be siblings, not parent-child
2. **Cross-site images**: Use server-relative paths, no sourceUrl parameter
3. **White icons**: Add colored backgrounds to make them visible
4. **Full-width tables**: Use `width:100%` on table, percentage widths on cells
5. **Comparison scoring**: Updated to recognize tile conversions as valid migrations, not content loss
6. **Image dimensions are critical**: Always specify `width` and `height` in `<img>` style attributes to ensure correct `imagePlugin` rendering. `-1` = tiny, wrong ratio = squished
