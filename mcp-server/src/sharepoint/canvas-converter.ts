/**
 * Convert hierarchical canvasLayout (sections/columns/webparts)
 * to SharePoint REST API CanvasContent1 format (flat JSON array of controls).
 *
 * Input format (from MCP tool builders):
 *   canvasLayout.horizontalSections[].columns[].webparts[]
 *   - TextWebPart: { @odata.type: "#microsoft.graph.textWebPart", innerHtml }
 *   - StandardWebPart: { webPartType, data: { properties, serverProcessedContent } }
 *   - serverProcessedContent uses [{key,value}] arrays
 *
 * REST CanvasContent1 format:
 *   JSON array string of controls:
 *   - Text: { controlType: 4, innerHTML, position }
 *   - WebPart: { controlType: 3, webPartId, webPartData, position }
 *   - serverProcessedContent uses {key: value} objects
 *   - position: { zoneIndex, sectionIndex, controlIndex, sectionFactor, zoneEmphasis }
 */
import { randomUUID } from 'node:crypto';

// ── Input types (hierarchical canvas layout) ──

interface WebPartInput {
  '@odata.type'?: string;
  innerHtml?: string;
  webPartType?: string;
  data?: {
    dataVersion?: string;
    title?: string;
    properties?: Record<string, unknown>;
    serverProcessedContent?: Record<string, unknown>;
  };
}

interface ColumnInput {
  id?: string;
  width?: number;
  webparts: WebPartInput[];
}

interface SectionInput {
  layout: string;
  emphasis?: string;
  columns: ColumnInput[];
}

export interface CanvasLayout {
  horizontalSections: SectionInput[];
}

// ── Output types (REST format) ──

interface ControlPosition {
  zoneIndex: number;
  sectionIndex: number;
  controlIndex: number;
  sectionFactor: number;
  zoneEmphasis: number;
}

interface RestControl {
  controlType: number;
  id: string;
  position: ControlPosition;
  innerHTML?: string;
  webPartId?: string;
  webPartData?: Record<string, unknown>;
  addedFromPersistedData?: boolean;
}

// ── Mapping tables ──

const EMPHASIS_MAP: Record<string, number> = {
  none: 0,
  neutral: 1,
  soft: 2,
  strong: 3,
};

/** Column widths (sectionFactor values) for each section layout type. */
const SECTION_FACTORS: Record<string, number[]> = {
  oneColumn: [12],
  twoColumns: [6, 6],
  threeColumns: [4, 4, 4],
  oneThirdLeftColumn: [4, 8],
  oneThirdRightColumn: [8, 4],
  fullWidth: [0],
};

// ── Helpers ──

/**
 * Convert serverProcessedContent [{key, value}] arrays to REST {key: value} objects.
 */
function kvArrayToObject(arr: unknown): Record<string, unknown> | undefined {
  if (!arr) return undefined;
  if (!Array.isArray(arr)) return arr as Record<string, unknown>;
  const obj: Record<string, unknown> = {};
  for (const item of arr) {
    if (item && typeof item === 'object' && 'key' in item && 'value' in item) {
      obj[(item as { key: string }).key] = (item as { value: unknown }).value;
    }
  }
  return obj;
}

function convertServerProcessedContent(
  spc: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!spc) return undefined;

  const result: Record<string, unknown> = {};
  for (const key of ['htmlStrings', 'searchablePlainTexts', 'imageSources', 'links']) {
    const val = spc[key];
    if (val !== undefined) {
      result[key] = kvArrayToObject(val);
    }
  }
  // customMetadata has a different structure — preserve as-is
  if (spc.customMetadata) {
    result.customMetadata = spc.customMetadata;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ── Main converter ──

/**
 * Convert a hierarchical canvasLayout to a CanvasContent1 JSON string
 * suitable for the SharePoint REST API SavePage endpoint.
 */
export function canvasLayoutToCanvasContent1(layout: CanvasLayout): string {
  const controls: RestControl[] = [];

  for (let sectionIdx = 0; sectionIdx < layout.horizontalSections.length; sectionIdx++) {
    const section = layout.horizontalSections[sectionIdx];
    const zoneIndex = sectionIdx + 1;
    const zoneEmphasis = EMPHASIS_MAP[section.emphasis || 'none'] ?? 0;
    const factors = SECTION_FACTORS[section.layout] || [12];

    for (let colIdx = 0; colIdx < section.columns.length; colIdx++) {
      const column = section.columns[colIdx];
      const sectionIndex = colIdx + 1;
      const sectionFactor = factors[colIdx] ?? 12;

      for (let wpIdx = 0; wpIdx < column.webparts.length; wpIdx++) {
        const wp = column.webparts[wpIdx];
        const controlIndex = wpIdx + 1;
        const id = randomUUID();

        const position: ControlPosition = {
          zoneIndex,
          sectionIndex,
          controlIndex,
          sectionFactor,
          zoneEmphasis,
        };

        if (wp['@odata.type'] === '#microsoft.graph.textWebPart' || (wp.innerHtml !== undefined && !wp.webPartType)) {
          // Text web part → controlType 4
          controls.push({
            controlType: 4,
            id,
            position,
            innerHTML: wp.innerHtml || '',
            addedFromPersistedData: true,
          });
        } else if (wp.webPartType) {
          // Standard web part → controlType 3
          const data = wp.data;
          const restSpc = convertServerProcessedContent(
            data?.serverProcessedContent as Record<string, unknown> | undefined,
          );

          const webPartData: Record<string, unknown> = {
            id: wp.webPartType,
            instanceId: id,
            title: data?.title || '',
            description: '',
            dataVersion: data?.dataVersion || '1.0',
            properties: data?.properties || {},
          };

          if (restSpc) {
            webPartData.serverProcessedContent = restSpc;
          }

          controls.push({
            controlType: 3,
            id,
            position,
            webPartId: wp.webPartType,
            webPartData,
            addedFromPersistedData: true,
          });
        }
      }
    }
  }

  return JSON.stringify(controls);
}
