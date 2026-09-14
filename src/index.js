import express from 'express';
import config from './config.js';
import BrowserPool from './browser-pool.js';
import { parseOptions, OptionError } from './options.js';
import { render } from './render.js';
import { authenticate, AuthError } from './auth.js';
import * as cache from './cache.js';
import { UrlRejected } from './security.js';
import { landingPage } from './landing.js';
import { pricingPage } from './pricing.js';
import { termsPage } from './terms.js';
import { landingPageFor, PAGES as LANDING_PAGES } from './landing-pages.js';
import { comparePage, COMPARISONS } from './compare-pages.js';
import { blogIndex, blogPost, blogFeed, blogSitemapPaths } from './blog.js';
import { docsIndex, languagePage, extractPage } from './docs.js';
import * as billing from './billing.js';
import * as store from './store.js';
import * as usageIngest from './usage-ingest.js';
import { accountsRouter } from './accounts-api.js';
import { dashboardPage } from './dashboard.js';
import * as limits from './limits.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createMcpServer, httpCapture } from '../mcp/tools.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// The Polar webhook signature covers the exact bytes received, so that one
// route must NOT be JSON-parsed before it is verified. Everything else is.
const parseJson = express.json({ limit: '1mb' });
app.use((req, res, next) =>
  req.path === '/v1/webhooks/polar' ? next() : parseJson(req, res, next),
);

const pool = new BrowserPool();

// --- Rate limiting ----------------------------------------------------------
// Deliberately simple and in-process. In production this belongs at the edge
// gateway alongside key validation, so a rejected request never reaches an
// origin that could have been rendering something billable instead.
const buckets = new Map();
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);

// The public demo gets its own, much tighter bucket, keyed by IP.
// The plan: "Do not require a login to evaluate the product" - so /demo
// renders without a key. That makes it the one unauthenticated path that
// costs real CPU, so it is rationed far harder than the paid API.
const demoBuckets = new Map();
const DEMO_LIMIT_PER_MINUTE = Number(process.env.DEMO_LIMIT_PER_MINUTE || 5);
function demoRateLimit(ip) {
  const now = Date.now();
  const hits = (demoBuckets.get(ip) || []).filter((t) => t > now - 60_000);
  hits.push(now);
  demoBuckets.set(ip, hits);
  if (demoBuckets.size > 10_000) demoBuckets.clear();
  return hits.length <= DEMO_LIMIT_PER_MINUTE;
}

function rateLimit(identity) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (buckets.get(identity) || []).filter((t) => t > windowStart);
  hits.push(now);
  buckets.set(identity, hits);
  if (buckets.size > 10_000) buckets.clear();
  return hits.length <= RATE_LIMIT;
}

// --- Analytics: which door a request came through ---------------------------
// X-Via is set by the MCP bridges. 'mcp' is only believed from loopback -
// the socket address, not req.ip, which trust proxy lets a header spoof - so
// only the hosted /mcp endpoint can claim it. 'mcp-stdio' is the npm bridge
// calling in from outside; it is analytics only, so a spoof costs nothing.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function viaOf(req) {
  const via = String(req.headers['x-via'] || '');
  if (via === 'mcp') return LOOPBACK.has(req.socket?.remoteAddress) ? 'mcp' : null;
  if (via === 'mcp-stdio') return 'mcp-stdio';
  return null;
}

// --- Errors -----------------------------------------------------------------
function sendError(res, err) {
  const status = err.status || 500;
  const body = {
    error: {
      code: err.code || 'internal_error',
      message:
        status === 500
          ? 'Something went wrong on our side. If it persists, open an issue with the URL you used.'
          : err.message,
    },
  };
  if (status >= 500) console.error(`[${body.error.code}]`, err.message);
  res.status(status).type('application/json').send(JSON.stringify(body, null, 2));
}

