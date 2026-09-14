import config from './config.js';

export class OptionError extends Error {
  constructor(message, code = 'invalid_option') {
    super(message);
    this.name = 'OptionError';
    this.code = code;
    this.status = 400;
  }
}

const FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'pdf']);
const WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']);

export const CONTENT_TYPES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

// Params that identify the caller rather than the output. Excluded from the
// cache key so two customers asking for the same page share a cache hit.
export const NON_CACHEABLE_PARAMS = new Set(['access_key', 'signature', 'cache', 'cache_ttl']);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Headers arrive either as a JSON object (POST body) or a JSON string (query).
// Hop-by-hop and host headers are dropped - letting a caller set them breaks
// the connection rather than doing anything useful.
const FORBIDDEN_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'upgrade', 'proxy-connection', 'keep-alive', 'te', 'trailer',
]);

function parseHeaders(value) {
  if (!value) return undefined;
  let obj = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      throw new OptionError(
        '"headers" must be a JSON object, e.g. headers={"X-Token":"abc"}.',
        'invalid_headers',
      );
    }
  }
  if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) {
    throw new OptionError('"headers" must be a JSON object.', 'invalid_headers');
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
    out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function asInt(value, fallback, { min, max, name }) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) {
    throw new OptionError(`"${name}" must be a whole number, got "${value}".`);
  }
  return clamp(n, min, max);
}

function asFloat(value, fallback, { min, max, name }) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) {
    throw new OptionError(`"${name}" must be a number, got "${value}".`);
  }
  return clamp(n, min, max);
}

/**
 * Normalise raw query/body params into a validated option set.
 * Throws OptionError with a message that says how to fix it.
 */
/**
 * Parse the `cookies` parameter into Puppeteer cookie objects.
 *
 * Accepts a repeated query parameter or one string of `a=1; b=2` pairs, and
 * an optional `; Domain=...; Path=...` on each. Anything unparseable is
 * dropped rather than thrown: a malformed cookie should cost you a login,
 * not a 400 on a capture that would otherwise have worked.
 */
function parseCookies(raw) {
  if (!raw) return null;
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => String(s).split(';'));
  const out = [];
  let pending = null;
  for (const piece of parts) {
    const bit = piece.trim();
    if (!bit) continue;
    const eq = bit.indexOf('=');
    if (eq < 1) continue;
    const name = bit.slice(0, eq).trim();
    const value = bit.slice(eq + 1).trim();
    const lower = name.toLowerCase();
    // Attributes modify the cookie before them, they are not cookies.
    if (pending && (lower === 'domain' || lower === 'path')) {
      pending[lower] = value;
      continue;
    }
    if (pending && (lower === 'secure' || lower === 'httponly' || lower === 'samesite' || lower === 'expires' || lower === 'max-age')) {
      continue;
    }
    pending = { name, value };
    out.push(pending);
  }
  return out.length ? out.slice(0, 50) : null;
}
/**
 * Accept a bare hostname where a URL is expected.
 *
 * People type spendpedia.com, not https://www.spendpedia.com - in a browser
 * bar, in a spreadsheet column, in a list of domains they want thumbnails
 * for. Requiring the scheme turns the most common input into a 400, and the
 * fix is one line of guesswork that is right almost every time.
 *
 * https, not http: nearly every site redirects to it anyway, and guessing
 * http would downgrade a request the caller never asked to be insecure.
 *
 * Anything that already carries a scheme is left exactly as it is, so
 * http://example.com stays http, and a scheme we do not support still
 * reaches assertPublicUrl and is still refused by name rather than being
 * quietly rewritten into something fetchable.
 */
