#!/usr/bin/env node
/**
 * MCP server for screenshotline.
 *
 * An agent that wants to know what a page says should not have to run OCR on
 * a PNG of a DOM we already rendered. This exposes both halves of the product
 * over the Model Context Protocol: the screenshot, for when the layout is the
 * answer, and the Markdown, for when the text is.
 *
 * Runs two ways, and picks by itself:
 *
 *   remote    Calls a running API over HTTP. This is the ONLY mode when it is
 *             installed from npm (`npx -y screenshotline-mcp`), because that
 *             package ships this one file and no renderer - downloading Chrome
 *             to call someone else's API would be absurd. It targets the hosted
 *             API unless SCREENSHOTLINE_BASE_URL points at your own instance.
 *   embedded  Run from a clone of the repo with no SCREENSHOTLINE_BASE_URL, and
 *             it owns its own browser pool instead. Nothing else to run.
 *
 * Usage:
 *   SCREENSHOTLINE_ACCESS_KEY=sl_live_... npx -y screenshotline-mcp
 *   node mcp/server.js                                   (from a clone)
 *   SCREENSHOTLINE_BASE_URL=http://localhost:3000 node mcp/server.js
 *
 * The protocol talks JSON-RPC over stdin/stdout, so NOTHING may be written to
 * stdout except protocol frames. Diagnostics go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, httpCapture } from './tools.js';

import fs from 'node:fs';

const HOSTED_API = 'https://api.screenshotline.com';
// The renderer sits next door only in a clone. The npm package ships this
// file alone, so there the renderer's modules must never be imported - they
// are loaded dynamically, and only in embedded mode.
const HAS_RENDERER = fs.existsSync(new URL('../src/render.js', import.meta.url));
const BASE_URL = process.env.SCREENSHOTLINE_BASE_URL || (HAS_RENDERER ? '' : HOSTED_API);
const ACCESS_KEY = process.env.SCREENSHOTLINE_ACCESS_KEY || '';

const NEED_KEY =
  'Set SCREENSHOTLINE_ACCESS_KEY in this MCP server\'s environment. A free key is 500 renders a month, no card: https://screenshotline.com/account';

/** Lazily created, so the remote mode never launches a browser. */
let pool = null;
async function localPool() {
  if (!pool) {
    const { BrowserPool } = await import('../src/browser-pool.js');
    // One browser by default. An agent makes one request at a time, and a
    // desktop MCP client should not quietly start four Chromiums.
    pool = new BrowserPool(Number(process.env.POOL_SIZE || 1));
  }
  return pool;
}

/**
 * One code path for both modes: build the same option set either way, then
 * either render it here or ask a running instance to.
 */
const remote = BASE_URL
  ? httpCapture({ baseUrl: BASE_URL, key: ACCESS_KEY, needKey: NEED_KEY, via: 'mcp-stdio' })
  : null;

async function capture(params) {
  if (remote) return remote(params);

  const { parseOptions } = await import('../src/options.js');
  const { render } = await import('../src/render.js');
  const options = parseOptions(params);
  const result = await render(await localPool(), options);
  return {
    buffer: result.buffer,
    contentType: result.contentType,
    status: result.status,
    blankSuspected: result.blankSuspected,
    extracted: result.extracted,
  };
}

const server = createServer(capture);

async function main() {
  if (!BASE_URL) {
    await (await localPool()).warm();
    console.error('screenshotline mcp: embedded browser pool ready');
  } else {
    console.error(`screenshotline mcp: proxying to ${BASE_URL}`);
    if (BASE_URL === HOSTED_API && !ACCESS_KEY) console.error(`screenshotline mcp: ${NEED_KEY}`);
  }
  await server.connect(new StdioServerTransport());
}

const shutdown = async () => {
  try {
    if (pool) await pool.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('screenshotline mcp failed to start:', err);
  process.exit(1);
});