// --- /take ------------------------------------------------------------------
async function take(req, res, force = {}) {
  const raw =
    req.method === 'POST'
      ? { ...req.body, ...force }
      : { ...req.query, ...force };

  // Declared outside the try: the catch meters the failure, and a quota
  // rejection throws from inside authorize itself.
  let account = null;
  // Only a request that actually reached the renderer can have failed one.
  // A bad parameter or an exhausted quota never cost us a browser.
  let attempted = false;

  // One analytics event per request, written when the response finishes, so
  // every exit - success, cache hit, rejection, error - is recorded exactly
  // once without touching each return path's logic. See store.recordEvent.
  const startedAt = Date.now();
  const ev = {
    endpoint: force.demo === 'true' ? 'demo' : force.extract === 'true' ? 'extract' : 'take',
    via: viaOf(req),
    outcome: 'rejected',
  };
  res.on('finish', () =>
    store.recordEvent({ ...ev, status: res.statusCode, ms: ev.ms ?? Date.now() - startedAt }),
  );

  try {
    const auth = authenticate(raw, req.headers);

    // Who is paying for this, and may they. Returns null when BILLING_ENABLED
    // is off, which is how a self-hosted deployment keeps the old behaviour.
    // The demo is the one path with no account behind it, by design.
    //
    // Read from `force`, NEVER from `raw`. raw is the caller's own query
    // string, so checking raw.demo let anyone append &demo=true to /take and
    // render with no key, no quota and none of the demo's own fences. That
    // was live in production until 2026-09-11.
    const isDemo = force.demo === 'true';
    account = isDemo ? null : billing.authorize(raw, req.headers);
    ev.account_id = account?.account.id ?? null;
    if (isDemo && config.billingEnabled) ev.visitor = store.visitorHash(req.ip);

    // Rate limiting is per-account when there is one: two customers behind
    // the same corporate NAT must not share a bucket.

    const identity = account?.account.id || auth.key || req.ip || 'anonymous';
    if (!rateLimit(identity)) {
      const err = new Error(`Rate limit of ${RATE_LIMIT} requests/minute exceeded.`);
      err.code = 'rate_limited';
      err.status = 429;
      throw err;
    }

    const options = parseOptions(raw);
    ev.domain = limits.targetDomain(options.url) || null;
    const key = cache.cacheKey(raw);

    if (options.cache) {
      const hit = await cache.get(key);
      if (hit) {
        ev.outcome = 'cached';
        billing.meter(account, 'cached');
        res.set({
          ...billing.usageHeaders(account),
          'Content-Type': hit.contentType,
          'X-Cache': 'HIT',
          'X-Cache-Key': key,
          'Cache-Control': `public, max-age=${options.cacheTtl}`,
        });
        return res.send(hit.buffer);
      }
    }

    // Free and demo traffic spend slot time a paying customer may be about to
    // need, so they are fenced here - after the cache, because a hit costs no
    // browser - and queue behind paid requests in the pool. See limits.js.
    const free = isDemo || account?.account.plan === 'free';
    // Who is spending the free budget: a free key, or one visitor on the demo.
    const caller = !free ? '' : isDemo ? `demo:${req.ip}` : `acct:${account.account.id}`;
    if (free) limits.checkFreeRender(options.url, { caller });
    options.lowPriority = free;

    attempted = true;
    const renderStarted = Date.now();
    let result;
    try {
      result = await render(pool, options);
    } finally {
      // Failures are charged too: a render that ran to its timeout cost the
      // box more than a successful one, whoever it was billed to.
      if (free) limits.chargeFreeRender(Date.now() - renderStarted, Date.now(), caller);
    }

    // Extraction can come back as JSON when the caller wants the metadata
    // alongside the text. The default stays raw Markdown, because the point
    // of this endpoint is to be piped straight into a model.
    if (result.extracted && String(raw.response || '').toLowerCase() === 'json') {
      ev.outcome = 'render';
      ev.ms = result.renderMs;
      billing.meter(account, 'render');
      res.set({
        ...billing.usageHeaders(account),
        'X-Cache': 'BYPASS',
        'X-Render-Ms': String(result.renderMs),
        'X-Upstream-Status': String(result.status),
      });
      return res.type('application/json').send(
        JSON.stringify(
          {
            url: result.extracted.url,
            title: result.extracted.title,
            chars: result.extracted.chars,
            upstream_status: result.status,
            markdown: result.extracted.markdown,
          },
          null,
          2,
        ),
      );
    }

    if (options.cache) {
      await cache.set(key, result.buffer, {
        contentType: result.contentType,
        format: options.format,
        ttlSeconds: options.cacheTtl,
      });
    }

    const kind = billing.kindFor(account, result.blankSuspected);
    billing.meter(account, kind);
    ev.outcome = kind === 'render' ? 'render' : 'blank_unbilled';
    ev.ms = result.renderMs;
    res.set({
      ...billing.usageHeaders(account),
      // Whether this response counted, said on the response itself - a blank
      // capture past the monthly allowance is billed, and that should never
      // be a surprise on the invoice.
      ...(account ? { 'X-Billed': String(kind === 'render') } : {}),
      'Content-Type': result.contentType,
      'Content-Length': String(result.buffer.length),
      'X-Cache': options.cache ? 'MISS' : 'BYPASS',
      'X-Cache-Key': key,
      'X-Render-Ms': String(result.renderMs),
      'X-Upstream-Status': String(result.status),
      'X-Upstream-Content-Type': result.upstreamContentType || '',
      'X-Blocked-Requests': String(result.blocked.ads),
      // True when the page never went network-idle and we captured anyway.
      'X-Wait-Fallback': String(Boolean(result.waitFallback)),
      // True when the first attempt could not be captured and we fell back
      // to a no-settle retry. The image is real, just taken earlier.
      'X-Capture-Fallback': String(Boolean(result.captureFallback)),
      // Loud signals for the silent-failure case. A 200 with a blank image is
      // worse than an error, so at minimum say so in a header.
      'X-Blank-Suspected': String(Boolean(result.blankSuspected)),
      'X-Text-Length': String(result.content?.textLength ?? 0),
      'Cache-Control': options.cache
        ? `public, max-age=${options.cacheTtl}`
        : 'no-store',
    });
    return res.send(result.buffer);
  } catch (err) {
    // A render we could not deliver is not billable. This is the promise
    // most competitors make and cannot verify; blank detection is what lets
    // us honour it literally.
    if (attempted) billing.meter(account, 'failed');
    ev.outcome = attempted ? 'failed' : 'rejected';
    ev.code = err.code || 'internal_error';
    if (
      err instanceof OptionError ||
      err instanceof AuthError ||
      err instanceof UrlRejected ||
      err.status
    ) {
      return sendError(res, err);
    }
    return sendError(res, Object.assign(err, { status: 500 }));
  }
}

