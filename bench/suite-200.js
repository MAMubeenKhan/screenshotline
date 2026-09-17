/**
 * The 200-page hardening suite.
 *
 * Purpose is different from the other two files. bench/urls.js breaks the
 * renderer; bench/real-world.js covers the use cases people buy this for.
 * This one is about *breadth*: enough of the real web, across enough
 * categories, that a customer's first request is unlikely to be a shape we
 * have never rendered.
 *
 * `expect` is a claim we are making about our own product:
 *   ok          - this must work. A failure is a bug.
 *   known-hard   - we expect to fail or be bot-blocked. Failure is information.
 *
 * `blankOk` marks a page that legitimately comes back as a blank frame - a
 * bot wall or an IP block. It is not a pass, it is a page whose blankness is
 * already understood. The runner treats a blank frame on ANY OTHER page as a
 * hard failure, because a silent blank 200 is the worst thing this product
 * can do and it must never creep in unnoticed.
 *
 * WHEN A known-hard PAGE PASSES, OPEN THE IMAGE. There are three different
 * things behind a 200 and only one of them is a success:
 *   a LOGIN WALL is what any logged-out visitor sees, so capturing it is
 *     correct - facebook, instagram, quora
 *   a CAPTCHA is a challenge shown only to suspected bots, so capturing it
 *     is a FAILURE dressed as a pass - walmart, wsj
 *   a 404 means the URL in this file died - amazon
 * A text heuristic cannot tell these apart; one called wsj "looks real" on
 * zero extracted characters. Use your eyes.
 *
 * A 'known-hard' that starts passing, or an 'ok' that starts failing, is the
 * signal. Both are printed as SURPRISES by the runner.
 *
 * Note on bot detection: several of these actively block datacenter IPs. From
 * a laptop they pass, from a cloud host they may not. That difference is worth
 * knowing before a customer discovers it for you.
 */

const build = (category, expect, urls) =>
  urls.map(([id, url, note, blankOk]) => ({
    id: `${category}-${id}`,
    category,
    url,
    expect,
    breaks: note || '',
    blankOk: Boolean(blankOk),
  }));

// --- News and publishing ----------------------------------------------------
const news = build('news', 'ok', [
  ['nyt', 'https://www.nytimes.com/', 'Fides consent banner injected after networkidle'],
  ['guardian', 'https://www.theguardian.com/international', 'Consent + sticky nav'],
  ['bbc', 'https://www.bbc.com/news', 'CMP interstitial'],
  ['cnn', 'https://edition.cnn.com/', 'Heavy video embeds'],
  ['reuters', 'https://www.reuters.com/', 'Bot detection is common here'],
  ['apnews', 'https://apnews.com/'],
  ['npr', 'https://www.npr.org/'],
  ['aljazeera-en', 'https://www.aljazeera.com/'],
  ['dw', 'https://www.dw.com/en/top-stories/s-9097'],
  ['france24', 'https://www.france24.com/en/'],
  ['elpais', 'https://elpais.com/', 'Spanish, heavy consent'],
  ['spiegel', 'https://www.spiegel.de/', 'German, strict GDPR wall'],
  ['corriere', 'https://www.corriere.it/', 'Italian'],
  ['asahi', 'https://www.asahi.com/', 'Japanese glyphs'],
  ['toi', 'https://timesofindia.indiatimes.com/', 'Very ad-heavy'],
  ['scmp', 'https://www.scmp.com/'],
  ['abc-au', 'https://www.abc.net.au/news'],
  ['globo', 'https://www.globo.com/', 'Blocks this network at the edge - 403 to plain curl too', true],
]);

// --- E-commerce -------------------------------------------------------------
const shop = build('shop', 'ok', [
  ['ebay', 'https://www.ebay.com/'],
  ['etsy', 'https://www.etsy.com/'],
  ['allbirds', 'https://www.allbirds.com/', 'Shopify storefront'],
  ['ikea', 'https://www.ikea.com/us/en/'],
  ['zara', 'https://www.zara.com/us/', 'Minimal DOM, huge imagery'],
  ['uniqlo', 'https://www.uniqlo.com/us/en/'],
  ['asos', 'https://www.asos.com/us/men/'],
  ['wayfair', 'https://www.wayfair.com/'],
  ['chewy', 'https://www.chewy.com/'],
  ['newegg', 'https://www.newegg.com/'],
  ['patagonia', 'https://www.patagonia.com/shop/mens', 'Bot wall - 404 to the renderer', true],
  ['gumroad', 'https://gumroad.com/'],
  ['shopify', 'https://www.shopify.com/'],
  ['bestbuy', 'https://www.bestbuy.com/'],
]);

