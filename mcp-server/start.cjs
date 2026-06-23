// Wrapper to launch MCP server with Node 18 File polyfill
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
}

async function main() {
  await import('./dist/index.js');
}
main();