// --- Accounts and billing ---------------------------------------------------
// Mounted only when billing is on. A self-hosted deployment does not grow a
// signup form it never asked for.
if (config.billingEnabled) {
  store.open();
  // Keep the analytics log to its stated 90 days: at boot, then every 6 hours.
  const purge = () => {
    try {
      const n = store.purgeEvents();
      if (n) console.log(`[events] purged ${n} older than ${store.EVENT_RETENTION_DAYS} days`);
    } catch (err) {
      console.error('[events] purge failed:', err.message);
    }
  };
  purge();
  setInterval(purge, 6 * 3_600_000).unref();
  app.use(accountsRouter());
  app.get('/account', (req, res) => res.type('html').send(dashboardPage()));
}

// --- /demo ------------------------------------------------------------------
// The no-signup demo behind the landing page. Same renderer, no key, and
// deliberately fenced in: its own IP rate limit, a capped viewport, and no
// caching so it cannot be used as a free CDN. Never metered against anyone.
app.get('/demo', async (req, res) => {
  const ip = req.ip || 'anonymous';
  if (!demoRateLimit(ip)) {
    return sendError(res, Object.assign(new Error(
      `The demo allows ${DEMO_LIMIT_PER_MINUTE} captures a minute. Create a free account for 500 a month - no card required.`,
    ), { code: 'demo_rate_limited', status: 429 }));
  }
  return take(req, res, {
    // Forced, so the demo cannot be turned into an unmetered API.
    demo: 'true',
    cache: 'false',
    format: 'png',
    viewport_width: '1280',
    viewport_height: '800',
    device_scale_factor: '1',
    timeout: '20000',
  });
});

app.get('/take', take);
app.post('/take', take);

// --- /extract ---------------------------------------------------------------
// The same render, read instead of photographed. A model should not have to
// OCR a PNG of a DOM we already had.
const extract = (req, res) => take(req, res, { extract: 'true' });
app.get('/extract', extract);
app.post('/extract', extract);

// --- /mcp -------------------------------------------------------------------
// The same two tools as mcp/server.js, hosted: an agent connects by URL with
// nothing to install. Stateless Streamable HTTP - one fresh server per POST,
// JSON responses rather than an SSE stream, so nothing is held open behind
// the proxy.
//
// A tool call goes back through this process's own /take and /extract over
// loopback with the caller's key, so keys, quota, the free-tier fences,
// metering and rate limits are exactly the HTTP API's. There is no second
// implementation of billing to drift. Listing the tools needs no key, so
// clients and directories can discover them.
const MCP_NEED_KEY =
  `Add your API key to this MCP connection as an X-Access-Key header (or ?access_key= on the URL). A free key is ${store.PLANS.free.included} renders a month, no card: https://screenshotline.com/account`;

