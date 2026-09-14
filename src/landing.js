import config from './config.js';
import { faviconTags, logoMark } from './brand.js';

/**
 * The landing page.
 *
 * Two jobs, in this order:
 *   1. Let someone see real output in ten seconds, with no signup. That is on
 *      the do-not-ship list for a reason - a developer who cannot
 *      evaluate the thing leaves. The demo hits /demo, which renders without a
 *      key and is rationed by IP.
 *   2. Answer "why this one" with measurements rather than adjectives. We have
 *      a 202-page benchmark and a head-to-head against two incumbents; almost
 *      every competitor asserts quality, and we can show it.
 *
 * Written for developers, because that is who buys this. Short sentences and a
 * visible curl beat a marketing hero. But prices are on the page and there is
 * a route to /pricing, because not having that was the biggest hole in the site.
 */
export function landingPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screenshotline — a screenshot API that survives production</title>
<meta name="description" content="URL in, image out. A screenshot API that handles consent walls, lazy images and late-rendering SPAs. Free tier, no card. Also returns pages as Markdown for LLMs.">
<link rel="canonical" href="${process.env.PUBLIC_BASE_URL || 'https://screenshotline.com'}">
${faviconTags()}
<style>
  :root{--ground:#f6f8f9;--surface:#fff;--ink:#131a1f;--ink-2:#4a5a64;--ink-3:#7a8b96;
    --rule:#dbe3e7;--accent:#0c6b75;--accent-soft:#e6f2f3;--code-bg:#101a1f;--code-ink:#d9e4e9}
  @media (prefers-color-scheme:dark){:root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;
    --ink-2:#a2b3bc;--ink-3:#76888f;--rule:#23323a;--accent:#43b9c2;--accent-soft:#122a2d;
    --code-bg:#070e12;--code-ink:#d3e0e6}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15.5px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px 80px}
  nav{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:14.5px}
  nav .brand{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none;margin-right:auto;display:flex;align-items:center;gap:8px}
  nav a{text-decoration:none;color:var(--ink-2)}
  nav a:hover{color:var(--accent)}
  h1{font-size:38px;line-height:1.15;letter-spacing:-.03em;margin:34px 0 12px;max-width:16ch}
  .lede{font-size:18px;color:var(--ink-2);margin:0 0 8px;max-width:56ch}
  .lede strong{color:var(--ink)}
  h2{font-size:22px;letter-spacing:-.015em;margin:52px 0 8px}
  h3{font-size:15px;margin:0 0 4px}
  p{max-width:66ch}
  form{display:grid;grid-template-columns:1fr auto;gap:10px;margin:26px 0 12px}
  input[type=url]{padding:12px 14px;border:1px solid var(--rule);border-radius:6px;
    background:var(--surface);color:var(--ink);font-size:15px;min-width:0}
  button{padding:12px 24px;border:0;border-radius:6px;background:var(--accent);
    color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.55;cursor:progress}
  .opts{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:14px;color:var(--ink-2)}
  label{display:flex;align-items:center;gap:6px;cursor:pointer}
  pre{background:var(--code-bg);color:var(--code-ink);padding:14px 16px;border-radius:6px;
    overflow-x:auto;font-size:13px;border-left:2px solid var(--accent);margin:0 0 14px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  p code,li code,td code{background:var(--surface);border:1px solid var(--rule);white-space:nowrap;
    padding:1px 5px;border-radius:3px;font-size:13px}
  #out{border:1px solid var(--rule);border-radius:6px;background:var(--surface);
    min-height:150px;display:flex;align-items:center;justify-content:center;
    color:var(--ink-3);font-size:14px;padding:12px;overflow:auto}
  #out img{max-width:100%;height:auto;display:block;border-radius:3px}
  .meta{font-size:12.5px;color:var(--ink-3);margin-top:10px;font-family:ui-monospace,monospace}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:18px}
  .card{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:17px 19px}
  .card p{font-size:14px;color:var(--ink-2);margin:0;max-width:none}
  table{width:100%;border-collapse:collapse;font-size:14px;margin:14px 0}
  th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;
    color:var(--ink-3);padding:0 12px 7px 0;font-weight:600}
  td{padding:9px 12px 9px 0;border-top:1px solid var(--rule);color:var(--ink-2)}
  td:first-child{color:var(--ink)}
  td.num{font-family:ui-monospace,monospace;white-space:nowrap}
  .win{color:var(--accent);font-weight:600}
  .note{background:var(--accent-soft);border-left:2px solid var(--accent);border-radius:5px;
    padding:15px 18px;margin:18px 0;color:var(--ink-2);font-size:14.5px}
  .note strong{color:var(--ink)}
  .prices{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
  .tier{background:var(--surface);border:1px solid var(--rule);border-radius:7px;padding:14px 16px}
  .tier b{display:block;font-size:13px;color:var(--ink-3);font-weight:600;
    text-transform:uppercase;letter-spacing:.05em}
  .tier .amt{font-size:24px;font-weight:600;letter-spacing:-.02em}
  .tier .amt span{font-size:13px;font-weight:400;color:var(--ink-3)}
  .tier .r{font-size:13.5px;color:var(--ink-2)}
  .ctarow{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
  .btn{display:inline-block;padding:11px 20px;border-radius:6px;text-decoration:none;
    font-weight:600;font-size:14.5px;border:1px solid var(--rule);color:var(--ink)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--rule);
    color:var(--ink-3);font-size:13.5px}
</style>
</head>
<body><div class="wrap">
<nav>
  <a class="brand" href="/">${logoMark(21)}<span>Screenshotline</span></a>
  <a href="/docs">Docs</a>
  <a href="/blog">Blog</a>
  <a href="/pricing">Pricing</a>
  <a href="/account">Account</a>
</nav>

<h1>A screenshot API that survives production</h1>
<p class="lede">URL in, image out. <strong>One GET request</strong>, binary response,
no JSON envelope to unwrap — so the URL works directly inside an <code>&lt;img src&gt;</code>.</p>

<form id="f">
  <input type="url" id="url" value="https://example.com" required placeholder="https://...">
  <button id="go" type="submit">Capture</button>
</form>
<div class="opts">
  <label><input type="checkbox" id="full"> full page</label>
  <label><input type="checkbox" id="ads" checked> block ads</label>
  <label><input type="checkbox" id="cookies" checked> block cookie banners</label>
  <label><input type="checkbox" id="popups" checked> block popups</label>
  <label><input type="checkbox" id="dark"> dark mode</label>
</div>
<pre id="curl">GET /take?url=https%3A%2F%2Fexample.com</pre>
<div id="out">Try it — no signup, no key.</div>
<div class="meta" id="meta"></div>

<h2>Most screenshot failures are not crashes</h2>
<p>They are a 200 with the wrong picture: a consent wall, a half-loaded page, a
blank frame your pipeline records as a success. We built a 202-page benchmark of
the real web to find them, and each of these is a fix it forced.</p>

<div class="grid">
  <div class="card">
    <h3>Banners injected after load</h3>
    <p>A one-shot sweep loses that race. We install an observer before any page
    script runs, so a banner that appears two seconds late is still removed.</p>
  </div>
  <div class="card">
    <h3>Ad slots that leave a hole</h3>
    <p>Blocking the request does not reclaim the space. Most tools leave a grey
    gap that pushes content below the fold. We collapse the empty slot.</p>
  </div>
  <div class="card">
    <h3>Pages that never go idle</h3>
    <p>Waiting for an event modern sites never emit turns a 3-second capture into
    a timeout. We wait for interactive, then spend one bounded settle budget.</p>
  </div>
  <div class="card">
    <h3>Pages that wedge themselves</h3>
    <p>Some pages block their own main thread and stop answering. Every wait has
    a ceiling, so one stuck page cannot hold a slot or hang your request.</p>
  </div>
  <div class="card">
    <h3>Blank captures</h3>
    <p>Detected with two independent signals and reported in a header. A bot wall
    is never silently returned as a success — or billed as one.</p>
  </div>
  <div class="card">
    <h3>Keys in public HTML</h3>
    <p>The headline use case is <code>&lt;img src&gt;</code>, where a raw key is a
    billing incident waiting to happen. HMAC signed URLs are a v1 feature.</p>
  </div>
</div>

<h2>Measured against the incumbents</h2>
<p>18 news front pages — consent walls, lazy images, heavy embeds — captured
through all three APIs on the same day at the same viewport.</p>

<table>
  <thead><tr><th>18 news pages</th><th>Screenshotline</th><th>ScreenshotOne</th><th>ApiFlash</th></tr></thead>
  <tbody>
    <tr><td>Captured</td><td class="num win">18/18</td><td class="num">17/18</td><td class="num">18/18</td></tr>
    <tr><td>timesofindia.com</td><td class="num win">414 KB</td><td class="num">261 KB</td><td class="num">358 KB</td></tr>
    <tr><td>Pages within 10% of the best</td><td class="num">13 of 17</td><td class="num">&mdash;</td><td class="num">&mdash;</td></tr>
  </tbody>
</table>
<p style="font-size:13.5px;color:var(--ink-3)">Bytes are a proxy for how much of
the page actually rendered. We publish the method rather than a marketing claim
— and the one page we lose on is blocked at the network edge, not mis-rendered.</p>

<h2>Also returns the page as Markdown</h2>
<p>Same render — JavaScript executed, banners dismissed, lazy images loaded —
read as text instead of photographed. Built for feeding live pages to models.</p>
<pre>curl "https://api.screenshotline.com/extract?url=https%3A%2F%2Fexample.com&amp;access_key=KEY"</pre>
<div class="note">
  A plain fetch of <code>app.netlify.com</code> returns 121 characters of visible
  text, and they read <em>"The Netlify dashboard needs JavaScript :("</em>.
  Rendered first, the same URL returns the actual page. There is an
  <a href="/docs/extract">MCP server</a> too, so agents can call it directly.
</div>

<h2>Pricing</h2>
<div class="prices">
  <div class="tier"><b>Free</b><div class="amt">$0</div><div class="r">500 renders — no card</div></div>
  <div class="tier"><b>Starter</b><div class="amt">$17<span>/mo</span></div><div class="r">2,000 renders</div></div>
  <div class="tier"><b>Growth</b><div class="amt">$79<span>/mo</span></div><div class="r">10,000 renders</div></div>
  <div class="tier"><b>Scale</b><div class="amt">$259<span>/mo</span></div><div class="r">50,000 renders</div></div>
</div>
<div class="note">
  <strong>Failed renders and cache hits are never billed.</strong> Most APIs
  promise this; blank detection is what lets us mean it literally.
</div>
<div class="ctarow">
  <a class="btn primary" href="/account">Start free — no card</a>
  <a class="btn" href="/pricing">Full pricing</a>
  <a class="btn" href="/docs">Read the docs</a>
</div>

<h2>Parameters</h2>
<table>
  <tr><td>url</td><td>Required. http or https. Private and reserved addresses are refused.</td></tr>
  <tr><td>format</td><td>png (default), jpeg, webp, pdf</td></tr>
  <tr><td>full_page</td><td>Capture the whole document. Scrolls first so lazy images load.</td></tr>
  <tr><td>selector</td><td>Capture one element instead of the viewport.</td></tr>
  <tr><td>viewport_width<br>viewport_height</td><td>Defaults 1280&times;800.</td></tr>
  <tr><td>device_scale_factor</td><td>2 for retina output.</td></tr>
  <tr><td>block_ads<br>block_cookie_banners</td><td>Blocks the networks and sweeps leftover overlays.</td></tr>
  <tr><td>delay</td><td>Extra wait in ms before capture, max ${config.maxDelayMs}.</td></tr>
  <tr><td>wait_until</td><td>domcontentloaded (default), load, networkidle0, networkidle2. The default is deliberate — see the docs.</td></tr>
  <tr><td>cache<br>cache_ttl</td><td>Serve from the store when warm. TTL in seconds.</td></tr>
  <tr><td>access_key</td><td>Or the <code>X-Access-Key</code> header.</td></tr>
  <tr><td>signature</td><td>HMAC of the sorted query. Required for browser-visible URLs.</td></tr>
</table>
<p><a href="/docs">Full docs</a>, with copy-paste quickstarts for
<a href="/docs/curl">curl</a>, <a href="/docs/node">Node</a>,
<a href="/docs/python">Python</a>, <a href="/docs/php">PHP</a> and
<a href="/docs/go">Go</a>.</p>

<footer>
  <a href="/docs">Docs</a> &middot;
  <a href="/blog">Blog</a> &middot;
  <a href="/pricing">Pricing</a> &middot;
  <a href="/account">Account</a> &middot;
  <a href="/docs/extract">Page to Markdown</a> &middot;
  <a href="https://status.screenshotline.com">Status</a> &middot;
  <a href="/terms">Terms</a>
</footer>
</div>

<script>
const $ = (id) => document.getElementById(id);
function buildQuery() {
  const p = new URLSearchParams({ url: $('url').value });
  if ($('full').checked) p.set('full_page', 'true');
  if ($('ads').checked) p.set('block_ads', 'true');
  if ($('cookies').checked) p.set('block_cookie_banners', 'true');
  if ($('popups').checked) p.set('block_popups', 'true');
  if ($('dark').checked) p.set('color_scheme', 'dark');
  return p;
}
function refresh() { $('curl').textContent = 'GET /take?' + buildQuery().toString(); }
['url','full','ads','cookies','popups','dark'].forEach((id) => $(id).addEventListener('input', refresh));
refresh();

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('go');
  btn.disabled = true;
  $('out').textContent = 'Rendering...';
  $('meta').textContent = '';
  const started = Date.now();
  try {
    // /demo, not /take: the demo renders without a key so the product can be
    // evaluated in ten seconds. It is rationed per IP.
    const res = await fetch('/demo?' + buildQuery().toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $('out').textContent = body.error
        ? body.error.message
        : 'Request failed (' + res.status + ')';
      return;
    }
    const blob = await res.blob();
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    $('out').replaceChildren(img);
    $('meta').textContent = [
      'render ' + (res.headers.get('X-Render-Ms') || '?') + 'ms',
      'round trip ' + (Date.now() - started) + 'ms',
      'blocked ' + (res.headers.get('X-Blocked-Requests') || '0') + ' requests',
      Math.round(blob.size / 1024) + ' KB',
    ].join('  |  ');
  } catch (err) {
    $('out').textContent = 'Network error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;
}

export default landingPage;
