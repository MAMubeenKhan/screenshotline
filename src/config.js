import os from 'node:os';
import path from 'node:path';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  // --- Browser pool -------------------------------------------------------
  // One render at a time per browser. Concurrency is the pool size.
  poolSize: int(process.env.POOL_SIZE, Math.max(2, Math.min(4, os.cpus().length))),
  // Chrome does not release memory cleanly across navigations: an instance
  // that starts near 200MB can exceed 1GB after enough pages. Recycle before
  // that happens rather than waiting for the OOM killer.
  maxRendersPerBrowser: int(process.env.MAX_RENDERS_PER_BROWSER, 50),
  // Replace a browser that has been alive this long even if it is under quota.
  maxBrowserAgeMs: int(process.env.MAX_BROWSER_AGE_MS, 30 * 60 * 1000),
  // How long a request may wait for a free slot before we give up with a 503.
  acquireTimeoutMs: int(process.env.ACQUIRE_TIMEOUT_MS, 20_000),

  // --- Timeouts -----------------------------------------------------------
  // Wall-clock ceiling on a single render. On expiry the browser process is
  // SIGKILLed, not politely closed - page.close() waits on the thing that hung.
  renderTimeoutMs: int(process.env.RENDER_TIMEOUT_MS, 30_000),
  maxRenderTimeoutMs: int(process.env.MAX_RENDER_TIMEOUT_MS, 60_000),
  navigationTimeoutMs: int(process.env.NAVIGATION_TIMEOUT_MS, 25_000),
  // How long to keep waiting for the network to go quiet AFTER load fires.
  // Bounded on purpose: a great many real sites hold analytics or websocket
  // connections open forever and never go idle, and blocking on that turns a
  // 3-second capture into a 25-second one that ties up a pool slot.
  settleDefaultMs: int(process.env.SETTLE_MS, 5_000),
  maxSettleMs: int(process.env.MAX_SETTLE_MS, 10_000),
  // How long a still-loading hero image or video may hold up a capture.
  // Long enough for one that is genuinely buffering, short enough that a
  // player headless Chrome will never start does not cost the whole budget.
  mediaWaitMs: int(process.env.MEDIA_WAIT_MS, 2_500),
  // document.fonts.ready never resolves on some pages. Never await it unbounded.
  fontsTimeoutMs: int(process.env.FONTS_TIMEOUT_MS, 2_000),
  // Ceiling on any single page.evaluate. A page that wedges its main
  // thread never answers, and without this one such page burns the whole
  // render budget and 504s. See evaluateAtMost in render.js.
  pageEvalTimeoutMs: int(process.env.PAGE_EVAL_TIMEOUT_MS, 3_000),
  // Ceiling on the capture call itself. Page.captureScreenshot waits on a
  // compositor frame and has no timeout of its own.
  captureTimeoutMs: int(process.env.CAPTURE_TIMEOUT_MS, 10_000),
  // Ceiling on page/context close. A wedged renderer never acknowledges
  // a close, and an unbounded one hides the real error.
  closeTimeoutMs: int(process.env.CLOSE_TIMEOUT_MS, 2_000),
  // Reading a whole document to Markdown walks every node, so it gets a
  // larger ceiling than an ordinary evaluate.
  extractTimeoutMs: int(process.env.EXTRACT_TIMEOUT_MS, 10_000),

  // --- Capture limits -----------------------------------------------------
  maxViewportWidth: int(process.env.MAX_VIEWPORT_WIDTH, 3840),
  maxViewportHeight: int(process.env.MAX_VIEWPORT_HEIGHT, 4320),
  maxDeviceScaleFactor: Number(process.env.MAX_DEVICE_SCALE_FACTOR || 3),
  maxDelayMs: int(process.env.MAX_DELAY_MS, 10_000),
  maxFullPageScrolls: int(process.env.MAX_FULL_PAGE_SCROLLS, 40),

  // --- Cache --------------------------------------------------------------
  cacheDir: process.env.CACHE_DIR || path.join(process.cwd(), '.cache'),
  defaultCacheTtl: int(process.env.DEFAULT_CACHE_TTL, 86_400),
  maxCacheTtl: int(process.env.MAX_CACHE_TTL, 30 * 86_400),

  // --- Billing and accounts -----------------------------------------------
  // SQLite via node:sqlite - no server to run, which keeps the self-hosting
  // guide a one-liner. All of it is behind src/store.js.
  dbFile: process.env.DB_FILE || path.join(process.cwd(), '.data', 'screenshotline.db'),
  // When false, /take runs in the pre-billing world: ACCESS_KEYS or open mode,
  // no metering, no quota. Self-hosters want exactly that, so it is the
  // default and the hosted deployment opts in.
  billingEnabled: bool(process.env.BILLING_ENABLED, false),
  polar: {
    accessToken: process.env.POLAR_ACCESS_TOKEN || '',
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
    // Polar runs a separate sandbox environment with its own tokens.
    server: process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox',
    // Sent as Polar-Version on every request. Unpinned requests follow
    // Polar's "Current", which changes every quarter - the first switch is
    // 1 October 2026, to 2026-10 - so an unpinned integration changes contract
    // without a deploy. 2026-04 is what this code was built and verified
    // against; it is supported until the January 2027 release. Migrate by
    // testing against 2026-10 in sandbox, then change this (or the env var).
    // Webhook payload versions are separate: they are set per endpoint in
    // Polar's dashboard, not by this header.
    apiVersion: process.env.POLAR_API_VERSION || '2026-04',
    // Map our plan ids onto Polar product ids.
    products: {
      starter: process.env.POLAR_PRODUCT_STARTER || '',
      growth: process.env.POLAR_PRODUCT_GROWTH || '',
      scale: process.env.POLAR_PRODUCT_SCALE || '',
    },
    successUrl: process.env.POLAR_SUCCESS_URL || '',
    // Usage ingestion for overage. Empty means OFF - nothing is ingested and
    // nothing is billed beyond the fixed subscription price.
    usageMeter: process.env.POLAR_USAGE_METER || '',
    usageFlushMs: int(process.env.POLAR_USAGE_FLUSH_MS, 10_000),
    usageBatchMax: int(process.env.POLAR_USAGE_BATCH_MAX, 500),
    // Bounded buffer. Under-billing during an outage is survivable; growing
    // until the process dies is not.
    usageQueueMax: int(process.env.POLAR_USAGE_QUEUE_MAX, 50_000),
  },

  // --- Auth ---------------------------------------------------------------
  // ACCESS_KEYS="pk_live_abc,pk_test_xyz" - comma separated.
  // Empty means open (development only).
  accessKeys: (process.env.ACCESS_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  signingSecret: process.env.SIGNING_SECRET || '',
  // When true, every request must carry a valid HMAC signature. Turn this on
  // for keys that appear in browser-visible URLs.
  requireSignature: bool(process.env.REQUIRE_SIGNATURE, false),

  // --- Security -----------------------------------------------------------
  // Never enable in production. Allows rendering localhost / RFC1918 targets.
  allowPrivateHosts: bool(process.env.ALLOW_PRIVATE_HOSTS, false),

  // --- Misc ---------------------------------------------------------------
  executablePath: process.env.CHROME_PATH || undefined,
  defaultUserAgent:
    process.env.DEFAULT_USER_AGENT ||
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Screenshotline/0.1',
};

export default config;
