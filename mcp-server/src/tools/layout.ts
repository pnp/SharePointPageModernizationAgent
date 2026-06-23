import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SectionLayout, GA_WHITELIST } from '../types/modern.js';

const LAYOUT_WIDTHS: Record<SectionLayout, number[]> = {
  oneColumn: [12],
  twoColumns: [6, 6],
  threeColumns: [4, 4, 4],
  oneThirdLeftColumn: [4, 8],
  oneThirdRightColumn: [8, 4],
  fullWidth: [0],
};

const LAYOUT_COLUMN_COUNT: Record<SectionLayout, number> = {
  oneColumn: 1,
  twoColumns: 2,
  threeColumns: 3,
  oneThirdLeftColumn: 2,
  oneThirdRightColumn: 2,
  fullWidth: 1,
};

export function registerLayoutTool(server: McpServer): void {
  server.tool(
    'build_canvas_layout',
    'Build a modern page canvas layout (sections and columns) from a layout descriptor. Returns the canvasLayout JSON for Graph API.',
    {
      sections: z.array(
        z.object({
          layout: z.enum(['oneColumn', 'twoColumns', 'threeColumns', 'oneThirdLeftColumn', 'oneThirdRightColumn', 'fullWidth']).describe('Section layout type'),
          emphasis: z.enum(['none', 'neutral', 'soft', 'strong']).default('none').describe('Section background emphasis'),
          columns: z.array(
            z.object({
              webparts: z.array(z.any()).describe('Array of web part objects from build_* tools'),
            }),
          ).describe('Columns with their web parts'),
        }),
      ).describe('Array of section descriptors defining the page layout'),
    },
    async ({ sections }) => {
      const warnings: string[] = [];
      let totalWebParts = 0;

      const horizontalSections = sections.map((section, sIdx) => {
        const expectedCount = LAYOUT_COLUMN_COUNT[section.layout];
        const widths = LAYOUT_WIDTHS[section.layout];
        let columns = section.columns;

        // Validate column count
        if (columns.length !== expectedCount) {
          if (columns.length > expectedCount) {
            warnings.push(
              `Section ${sIdx + 1}: layout '${section.layout}' expects ${expectedCount} column(s) but got ${columns.length}. Truncating to first ${expectedCount}.`,
            );
            columns = columns.slice(0, expectedCount);
          } else {
            warnings.push(
              `Section ${sIdx + 1}: layout '${section.layout}' expects ${expectedCount} column(s) but got ${columns.length}. Adding empty column(s).`,
            );
            while (columns.length < expectedCount) {
              columns = [...columns, { webparts: [] }];
            }
          }
        }

        const builtColumns = columns.map((col, cIdx) => {
          // Scan web parts for GA_WHITELIST compliance
          for (const wp of col.webparts) {
            if (
              wp &&
              wp.webPartType &&
              !GA_WHITELIST.includes(wp.webPartType)
            ) {
              warnings.push(
                `Section ${sIdx + 1}, Column ${cIdx + 1}: web part type '${wp.webPartType}' is not in the GA whitelist.`,
              );
            }
          }

          totalWebParts += col.webparts.length;

          return {
            id: String(cIdx + 1),
            width: widths[cIdx],
            webparts: col.webparts,
          };
        });

        return {
          layout: section.layout,
          emphasis: section.emphasis,
          columns: builtColumns,
        };
      });

      const result = {
        canvasLayout: { horizontalSections },
        validation: {
          valid: warnings.length === 0,
          warnings,
          sectionCount: horizontalSections.length,
          totalWebParts,
        },
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