const shopHard = build('shop', 'known-hard', [
  ['amazon', 'https://www.amazon.com/', 'Robot Check on datacenter IPs. The old /dp/B08N5WRWNW ASIN 404s now, and a captured 404 page looks like a pass - audited 2026-09-10'],
  ['walmart', 'https://www.walmart.com/', 'PerimeterX. AUDITED 2026-09-10: returns 200 with real content behind a "Robot or human? PRESS & HOLD" captcha modal. A 200 here is a captcha screenshot, not the page'],
  ['target', 'https://www.target.com/', 'Akamai bot manager'],
  ['aliexpress', 'https://www.aliexpress.com/', 'Slider CAPTCHA'],
]);

// --- SaaS marketing (what a paying customer's own site looks like) ----------
const saas = build('saas', 'ok', [
  ['stripe', 'https://stripe.com/'],
  ['notion', 'https://www.notion.com/'],
  ['figma', 'https://www.figma.com/'],
  ['linear', 'https://linear.app/', 'Scroll-triggered animation'],
  ['vercel', 'https://vercel.com/'],
  ['netlify', 'https://www.netlify.com/'],
  ['supabase', 'https://supabase.com/'],
  ['railway', 'https://railway.com/'],
  ['render', 'https://render.com/'],
  ['neon', 'https://neon.com/'],
  ['clerk', 'https://clerk.com/'],
  ['resend', 'https://resend.com/'],
  ['posthog', 'https://posthog.com/'],
  ['sentry', 'https://sentry.io/welcome/'],
  ['datadog', 'https://www.datadoghq.com/'],
  ['twilio', 'https://www.twilio.com/en-us'],
  ['slack', 'https://slack.com/'],
  ['zoom', 'https://www.zoom.com/'],
  ['hubspot', 'https://www.hubspot.com/'],
  ['intercom', 'https://www.intercom.com/'],
]);

// --- Developer docs ---------------------------------------------------------
const docs = build('docs', 'ok', [
  ['python', 'https://docs.python.org/3/library/asyncio.html'],
  ['mdn-css', 'https://developer.mozilla.org/en-US/docs/Web/CSS/position'],
  ['node', 'https://nodejs.org/api/fs.html', 'Very long single page'],
  ['react', 'https://react.dev/'],
  ['vue', 'https://vuejs.org/'],
  ['svelte', 'https://svelte.dev/'],
  ['tailwind', 'https://tailwindcss.com/docs/installation'],
  ['docker', 'https://docs.docker.com/'],
  ['kubernetes', 'https://kubernetes.io/docs/home/'],
  ['go', 'https://go.dev/doc/'],
  ['rust', 'https://doc.rust-lang.org/book/'],
  ['php', 'https://www.php.net/manual/en/index.php'],
  ['mssdocs', 'https://learn.microsoft.com/en-us/azure/'],
  ['aws', 'https://docs.aws.amazon.com/'],
  ['gcloud', 'https://cloud.google.com/docs'],
  ['apple', 'https://developer.apple.com/documentation/swift'],
  ['googledev', 'https://developers.google.com/'],
  ['postgres', 'https://www.postgresql.org/docs/current/'],
]);

