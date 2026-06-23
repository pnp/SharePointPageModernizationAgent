import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger.js';
import { closeBrowserContext } from './sharepoint/auth.js';

// Tool registrations
import { registerExtractTool } from './tools/extract.js';
import { registerCatalogTool } from './tools/catalog.js';
import { registerScreenshotTool } from './tools/screenshot.js';
import { registerLayoutTool } from './tools/layout.js';
import { registerCreatePageTool } from './tools/create.js';
import { registerUpdatePageTool } from './tools/update.js';
import { registerFindPageTool } from './tools/find.js';
import { registerCompareTool } from './tools/compare.js';
import { registerAssetTools } from './tools/assets.js';
import { registerListPagesTool } from './tools/list.js';
import { registerComparisonSummaryTool } from './tools/comparison-summary.js';
import { registerResolveListTool } from './tools/resolve-list.js';

// Builder registrations
import { registerBuildTextTool } from './tools/builders/text.js';
import { registerBuildQuickLinksTool } from './tools/builders/quick-links.js';
import { registerBuildImageTool } from './tools/builders/image.js';
import { registerBuildEmbedTool } from './tools/builders/embed.js';
import { registerBuildDividerTool } from './tools/builders/divider.js';
import { registerBuildAnyWebPartTool } from './tools/builders/any.js';
import { registerBuildVideoTool } from './tools/builders/video.js';

const server = new McpServer({
  name: 'classic-to-modern',
  version: '0.1.0',
});

// Register all tools
registerExtractTool(server);
registerCatalogTool(server);
registerScreenshotTool(server);
registerLayoutTool(server);
registerCreatePageTool(server);
registerUpdatePageTool(server);
registerFindPageTool(server);
registerCompareTool(server);
registerAssetTools(server);
registerListPagesTool(server);
registerComparisonSummaryTool(server);
registerResolveListTool(server);

// Register builder tools
registerBuildTextTool(server);
registerBuildQuickLinksTool(server);
registerBuildImageTool(server);
registerBuildEmbedTool(server);
registerBuildDividerTool(server);
registerBuildAnyWebPartTool(server);
registerBuildVideoTool(server);

logger.info('Starting classic-to-modern MCP server');

const transport = new StdioServerTransport();
await server.connect(transport);

async function cleanup() {
  logger.info('Shutting down MCP server, closing browser context');
  await closeBrowserContext();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
