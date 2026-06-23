import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export function registerComparisonSummaryTool(server: McpServer): void {
  server.tool(
    'get_comparison_summary',
    'Load all CIM files from a page-understanding site directory and return comparison scores and summaries. Use this after migration to produce a summary report without reading full CIM files.',
    {
      directory: z.string().describe('Absolute path to the page-understanding site directory (e.g., ./pageunderstanding/<site-name>)'),
    },
    async ({ directory }) => {
      try {
        const entries = await readdir(directory);
        const jsonFiles = entries.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'No JSON files found in directory', directory }, null, 2),
            }],
          };
        }

        const results: Array<{
          pageName: string;
          comparisonScore: number | null;
          comparisonSummary: string | null;
        }> = [];

        for (const file of jsonFiles) {
          const filePath = join(directory, file);
          try {
            const raw = await readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            results.push({
              pageName: file.replace(/\.json$/, ''),
              comparisonScore: data.comparisonScore ?? null,
              comparisonSummary: data.comparisonSummary ?? null,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to read CIM file ${file}`, { error: msg });
            results.push({
              pageName: file.replace(/\.json$/, ''),
              comparisonScore: null,
              comparisonSummary: `Error reading file: ${msg}`,
            });
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ directory, pages: results }, null, 2),
          }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('get_comparison_summary failed', { error: message });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: message }, null, 2),
          }],
        };
      }
    },
  );
}