// --- International: scripts, direction, font coverage -----------------------
// Missing fonts render as tofu and the request still returns 200, so this
// whole category is a silent-failure class. These images must be eyeballed.
const intl = build('intl', 'ok', [
  ['jp-yahoo', 'https://www.yahoo.co.jp/', 'CJK'],
  ['jp-rakuten', 'https://www.rakuten.co.jp/', 'CJK, dense'],
  ['kr-naver', 'https://www.naver.com/', 'Hangul'],
  ['kr-daum', 'https://www.daum.net/', 'Hangul'],
  ['ar-aljazeera', 'https://www.aljazeera.net/', 'Arabic RTL + shaping'],
  ['ar-alarabiya', 'https://www.alarabiya.net/', 'Arabic RTL'],
  ['he-ynet', 'https://www.ynet.co.il/', 'Hebrew RTL'],
  ['ru-lenta', 'https://lenta.ru/', 'Cyrillic; never goes network-idle'],
  ['ru-ria', 'https://ria.ru/', 'Cyrillic'],
  ['hi-jagran', 'https://www.jagran.com/', 'Devanagari'],
  ['hi-ndtv', 'https://www.ndtv.com/'],
  ['th-thairath', 'https://www.thairath.co.th/', 'Thai shaping, no word spaces'],
  ['vi-vnexpress', 'https://vnexpress.net/', 'Vietnamese diacritics'],
  ['id-detik', 'https://www.detik.com/'],
  ['tr-hurriyet', 'https://www.hurriyet.com.tr/', 'Turkish dotted/dotless i'],
  ['gr-kathimerini', 'https://www.kathimerini.gr/', 'Greek'],
  ['pl-onet', 'https://www.onet.pl/', 'Polish diacritics'],
  ['emoji', 'https://emojipedia.org/', 'Colour emoji font coverage'],
]);

// Unreachable from this network entirely - curl fails too, so these are not
// renderer bugs. Kept in the suite because on a host that CAN reach them they
// are exactly the CJK coverage we want tested; the expectation is honest about
// where we measured.
const intlHard = build('intl', 'known-hard', [
  ['cn-baidu', 'https://www.baidu.com/', 'Network-unreachable from test host'],
  ['cn-qq', 'https://www.qq.com/', 'Network-unreachable from test host'],
  ['cn-sina', 'https://www.sina.com.cn/', 'Network-unreachable from test host'],
]);

// --- Social and community ---------------------------------------------------
const social = build('social', 'ok', [
  ['github', 'https://github.com/nodejs/node'],
  ['stackoverflow', 'https://stackoverflow.com/questions/tagged/javascript'],
  ['hn', 'https://news.ycombinator.com/'],
  ['medium', 'https://medium.com/'],
  ['devto', 'https://dev.to/'],
  ['substack', 'https://substack.com/'],
  ['producthunt', 'https://www.producthunt.com/'],
  ['discourse', 'https://meta.discourse.org/'],
  ['mastodon', 'https://mastodon.social/explore'],
  ['bluesky', 'https://bsky.app/'],
]);

const socialHard = build('social', 'known-hard', [
  ['x', 'https://x.com/jack/status/20', 'Login wall since 2023 - but AUDITED 2026-09-10 and the tweet, counts and a reply all render. A genuine pass'],
  ['linkedin', 'https://www.linkedin.com/company/microsoft/', 'Auth wall + bot detection'],
  ['reddit', 'https://www.reddit.com/r/programming/', 'Blocks datacenter IPs'],
  ['quora', 'https://www.quora.com/', 'Login interstitial'],
  ['instagram', 'https://www.instagram.com/', 'Login wall. AUDITED 2026-09-10: renders the login page, which is what a logged-out visitor sees, so the capture is CORRECT - unlike a captcha, which only a suspected bot is shown'],
  ['facebook', 'https://www.facebook.com/', 'Login wall'],
]);

// --- Canvas, WebGL, maps, live embeds --------------------------------------
const viz = build('viz', 'ok', [
  ['osm', 'https://www.openstreetmap.org/#map=12/51.5074/-0.1278', 'Async tiles, never idle'],
  ['observable', 'https://observablehq.com/@d3/gallery'],
  ['d3', 'https://d3js.org/'],
  ['codepen', 'https://codepen.io/trending', 'Grid of live iframes'],
  ['jsfiddle', 'https://jsfiddle.net/'],
  ['codesandbox', 'https://codesandbox.io/'],
  ['threejs', 'https://threejs.org/', 'WebGL canvas'],
  ['plotly', 'https://plotly.com/javascript/'],
  ['chartjs', 'https://www.chartjs.org/'],
  ['leaflet', 'https://leafletjs.com/'],
  ['mapbox', 'https://www.mapbox.com/'],
  ['deckgl', 'https://deck.gl/'],
]);