app.post('/mcp', async (req, res) => {
  const key =
    req.headers['x-access-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    req.query.access_key ||
    '';
  const capture = httpCapture({
    baseUrl: `http://127.0.0.1:${config.port}`,
    key,
    needKey: MCP_NEED_KEY,
    via: 'mcp',
  });
  // Protocol-level analytics: which MCP methods, from which account. The
  // renders themselves are recorded by /take, tagged via=mcp.
  const rpc = Array.isArray(req.body) ? req.body[0] : req.body;
  res.on('finish', () => {
    // A throw inside a 'finish' listener is an uncaught exception, and the
    // handler below exits on those. Analytics must never take the server down.
    let accountId = null;
    try {
      if (key && config.billingEnabled) accountId = store.resolveKey(key)?.id ?? null;
    } catch {
      /* unattributed is fine */
    }
    store.recordEvent({
      endpoint: 'mcp',
      outcome: typeof rpc?.method === 'string' ? rpc.method.slice(0, 40) : null,
      code: rpc?.method === 'tools/call' ? String(rpc.params?.name || '').slice(0, 40) : null,
      status: res.statusCode,
      account_id: accountId,
    });
  });
  const server = createMcpServer(capture);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

// Stateless: no SSE stream to open with GET, no session to DELETE.
const mcpPostOnly = (req, res) =>
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'This MCP endpoint is stateless: POST JSON-RPC to it. Setup: https://screenshotline.com/docs/extract' },
    id: null,
  });
app.get('/mcp', mcpPostOnly);
app.delete('/mcp', mcpPostOnly);

// --- Operational ------------------------------------------------------------
app.get('/healthz', (req, res) => {
  res.json({ ok: true, pool: pool.snapshot(), uptime: Math.round(process.uptime()) });
});

// Deep health: can we actually take a screenshot right now? /healthz only
// proves the process answers - it stays green with Chrome broken, which on a
// public status page is worse than no status page. This renders a real page.
//
// Fenced so it cannot be used as a free renderer or a load lever: at most one
// real render per minute (everyone else gets the last result), queued behind
// paying customers, never metered, and not counted as demo traffic.
let lastDeepCheck = null;
let deepCheckInFlight = null;
app.get('/healthz/render', async (req, res) => {
  const fresh = lastDeepCheck && Date.now() - lastDeepCheck.at < 60_000;
  if (!fresh) {
    deepCheckInFlight ||= (async () => {
      const t = Date.now();
      try {
        const options = parseOptions({ url: 'https://example.com', timeout: '20000' });
        options.lowPriority = true;
        const result = await render(pool, options);
        lastDeepCheck = { ok: result.buffer.length > 1000 && !result.blankSuspected, ms: Date.now() - t, at: Date.now() };
      } catch (err) {
        lastDeepCheck = { ok: false, ms: Date.now() - t, at: Date.now(), error: err.code || 'render_failed' };
      } finally {
        deepCheckInFlight = null;
      }
    })();
    await deepCheckInFlight;
  }
  const { ok, ms, at, error } = lastDeepCheck;
  res.status(ok ? 200 : 503).json({
    ok,
    render_ms: ms,
    checked_seconds_ago: Math.round((Date.now() - at) / 1000),
    ...(error ? { error } : {}),
  });
});

app.get('/metrics', async (req, res) => {
  res.json({ pool: pool.snapshot(), cache: await cache.stats(), limits: limits.snapshot() });
});

// --- Docs -------------------------------------------------------------------
// One URL per language, because these ARE the keyword pages - the plan is
// explicit that 'screenshot api python' and friends are the highest-conversion
// queries on the list. Tabs on a single page would rank as one page, not five.
// Served from the apex domain so authority accrues here, not to a docs host.
app.get('/pricing', (req, res) => res.type('html').send(pricingPage()));
app.get('/terms', (req, res) => res.type('html').send(termsPage()));

// Keyword landing pages. Separate URLs on purpose - one page targeting three
// phrases ranks for none of them well. The plan names these three.
for (const slug of Object.keys(LANDING_PAGES)) {
  app.get(`/${slug}`, (req, res) => res.type('html').send(landingPageFor(slug)));
}

