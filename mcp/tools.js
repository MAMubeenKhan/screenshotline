/**
 * The two MCP tools and their handler, shared by both ways of serving them:
 * mcp/server.js over stdio, and the hosted endpoint at /mcp in src/index.js.
 * One definition, so the local bridge and the hosted server cannot drift.
 *
 * The capture(params) function is injected: it renders, or proxies to an API that does,
 * and returns { buffer, contentType, status, blankSuspected, extracted? }.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export const VERSION = '0.1.0';

export const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Prepend the document title, unless the page already opens with it. Most
 * article pages start with an <h1> that IS the title, and emitting both makes
 * the model believe it is looking at two different things.
 */
export function withTitle(title, markdown) {
  if (!title) return markdown;
  const firstHeading = markdown.match(/^#{1,6}\s+(.+)$/m);
  const norm = (s) => s.replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
  if (firstHeading && norm(firstHeading[1]) === norm(title)) return markdown;
  return '# ' + title + '\n\n' + markdown;
}

export const TOOLS = [
  {
    name: 'screenshot',
    description:
      'Capture a screenshot of a web page and return it as an image. Handles consent banners, ads, lazy-loaded images and late-rendering SPAs. Use this when the layout, styling or visual appearance is what matters; use read_page when you only need the text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to capture. Must be http or https.' },
        full_page: {
          type: 'boolean',
          description: 'Capture the entire scrollable page rather than just the viewport.',
        },
        viewport_width: { type: 'number', description: 'Viewport width in pixels. Default 1280.' },
        viewport_height: { type: 'number', description: 'Viewport height in pixels. Default 800.' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Default png.' },
        selector: { type: 'string', description: 'Capture only the element matching this CSS selector.' },
        color_scheme: { type: 'string', enum: ['light', 'dark'], description: 'Render the page in light or dark mode.' },
        block_ads: { type: 'boolean', description: 'Block ad networks and collapse the empty slots. Default true.' },
        block_cookie_banners: { type: 'boolean', description: 'Remove consent banners. Default true.' },
        block_chats: { type: 'boolean', description: 'Remove live-chat widgets. Default true.' },
        block_popups: { type: 'boolean', description: 'Remove newsletter and donation interstitials. Default true.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'read_page',
    description:
      'Render a web page and return its content as clean Markdown. The page is fully rendered first - JavaScript executed, consent banners dismissed, lazy images loaded - so this works on sites that return nothing useful to a plain HTTP fetch. Prefer this over screenshot when you need to read or reason about the text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to read. Must be http or https.' },
        max_chars: {
          type: 'number',
          description: 'Truncate the Markdown to this many characters. 0 or omitted means no limit.',
        },
        strip_chrome: {
          type: 'boolean',
          description:
            'Drop navigation, headers, footers and sidebars, keeping the main content. Default true. Set false for a full transcript of the page.',
        },
        block_cookie_banners: { type: 'boolean', description: 'Remove consent banners. Default true.' },
        block_chats: { type: 'boolean', description: 'Remove live-chat widgets. Default true.' },
        block_popups: { type: 'boolean', description: 'Remove newsletter and donation interstitials. Default true.' },
      },
      required: ['url'],
    },
  },
];


/** Run one tool call. Errors come back as tool results, never as throws. */
export async function callTool(name, args = {}, capture) {

  try {
    if (name === 'screenshot') {
      const format = args.format || 'png';
      const result = await capture({
        url: args.url,
        format,
        full_page: args.full_page,
        viewport_width: args.viewport_width,
        viewport_height: args.viewport_height,
        selector: args.selector,
        color_scheme: args.color_scheme,
        // Blocking defaults ON here, unlike the HTTP API. An agent asking for
        // a screenshot wants the page, not the consent wall in front of it.
        block_ads: args.block_ads !== false,
        block_cookie_banners: args.block_cookie_banners !== false,
        block_chats: args.block_chats !== false,
        block_popups: args.block_popups !== false,
      });

      const content = [
        {
          type: 'image',
          data: result.buffer.toString('base64'),
          mimeType: MIME[format] || 'image/png',
        },
      ];
      // Say so rather than returning a blank frame and letting the model
      // narrate an empty picture as though it were the page.
      if (result.blankSuspected) {
        content.push({
          type: 'text',
          text: `Warning: this capture appears to be blank. The page is most likely a bot wall or requires JavaScript that was blocked. Upstream HTTP status was ${result.status}.`,
        });
      }
      return { content };
    }

    if (name === 'read_page') {
      const result = await capture({
        url: args.url,
        extract: true,
        max_chars: args.max_chars,
        strip_chrome: args.strip_chrome === undefined ? undefined : args.strip_chrome,
        block_ads: true,
        block_cookie_banners: args.block_cookie_banners !== false,
        block_chats: args.block_chats !== false,
        block_popups: args.block_popups !== false,
      });
      const markdown = result.extracted
        ? result.extracted.markdown
        : result.buffer.toString('utf8');
      const title = result.extracted?.title;
      return {
        content: [
          {
            type: 'text',
            text: markdown.trim()
              ? withTitle(title, markdown)
              : 'The page rendered no readable text. It is most likely a bot wall, or its content is inside a closed shadow root or a cross-origin frame.',
          },
        ],
      };
    }

    throw new Error(`Unknown tool "${name}".`);
  } catch (err) {
    // Errors come back as tool results, not protocol errors: the model can act
    // on "that host refused the connection", but a transport fault just looks
    // like the tool is broken.
    return {
      isError: true,
      content: [{ type: 'text', text: String(err?.message || err) }],
    };
  }
}

/**
 * A capture function that asks a Screenshotline API to do the rendering.
 *
 * Used by the stdio bridge (against the hosted API or a self-hosted one) and
 * by the hosted /mcp endpoint, which calls its own /take over loopback so that
 * keys, quota, free-tier fences and metering are exactly the HTTP API's.
 * The key travels as a header, never in the query string, so it stays out of
 * access logs.
 */
export function httpCapture({ baseUrl, key = '', needKey = '', via = '' }) {
  return async (params) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
    );
    const path = params.extract ? 'extract' : 'take';
    const headers = {};
    if (key) headers['X-Access-Key'] = key;
    // Tells the API's analytics which door this came through. Nothing else.
    if (via) headers['X-Via'] = via;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/${path}?${query}`, { headers });
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      let message = body.toString('utf8').slice(0, 500);
      try {
        message = JSON.parse(message).error?.message || message;
      } catch {
        /* not JSON - use the raw body */
      }
      // The first thing every new install hits. Say what to do in terms of
      // the MCP configuration, not the HTTP API's ?access_key= advice.
      if (res.status === 401 && !key && needKey) message = needKey;
      throw new Error(message);
    }
    return {
      buffer: body,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      status: Number(res.headers.get('x-upstream-status')) || 0,
      blankSuspected: res.headers.get('x-blank-suspected') === 'true',
    };
  };
}

/** A fresh MCP server wired to a capture function. */
export function createServer(capture) {
  const server = new Server(
    { name: 'screenshotline', version: VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(request.params.name, request.params.arguments || {}, capture),
  );
  return server;
}
