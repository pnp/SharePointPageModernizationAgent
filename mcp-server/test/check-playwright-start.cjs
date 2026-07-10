/**
 * Best-effort startup check for the OPTIONAL playwright MCP server.
 *
 * Spawns `npx @playwright/mcp@latest` and performs an MCP "initialize"
 * handshake over stdio. Exits 0 if it responds, non-zero otherwise.
 *
 * This server is optional (the classic-to-modern server handles authenticated
 * screenshots on its own), and it requires Node.js 20+. setup.ps1 / setup.sh
 * run this as a non-fatal check, so a failure here only prints a warning.
 *
 * First run may take a while: npx downloads the package before it starts.
 */
'use strict';

const { spawn } = require('node:child_process');

const isWin = process.platform === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';
const TIMEOUT_MS = 120000;

const child = spawn(cmd, ['-y', '@playwright/mcp@latest'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: isWin, // resolve npx.cmd on Windows
});

let stdoutBuf = '';
let stderrBuf = '';
let settled = false;
let serverName = 'unknown';
let toolCount = null;

const timer = setTimeout(
  () => finish(false, `Timed out after ${TIMEOUT_MS / 1000}s (npx download or startup too slow).`),
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
    console.error(message);
    const reason = firstMeaningfulLine(stderrBuf);
    if (reason) console.error('Reason: ' + reason);
    process.exit(1);
  }
}

function firstMeaningfulLine(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

child.on('error', (err) => finish(false, 'Failed to launch playwright MCP: ' + err.message));
child.on('exit', (code) => {
  if (!settled) finish(false, `playwright MCP exited early (code ${code}).`);
});

child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

child.stdout.on('data', (d) => {
  stdoutBuf += d.toString();
  let nl;
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
      serverName = (msg.result.serverInfo || {}).name || 'unknown';
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
      `playwright MCP started OK (serverInfo.name="${serverName}"` +
      (toolCount !== null ? `, ${toolCount} tools registered).` : ').'),
    );
  }
}

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