// The blog. Posts are Markdown in content/blog/; one dated in the future stays
// invisible until then. The feed is registered before :slug so "feed.xml" is
// never looked up as a post.
app.get('/blog', (req, res) => res.type('html').send(blogIndex()));
app.get('/blog/feed.xml', (req, res) => res.type('application/rss+xml').send(blogFeed()));
app.get('/blog/:slug', (req, res, next) => {
  const page = blogPost(req.params.slug, { preview: req.query.preview === '1' });
  if (!page) return next();
  res.type('html').send(page);
});

// "[competitor] alternative" pages - honest, sourced and dated. See compare-pages.js.
for (const { slug } of Object.values(COMPARISONS)) {
  app.get(`/${slug}`, (req, res) => res.type('html').send(comparePage(slug)));
}

// A sitemap, so the crawler does not have to guess.
app.get('/sitemap.xml', (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
  const paths = [
    '/', '/pricing', '/terms', '/docs', '/docs/extract',
    ...['curl', 'node', 'python', 'php', 'go'].map((l) => '/docs/' + l),
    ...Object.keys(LANDING_PAGES).map((s) => '/' + s),
    ...Object.values(COMPARISONS).map((c) => '/' + c.slug),
    // Computed per request, so a scheduled post joins the sitemap the moment
    // it goes live - no deploy on the day.
    ...blogSitemapPaths(),
  ];
  const urls = paths.map((p) => '  <url><loc>' + base + p + '</loc></url>');
  res.type('application/xml').send(
    ['<?xml version="1.0" encoding="UTF-8"?>',
     '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
     ...urls,
     '</urlset>',
     ''].join('\n'),
  );
});

app.get('/robots.txt', (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /account', '',
     'Sitemap: ' + base + '/sitemap.xml', ''].join('\n'),
  );
});

app.get('/docs', (req, res) => res.type('html').send(docsIndex()));
app.get('/docs/extract', (req, res) => res.type('html').send(extractPage()));
app.get('/docs/:lang', (req, res, next) => {
  const page = languagePage(req.params.lang);
  if (!page) return next();
  res.type('html').send(page);
});

app.get('/', (req, res) => res.type('html').send(landingPage()));

// Router errors (bad email, unknown key, Polar unreachable) come through
// here. Without it Express answers with an HTML stack trace.
app.use((err, req, res, next) => sendError(res, err));

app.use((req, res) => sendError(res, Object.assign(new Error(`No route for ${req.method} ${req.path}. The API is GET or POST /take.`), { status: 404, code: 'not_found' })));

// --- Never die on a background failure --------------------------------------
//
// A render service must not exit because a browser failed to clean up after
// itself. Puppeteer's temp-profile teardown races the dying Chrome process and
// on Windows throws EBUSY unlinking first_party_sets.db; that arrived as an
// unhandled rejection and killed the server mid-sweep, taking every in-flight
// request with it.
const BENIGN = /puppeteer_dev_chrome_profile|first_party_sets|EBUSY|ENOTEMPTY|EPERM/i;

process.on('unhandledRejection', (reason) => {
  const message = reason?.message || String(reason);
  console.error('[unhandledRejection]', message);
  // Always survive: nothing rejected in the background is worth an outage.
});

process.on('uncaughtException', (err) => {
  const message = err?.message || String(err);
  if (BENIGN.test(message)) {
    console.error('[uncaughtException, ignored]', message);
    return;
  }
  // Anything else is genuinely unexpected. Log loudly and let the supervisor
  // restart us rather than serving from an unknown state.
  console.error('[uncaughtException, exiting]', err);
  process.exit(1);
});

// --- Boot -------------------------------------------------------------------
const server = app.listen(config.port, config.host, async () => {
  console.log(`screenshotline listening on http://${config.host}:${config.port}`);
  console.log(`  pool size          ${config.poolSize}`);
  console.log(`  recycle after      ${config.maxRendersPerBrowser} renders`);
  console.log(`  render timeout     ${config.renderTimeoutMs}ms`);
  console.log(`  access keys        ${config.accessKeys.length || 'none (open mode)'}`);
  console.log(`  private hosts      ${config.allowPrivateHosts ? 'ALLOWED (dev only)' : 'blocked'}`);

  // Pay the 3-5s Chromium cold start at boot, never on a customer request.
  const t = Date.now();
  await pool.warm().catch((err) => console.error('warm failed:', err.message));
  console.log(`  warmed ${config.poolSize} browsers in ${Date.now() - t}ms`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received, draining...`);
  server.close();
  // Buffered billing events first: they are the only thing here that cannot
  // be recreated. A browser can be relaunched; an uningested overage unit is
  // revenue that silently never existed.
  await usageIngest.drain();
  await pool.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, pool };