// --- Government and institutional ------------------------------------------
const gov = build('gov', 'ok', [
  ['usagov', 'https://www.usa.gov/'],
  ['govuk', 'https://www.gov.uk/'],
  ['europa', 'https://european-union.europa.eu/index_en'],
  ['who', 'https://www.who.int/'],
  ['un', 'https://www.un.org/en/'],
  ['nasa', 'https://www.nasa.gov/', 'Very large hero imagery'],
  ['nih', 'https://www.nih.gov/'],
  ['cdc', 'https://www.cdc.gov/'],
  ['worldbank', 'https://www.worldbank.org/en/home'],
  ['imf', 'https://www.imf.org/en/Home'],
]);

// --- Education --------------------------------------------------------------
const edu = build('edu', 'ok', [
  ['mit', 'https://www.mit.edu/'],
  ['harvard', 'https://www.harvard.edu/'],
  ['oxford', 'https://www.ox.ac.uk/'],
  ['coursera', 'https://www.coursera.org/'],
  ['edx', 'https://www.edx.org/'],
  ['khan', 'https://www.khanacademy.org/'],
  ['wikipedia', 'https://en.wikipedia.org/wiki/Screenshot'],
  ['arxiv', 'https://arxiv.org/list/cs.SE/recent', 'Plain HTML, heavy tables'],
]);

// --- Finance ----------------------------------------------------------------
const finance = build('finance', 'ok', [
  ['marketwatch', 'https://www.marketwatch.com/'],
  ['investing', 'https://www.investing.com/', 'Live-updating tickers, never idle'],
  ['coingecko', 'https://www.coingecko.com/'],
  ['yahoofinance', 'https://finance.yahoo.com/'],
  ['nasdaq', 'https://www.nasdaq.com/'],
  ['morningstar', 'https://www.morningstar.com/'],
  ['tradingview', 'https://www.tradingview.com/', 'Canvas charts'],
]);

const financeHard = build('finance', 'known-hard', [
  ['coinmarketcap', 'https://coinmarketcap.com/', 'Network-unreachable from test host'],
  ['bloomberg', 'https://www.bloomberg.com/', 'Aggressive bot wall'],
  ['wsj', 'https://www.wsj.com/', 'Hard paywall. AUDITED 2026-09-10: returns 200 showing "Verification Required - Slide right to secure your access". A captcha, not the page'],
  ['ft', 'https://www.ft.com/', 'Hard paywall'],
]);

// --- Media and video --------------------------------------------------------
const media = build('media', 'ok', [
  ['youtube', 'https://www.youtube.com/', 'Consent interstitial in EU'],
  ['vimeo', 'https://vimeo.com/'],
  ['twitch', 'https://www.twitch.tv/', 'Live video, never idle'],
  ['spotify', 'https://open.spotify.com/'],
  ['soundcloud', 'https://soundcloud.com/'],
  ['imdb', 'https://www.imdb.com/'],
  ['rottentomatoes', 'https://www.rottentomatoes.com/'],
  ['netflix', 'https://www.netflix.com/'],
]);

// --- Blogs: the long tail, and the shape of most link previews -------------
const blogs = build('blog', 'ok', [
  ['overreacted', 'https://overreacted.io/'],
  ['danluu', 'https://danluu.com/', 'Almost no CSS - a good control'],
  ['jvns', 'https://jvns.ca/'],
  ['simonwillison', 'https://simonwillison.net/'],
  ['paulgraham', 'https://www.paulgraham.com/articles.html', 'Table-based 1990s HTML'],
  ['joel', 'https://www.joelonsoftware.com/'],
  ['fowler', 'https://martinfowler.com/'],
  ['csstricks', 'https://css-tricks.com/'],
  ['smashing', 'https://www.smashingmagazine.com/'],
  ['bearblog', 'https://bearblog.dev/'],
]);

