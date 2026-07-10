/**
 * Startup smoke check for the classic-to-modern MCP server.
 *
 * Spawns the server (start.cjs) and performs a real MCP "initialize" handshake
 * over stdio, then lists tools. Exits 0 if the server starts and responds like
 * a valid MCP server, non-zero otherwise. Used by setup.ps1 / setup.sh to
 * confirm the server can actually start before the user launches their AI host.
 *
 * Requires the project to be built first (dist/ must exist).
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER_ENTRY = path.join(__dirname, '..', 'start.cjs');
const TIMEOUT_MS = 20000;

const child = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuf = '';
let stderrBuf = '';
let settled = false;
let toolCount = null;

const timer = setTimeout(
  () => finish(false, `Timed out after ${TIMEOUT_MS / 1000}s waiting for the server to respond.`),
  TIMEOUT_MS,
);

function finish(ok, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try { child.kill(); } catch { /* ignore */ }
  if (ok) {
    console.log(message);
    process.exit(0);
  } else {
    console.error('MCP startup check FAILED: ' + message);
    if (stderrBuf.trim()) {
      console.error('--- server stderr ---');
      console.error(stderrBuf.trim());
    }
    process.exit(1);
  }
}

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

child.on('error', (err) => finish(false, 'Failed to launch server process: ' + err.message));
child.on('exit', (code) => {
  if (!settled) finish(false, `Server process exited early (code ${code}).`);
});

child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

child.stdout.on('data', (d) => {
  stdoutBuf += d.toString();
  let nl;
  // MCP stdio transport uses newline-delimited JSON — one message per line.
  while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handleMessage(msg);
  }
});

function handleMessage(msg) {
  if (msg.id === 1) {
    if (msg.error) {
      finish(false, 'initialize returned an error: ' + JSON.stringify(msg.error));
      return;
    }
    if (msg.result) {
      const info = msg.result.serverInfo || {};
      serverName = info.name || 'unknown';
      // Complete the handshake, then ask for the tool list.
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    }
    return;
  }
  if (msg.id === 2) {
    if (msg.result && Array.isArray(msg.result.tools)) {
      toolCount = msg.result.tools.length;
    }
    finish(
      true,
      `MCP server started OK (serverInfo.name="${serverName}"` +
      (toolCount !== null ? `, ${toolCount} tools registered).` : ').'),
    );
  }
}

let serverName = 'unknown';

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'setup-check', version: '1.0.0' },
  },
});