function normaliseUrl(raw) {
  const value = String(raw).trim();
  if (!value) return value;
  // scheme://  - the only shape we leave alone.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  // A scheme with no slashes (mailto:, javascript:, data:) is NOT a bare
  // host. Leave it, so it is rejected as an unsupported scheme rather than
  // turned into https://javascript:alert(1) and rejected as a bad port -
  // the caller should be told which of the two things they did wrong.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^:/?#]+:\d+(\/|$|\?|#)/.test(value)) {
    return value;
  }
  return `https://${value}`;
}
export function parseOptions(raw) {
  if (!raw.url) {
    throw new OptionError('The "url" parameter is required.', 'missing_url');
  }

  let format = String(raw.format || 'png').toLowerCase();
  if (!FORMATS.has(format)) {
    throw new OptionError(
      `"format" must be one of png, jpeg, webp, pdf - got "${format}".`,
      'invalid_format',
    );
  }
  if (format === 'jpg') format = 'jpeg';

  // Default is 'domcontentloaded', and the settle budget does the rest.
  //
  // Measured on a 202-page sweep:
  //   networkidle2  - 18 hard timeouts, worst single source of failure
  //   load          - 19/20 SaaS pages captured, but p50 23s because 16 of
  //                   them never fired load inside the navigation timeout
  //   dcl + settle  - see below
  //
  // Waiting on an event modern sites never emit is a losing strategy. Get to
  // interactive fast, then spend one bounded budget letting things settle.
  const waitUntil = String(raw.wait_until || 'domcontentloaded').toLowerCase();
  if (!WAIT_UNTIL.has(waitUntil)) {
    throw new OptionError(
      `"wait_until" must be one of load, domcontentloaded, networkidle0, networkidle2.`,
      'invalid_wait_until',
    );
  }

  const colorScheme = String(raw.color_scheme || 'light').toLowerCase();
  if (!['light', 'dark'].includes(colorScheme)) {
    throw new OptionError('"color_scheme" must be light or dark.', 'invalid_color_scheme');
  }

  const options = {
    url: normaliseUrl(raw.url),
    format,
    quality:
      format === 'jpeg' || format === 'webp'
        ? asInt(raw.quality, 80, { min: 1, max: 100, name: 'quality' })
        : undefined,
    fullPage: asBool(raw.full_page, false),
    selector: raw.selector ? String(raw.selector) : undefined,
    viewportWidth: asInt(raw.viewport_width, 1280, {
      min: 1,
      max: config.maxViewportWidth,
      name: 'viewport_width',
    }),
    viewportHeight: asInt(raw.viewport_height, 800, {
      min: 1,
      max: config.maxViewportHeight,
      name: 'viewport_height',
    }),
    deviceScaleFactor: asFloat(raw.device_scale_factor, 1, {
      min: 0.1,
      max: config.maxDeviceScaleFactor,
      name: 'device_scale_factor',
    }),
    delay: asInt(raw.delay, 0, { min: 0, max: config.maxDelayMs, name: 'delay' }),
    timeout: asInt(raw.timeout, config.renderTimeoutMs, {
      min: 1000,
      max: config.maxRenderTimeoutMs,
      name: 'timeout',
    }),
    waitUntil,
    settle: asInt(raw.settle, config.settleDefaultMs, {
      min: 0,
      max: config.maxSettleMs,
      name: 'settle',
    }),
    blockAds: asBool(raw.block_ads, false),
    blockCookieBanners: asBool(raw.block_cookie_banners, false),
    blockChats: asBool(raw.block_chats, false),
    blockPopups: asBool(raw.block_popups, false),
    // Injection. inject_js runs arbitrary script in the page, which is why
    // the request interceptor refuses private addresses for subresources
    // too - see render.js. Sizes are capped so a request cannot be used to
    // push a megabyte of payload through a query string.
    injectCss: raw.inject_css ? String(raw.inject_css).slice(0, 100_000) : null,
    injectJs: raw.inject_js ? String(raw.inject_js).slice(0, 100_000) : null,
    hideSelector: raw.hide_selector ? String(raw.hide_selector).slice(0, 4_000) : null,
    omitBackground: asBool(raw.omit_background, false),
    colorScheme,
    userAgent: raw.user_agent ? String(raw.user_agent) : config.defaultUserAgent,
    // Transport escape hatches. Customers archiving legacy or internal sites
    // hit expired and self-signed certificates constantly; refusing outright
    // loses the use case, so make it an explicit opt-in instead.
    ignoreTlsErrors: asBool(raw.ignore_tls_errors, false),
    basicAuth: raw.basic_auth ? String(raw.basic_auth) : undefined,
    // Session cookies. basic_auth covers HTTP auth, which almost nothing
    // uses any more - a login wall is a session cookie, and this is the
    // parameter that actually gets past one. Repeatable: cookie=a%3D1 twice.
    cookies: parseCookies(raw.cookies),
    headers: parseHeaders(raw.headers),
    // Turn silent failures loud. Off by default because plenty of customers
    // legitimately want a picture of a 404 page; on when you would rather have
    // an error than a useless image.
    failOnHttpError: asBool(raw.fail_on_http_error, false),
    failOnBlank: asBool(raw.fail_on_blank, false),
    // Cache controls are operational, not part of the output identity.
    // Extraction. When on, the page is rendered exactly as it would be for a
    // screenshot - settle, consent sweep, ad collapse, lazy-load scroll - and
    // then read as Markdown instead of photographed. Everything that makes
    // the image correct makes the text correct for the same reasons.
    extract: asBool(raw.extract, false),
    stripChrome: asBool(raw.strip_chrome, true),
    maxChars: asInt(raw.max_chars, 0, { min: 0, max: 2_000_000, name: 'max_chars' }),
    cache: asBool(raw.cache, false),
    cacheTtl: asInt(raw.cache_ttl, config.defaultCacheTtl, {
      min: 0,
      max: config.maxCacheTtl,
      name: 'cache_ttl',
    }),
  };

  if (options.basicAuth && !options.basicAuth.includes(':')) {
    throw new OptionError(
      '"basic_auth" must be in the form user:password.',
      'invalid_basic_auth',
    );
  }

  if (options.selector && options.fullPage) {
    throw new OptionError(
      'Use either "selector" or "full_page", not both - a captured element has its own bounds.',
      'conflicting_options',
    );
  }
  if (options.omitBackground && format === 'jpeg') {
    throw new OptionError(
      '"omit_background" needs a format that supports transparency. Use png or webp.',
      'conflicting_options',
    );
  }

  return options;
}

export function contentTypeFor(format) {
  return CONTENT_TYPES[format] || 'application/octet-stream';
}