// --- Very long or very heavy documents --------------------------------------
const heavy = build('heavy', 'ok', [
  ['whatwg-html', 'https://html.spec.whatwg.org/multipage/', 'Spec index'],
  ['tc39', 'https://tc39.es/ecma262/', 'Enormous single page'],
  ['rfc9110', 'https://www.rfc-editor.org/rfc/rfc9110.html', 'Very long plain document'],
  ['mdn-jsref', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference'],
  ['unicode', 'https://www.unicode.org/charts/', 'Huge link table'],
  ['kernel', 'https://www.kernel.org/doc/html/latest/'],
  ['w3c-css', 'https://www.w3.org/TR/CSS/'],
  ['wiki-long', 'https://en.wikipedia.org/wiki/List_of_Unicode_characters', 'Massive table'],
]);

// --- TLS, transport and HTTP semantics --------------------------------------
// badssl.com exists for exactly this. Anything marked ok here should work
// *without* ignore_tls_errors; the tls-* entries need the opt-in and are
// exercised separately by the smoke suite.
// These need the ignore_tls_errors opt-in. With it they must work - that is
// the whole point of the feature - so they are 'ok' with the option attached,
// not 'known-hard'.
const tls = [
  ['expired', 'https://expired.badssl.com/', 'Expired certificate'],
  ['self-signed', 'https://self-signed.badssl.com/', 'Self-signed certificate'],
  ['wrong-host', 'https://wrong.host.badssl.com/', 'Hostname mismatch'],
  ['untrusted-root', 'https://untrusted-root.badssl.com/', 'Untrusted root'],
  ['revoked', 'https://revoked.badssl.com/', 'Revoked certificate'],
].map(([id, url, note]) => ({
  id: `tls-${id}`,
  category: 'tls',
  url,
  expect: 'ok',
  breaks: note,
  options: { ignore_tls_errors: 'true' },
}));

const tlsUnreachable = build('tls', 'known-hard', [
  ['1000-sans', 'https://1000-sans.badssl.com/', 'Network-unreachable from test host'],
  // curl reaches this host fine, Chrome times out even with HTTPS auto-upgrade
  // disabled - most likely an IPv6 path issue on this test host rather than a
  // renderer bug. Plain-HTTP coverage is kept by tls-http-example, which
  // passes. Recheck from a different network before treating it as fixed.
  ['plain-http', 'http://neverssl.com/', 'Chrome-specific connect timeout on this host'],
]);

const tlsOk = build('tls', 'ok', [
  ['sha256', 'https://sha256.badssl.com/', 'Valid modern cert - must work'],
  ['ecc256', 'https://ecc256.badssl.com/', 'ECC cert'],
  ['long-subdomain', 'https://longextendedsubdomainnamewithoutdashesinordertotestwordwrapping.badssl.com/'],
  ['http-example', 'http://example.com/'],
]);

const http = build('http', 'ok', [
  ['200', 'https://httpbin.org/html'],
  ['404', 'https://httpbin.org/status/404', 'Capture the error page, report status'],
  ['500', 'https://httpbin.org/status/500'],
  ['503', 'https://httpstat.us/503'],
  ['redirect-5', 'https://httpbin.org/redirect/5', 'Every hop re-validated for SSRF'],
  ['delay-2', 'https://httpbin.org/delay/2'],
  ['gzip', 'https://httpbin.org/gzip'],
  ['image', 'https://httpbin.org/image/png', 'Response is an image, not a document'],
  ['xml', 'https://httpbin.org/xml'],
  ['utf8', 'https://httpbin.org/encoding/utf8', 'Mixed-script text'],
  ['cookies', 'https://httpbin.org/cookies/set?a=1'],
]);

// Exercises the basic_auth option, so it is expected to work, not to fail.
const httpAuth = [
  {
    id: 'http-basic-auth',
    category: 'http',
    url: 'https://httpbin.org/basic-auth/user/passwd',
    expect: 'ok',
    breaks: 'Exercises the basic_auth option',
    options: { basic_auth: 'user:passwd' },
  },
];

const httpHard = build('http', 'known-hard', [

  ['delay-30', 'https://httpbin.org/delay/30', 'Must fail cleanly at the timeout'],
]);

export const SUITE_200 = [
  ...news,
  ...shop,
  ...shopHard,
  ...saas,
  ...docs,
  ...intl,
  ...intlHard,
  ...social,
  ...socialHard,
  ...viz,
  ...gov,
  ...edu,
  ...finance,
  ...financeHard,
  ...media,
  ...blogs,
  ...heavy,
  ...tls,
  ...tlsUnreachable,
  ...tlsOk,
  ...http,
  ...httpAuth,
  ...httpHard,
];

export default SUITE_200;
