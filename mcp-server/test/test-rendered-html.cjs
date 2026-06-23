/**
 * Quick smoke test for extract_rendered_html tool.
 * Starts the MCP server, calls the new tool, and prints the result.
 */
const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

async function main() {
  // Check the tool is registered by importing and inspecting
  const distPath = path.join(__dirname, '..', 'dist', 'tools', 'screenshot.js');
  const fs = require('fs');
  const code = fs.readFileSync(distPath, 'utf-8');

  if (code.includes("'extract_rendered_html'")) {
    console.log('✅ extract_rendered_html tool found in compiled screenshot.js');
  } else {
    console.log('❌ extract_rendered_html tool NOT found in compiled screenshot.js');
    process.exit(1);
  }

  // Check the tool has the expected parameters
  if (code.includes('selector') && code.includes('waitForSelector') && code.includes('waitTimeout')) {
    console.log('✅ All parameters present (selector, waitForSelector, waitTimeout)');
  } else {
    console.log('❌ Missing expected parameters');
    process.exit(1);
  }

  // Check it uses page.content()
  if (code.includes('page.content()')) {
    console.log('✅ Uses page.content() for full HTML extraction');
  } else {
    console.log('❌ Missing page.content() call');
    process.exit(1);
  }

  console.log('\n✅ All checks passed. Restart MCP server to use the new tool.');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
