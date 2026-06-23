/** Simple structured logger that writes to stderr (stdout is reserved for MCP transport). */
export const logger = {
  info: (msg: string, data?: unknown) => console.error(`[INFO] ${msg}`, data ?? ''),
  warn: (msg: string, data?: unknown) => console.error(`[WARN] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data ?? ''),
};
