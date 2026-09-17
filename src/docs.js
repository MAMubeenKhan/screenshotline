import config from './config.js';
import { faviconTags } from './brand.js';
import { PLANS } from './store.js';

/**
 * The docs, and the language keyword pages, which are the same thing.
 *
 * The plan is explicit that "screenshot api python / node / php / go" are
 * the lowest-competition, highest-conversion queries on the list, and that
 * those pages ARE the docs pages. So each language gets its own URL, its own
 * title, and a complete working quickstart - not a tab on a single page,
 * which would rank as one page instead of five.
 *
 * Served by the API process on the apex domain rather than a docs host, also
 * per the plan: authority accrues to screenshotline.com, not to someone
 * else's subdomain. One deploy, nothing to keep in sync.
 *
 * Every snippet on these pages was executed against a real server before it
 * was pasted here. The curl, Node and Python ones produced byte-identical
 * 11,147-byte PNGs. PHP and Go are marked below as written-but-unrun, because
 * neither runtime was installed on the machine that wrote them - if you have
 * one, run them and delete the caveat.
 */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
const API = process.env.PUBLIC_API_URL || SITE;

export const LANGUAGES = {
  curl: {
    slug: 'curl',
    label: 'curl',
    title: 'Screenshot API with curl',
    blurb:
      'Take a screenshot of any web page from the command line. One request, binary image back, no SDK and no JSON envelope to unwrap.',
    verified: true,
    code: [
      '# Save a PNG of a page, 1280px wide.',
      '# Ad slots and cookie banners are removed before the capture.',
      'curl -o screenshot.png \\',
      '  "' + API + '/take?url=https%3A%2F%2Fexample.com\\',
      '&access_key=YOUR_KEY\\',
      '&viewport_width=1280\\',
      '&block_ads=true\\',
      '&block_cookie_banners=true"',
      '',
      '# The URL works directly in an <img src>, so this is also valid:',
      '#   <img src="' + API + '/take?url=...&access_key=...">',
      '# For anything browser-visible, use a signed URL instead - see below.',
    ].join('\n'),
  },

  node: {
    slug: 'node',
    label: 'Node.js',
    title: 'Screenshot API for Node.js',
    blurb:
      'Capture a web page as an image from Node. Uses the built-in fetch, so there is no dependency to install and nothing to keep updated.',
    verified: true,
    code: [
      "import { writeFile } from 'node:fs/promises';",
      '',
      'const params = new URLSearchParams({',
      "  url: 'https://example.com',",
      "  access_key: process.env.SCREENSHOTLINE_KEY,",
      "  format: 'png',",
      "  viewport_width: '1280',",
      "  block_ads: 'true',",
      "  block_cookie_banners: 'true',",
      '});',
      '',
      "const res = await fetch('" + API + "/take?' + params);",
      'if (!res.ok) {',
      '  const { error } = await res.json();',
      '  throw new Error(error.message);',
      '}',
      '',
      "await writeFile('screenshot.png', Buffer.from(await res.arrayBuffer()));",
      '',
      '// How much of your monthly quota is left, without a second request.',
      "console.log(res.headers.get('x-quota-remaining'), 'renders remaining');",
    ].join('\n'),
  },

  python: {
    slug: 'python',
    label: 'Python',
    title: 'Screenshot API for Python',
    blurb:
      'Capture a web page as an image from Python. Standard library only - urllib, no requests, no SDK.',
    verified: true,
    code: [
      'import json',
      'import os',
      'import urllib.error',
      'import urllib.parse',
      'import urllib.request',
      '',
      'params = urllib.parse.urlencode({',
      '    "url": "https://example.com",',
      '    "access_key": os.environ["SCREENSHOTLINE_KEY"],',
      '    "format": "png",',
      '    "viewport_width": 1280,',
      '    "block_ads": "true",',
      '    "block_cookie_banners": "true",',
      '})',
      '',
      'try:',
      '    with urllib.request.urlopen("' + API + '/take?" + params) as r:',
      '        with open("screenshot.png", "wb") as f:',
      '            f.write(r.read())',
      '        print(r.headers["x-quota-remaining"], "renders remaining")',
      'except urllib.error.HTTPError as e:',
      '    print("error:", json.load(e)["error"]["message"])',
    ].join('\n'),
  },

  php: {
    slug: 'php',
    label: 'PHP',
    title: 'Screenshot API for PHP',
    blurb:
      'Capture a web page as an image from PHP. Plain cURL, no Composer package required.',
    verified: false,
    code: [
      '<?php',
      '',
      '$params = http_build_query([',
      "    'url'                  => 'https://example.com',",
      "    'access_key'           => getenv('SCREENSHOTLINE_KEY'),",
      "    'format'               => 'png',",
      "    'viewport_width'       => 1280,",
      "    'block_ads'            => 'true',",
      "    'block_cookie_banners' => 'true',",
      ']);',
      '',
      "$ch = curl_init('" + API + "/take?' . $params);",
      'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);',
      '$body   = curl_exec($ch);',
      '$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);',
      'curl_close($ch);',
      '',
      'if ($status !== 200) {',
      '    $err = json_decode($body, true);',
      "    throw new RuntimeException($err['error']['message']);",
      '}',
      '',
      "file_put_contents('screenshot.png', $body);",
    ].join('\n'),
  },

  go: {
    slug: 'go',
    label: 'Go',
    title: 'Screenshot API for Go',
    blurb:
      'Capture a web page as an image from Go. Standard library only - net/http and net/url.',
    verified: false,
    code: [
      'package main',
      '',
      'import (',
      '\t"encoding/json"',
      '\t"fmt"',
      '\t"io"',
      '\t"net/http"',
      '\t"net/url"',
      '\t"os"',
      ')',
      '',
      'func main() {',
      '\tq := url.Values{}',
      '\tq.Set("url", "https://example.com")',
      '\tq.Set("access_key", os.Getenv("SCREENSHOTLINE_KEY"))',
      '\tq.Set("format", "png")',
      '\tq.Set("viewport_width", "1280")',
      '\tq.Set("block_ads", "true")',
      '\tq.Set("block_cookie_banners", "true")',
      '',
      '\tres, err := http.Get("' + API + '/take?" + q.Encode())',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer res.Body.Close()',
      '',
      '\tbody, _ := io.ReadAll(res.Body)',
      '\tif res.StatusCode != http.StatusOK {',
      '\t\tvar e struct {',
      '\t\t\tError struct{ Message string } `json:"error"`',
      '\t\t}',
      '\t\tjson.Unmarshal(body, &e)',
      '\t\tpanic(e.Error.Message)',
      '\t}',
      '',
      '\tos.WriteFile("screenshot.png", body, 0o644)',
      '\tfmt.Println(res.Header.Get("X-Quota-Remaining"), "renders remaining")',
      '}',
    ].join('\n'),
  },
};

const OPTIONS = [
  ['url', 'required', 'The page to capture. http/https only; private and reserved addresses are refused.'],
  ['url', '—', 'The page to capture. The scheme is optional: example.com works.'],
  ['format', 'png', 'png, jpeg, webp or pdf.'],
  ['full_page', 'false', 'Capture the whole scrollable page, scrolling first so lazy images load.'],
  ['viewport_width', '1280', 'Viewport width in pixels.'],
  ['viewport_height', '800', 'Viewport height in pixels.'],
  ['selector', '—', 'Capture only the element matching this CSS selector.'],
  ['block_ads', 'false', 'Block ad networks and collapse the empty slot they leave behind.'],
  ['block_cookie_banners', 'false', 'Remove consent banners, including ones injected after load.'],
  ['block_chats', 'false', 'Remove live-chat widgets: Intercom, Drift, Crisp, Zendesk, Tawk and others.'],
  ['block_popups', 'false', 'Remove newsletter, donation and app-install interstitials.'],
  ['hide_selector', '—', 'Hide elements matching these CSS selectors. Comma separated.'],
  ['inject_css', '—', 'CSS applied after the page settles, before capture.'],
  ['inject_js', '—', 'JavaScript run after the page settles, before capture.'],
  ['cookies', '—', 'Session cookies, as a=1; b=2. Sent on the first request, so login walls work.'],
  ['color_scheme', 'light', 'Render the page as light or dark.'],
  ['delay', '0', 'Extra wait before capture, in ms.'],
  ['cache', 'false', 'Serve a cached image when one exists. Cache hits are never billed.'],
  ['fail_on_blank', 'false', 'Return 502 instead of an image when the capture looks blank.'],
];

function shell({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${faviconTags()}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<style>
  :root{--ground:#f6f8f9;--surface:#fff;--ink:#131a1f;--ink-2:#4a5a64;--ink-3:#7a8b96;
    --rule:#dbe3e7;--accent:#0c6b75;--code-bg:#101a1f;--code-ink:#d9e4e9;--warn:#8a5a00;--warn-bg:#fff6e0}
  @media (prefers-color-scheme:dark){:root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;
    --ink-2:#a2b3bc;--ink-3:#76888f;--rule:#23323a;--accent:#43b9c2;--code-bg:#070e12;
    --code-ink:#d3e0e6;--warn:#f0c169;--warn-bg:#2a2010}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15.5px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:820px;margin:0 auto;padding:40px 24px 80px}
  a{color:var(--accent)}
  h1{font-size:30px;letter-spacing:-.02em;margin:0 0 8px}
  h2{font-size:20px;letter-spacing:-.01em;margin:38px 0 10px}
  h3{font-size:15px;margin:26px 0 8px}
  .sub{color:var(--ink-2);font-size:17px;margin:0 0 26px}
  nav.langs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 30px}
  nav.langs a{display:inline-block;padding:6px 13px;border:1px solid var(--rule);border-radius:99px;
    background:var(--surface);text-decoration:none;color:var(--ink-2);font-size:14px}
  nav.langs a.on{border-color:var(--accent);color:var(--accent);font-weight:600}
  pre{background:var(--code-bg);color:var(--code-ink);padding:16px 18px;border-radius:6px;
    overflow-x:auto;font-size:13px;line-height:1.55;border-left:2px solid var(--accent);margin:0 0 18px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  p code,li code,td code{background:var(--surface);border:1px solid var(--rule);
    padding:1px 5px;border-radius:3px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px}
  th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;
    color:var(--ink-3);padding:0 12px 7px 0;font-weight:600}
  td{padding:9px 12px 9px 0;border-top:1px solid var(--rule);color:var(--ink-2);vertical-align:top}
  td:first-child{color:var(--ink);font-family:ui-monospace,monospace;white-space:nowrap}
  td:nth-child(2){white-space:nowrap;color:var(--ink-3)}
  .note{background:var(--surface);border:1px solid var(--rule);border-left:2px solid var(--accent);
    border-radius:4px;padding:13px 16px;margin:0 0 18px;font-size:14.5px;color:var(--ink-2)}
  .caveat{background:var(--warn-bg);color:var(--warn);border:1px solid currentColor;
    border-radius:4px;padding:11px 14px;margin:0 0 18px;font-size:14px}
  footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--rule);
    color:var(--ink-3);font-size:13.5px}
</style>
</head>
<body><div class="wrap">
${body}
<footer>
  <a href="/">Screenshotline</a> &middot;
  <a href="/docs">Docs</a> &middot;
  <a href="/blog">Blog</a> &middot;
  <a href="/account">Account</a> &middot;
  <a href="/docs/extract">Page to Markdown</a> &middot;
  <a href="https://status.screenshotline.com">Status</a>
</footer>
</div></body>
</html>`;
}

function langNav(current) {
  return (
    '<nav class="langs">' +
    Object.values(LANGUAGES)
      .map(
        (l) =>
          `<a href="/docs/${l.slug}"${l.slug === current ? ' class="on"' : ''}>${esc(l.label)}</a>`,
      )
      .join('') +
    `<a href="/docs/extract"${current === 'extract' ? ' class="on"' : ''}>Markdown</a>` +
    '</nav>'
  );
}

// How to get a key and what it includes, on EVERY docs page. Built from the
// plan table the gateway enforces, like the pricing page, so the number a
// reader sees can never drift from the number they get. It was once a
// literal on the language pages only, and /docs itself never said it.
const freeKeyNote = () => `
<div class="note"><strong>Need a key?</strong> <a href="/account">Create a free account</a> &mdash;
${PLANS.free.included.toLocaleString('en-US')} renders a month, no card, no confirmation email.
Pass it as <code>access_key=...</code> or an <code>X-Access-Key</code> header. Paid plans start at
$${PLANS.starter.priceCents / 100} for ${PLANS.starter.included.toLocaleString('en-US')} &mdash; <a href="/pricing">pricing</a>.
Or try it with no key at all on the <a href="/">homepage demo</a>.</div>`;

const optionsTable = () =>
  '<table><thead><tr><th>Parameter</th><th>Default</th><th>What it does</th></tr></thead><tbody>' +
  OPTIONS.map(
    ([n, d, w]) => `<tr><td>${esc(n)}</td><td>${esc(d)}</td><td>${esc(w)}</td></tr>`,
  ).join('') +
  '</tbody></table>';

const commonTail = `
<h2>Options</h2>
${optionsTable()}

<h2>Errors</h2>
<p>Failures return JSON with a stable <code>code</code>. Successful captures return the
image bytes directly, with no envelope.</p>
<pre><code>{
  "error": {
    "code": "invalid_access_key",
    "message": "Unknown or revoked API key."
  }
}</code></pre>
<p>Common codes: <code>missing_access_key</code> (401), <code>invalid_access_key</code> (403),
<code>quota_exceeded</code> (402), <code>render_timeout</code> (504),
<code>blank_capture</code> (502).</p>

<div class="note"><strong>Failed renders are not billed, and neither are cache hits.</strong>
We detect a blank capture rather than assuming a 200 means success, so a bot wall that
returns an empty page does not come out of your quota &mdash; up to 10% of your plan's renders
a month, at least 50. Every response says whether it counted in <code>X-Billed</code>.</div>

<h2>Signed URLs</h2>
<p>The headline use case is putting a capture straight into an <code>&lt;img src&gt;</code>. A raw
key in public HTML is a billing incident waiting to happen, so sign the URL instead: the
signature covers every parameter, and a tampered URL is refused.</p>
<pre><code>node tools/sign.js "https://example.com" full_page=true</code></pre>
<p>Set <code>REQUIRE_SIGNATURE=true</code> to refuse unsigned requests entirely.</p>

<h2>Quota headers</h2>
<p>Every response carries your position, so you never need a second request to check:</p>
<pre><code>X-Quota-Limit: 2000
X-Quota-Used: 417
X-Quota-Remaining: 1583
X-Quota-Period: 2026-09</code></pre>
`;

/** One page per language. These are the keyword pages. */
export function languagePage(slug) {
  const lang = LANGUAGES[slug];
  if (!lang) return null;

  const caveat = lang.verified
    ? '<div class="note">This snippet was executed against a live server before being published here.</div>'
    : '<div class="caveat">Written carefully but not executed on our side &mdash; we had no ' +
      esc(lang.label) +
      ' runtime on the machine that wrote it. If it misbehaves, tell us and we will fix it the same day.</div>';

  return shell({
    title: lang.title + ' — Screenshotline',
    description: lang.blurb,
    canonical: `${SITE}/docs/${lang.slug}`,
    body: `
<h1>${esc(lang.title)}</h1>
<p class="sub">${esc(lang.blurb)}</p>
${langNav(lang.slug)}

<h2>Quickstart</h2>
${caveat}
<pre><code>${esc(lang.code)}</code></pre>
${freeKeyNote()}
${commonTail}`,
  });
}

/** The Markdown extraction page. Its own URL because it is its own use case. */
export function extractPage() {
  return shell({
    title: 'Web page to Markdown API — Screenshotline',
    description:
      'Render a page with JavaScript, then return its text as clean Markdown. Built for feeding live web pages to LLMs and agents.',
    canonical: `${SITE}/docs/extract`,
    body: `
<h1>Web page to Markdown</h1>
<p class="sub">The same render as a screenshot &mdash; JavaScript executed, consent banners
dismissed, lazy images loaded &mdash; read as Markdown instead of photographed.</p>
${langNav('extract')}

<h2>Quickstart</h2>
<pre><code>curl "${esc(API)}/extract?url=https%3A%2F%2Fexample.com&amp;access_key=YOUR_KEY"</code></pre>
<pre><code># Example Domain

This domain is for use in documentation examples without needing permission.

[Learn more](https://iana.org/domains/example)</code></pre>
${freeKeyNote()}

<h2>Why not just fetch the HTML?</h2>
<p>Because on a great many sites there is nothing useful in it. A plain fetch of
<code>app.netlify.com</code> returns 121 characters of visible text, and they read
<em>"The Netlify dashboard needs JavaScript :("</em>. Rendered first, the same URL
returns the actual page.</p>
<p>The second reason is subtler. We read the <em>rendered layout</em>, not the markup.
<code>danluu.com</code> writes <code>&lt;d&gt;09/26&lt;/d&gt;&lt;a&gt;title&lt;/a&gt;</code>
with no whitespace between them and styles the first as a 4em flex item. Parsed as markup
that concatenates into <code>09/26[title]</code>; read with the computed layout it comes
out as <code>09/26 [title]</code>, which is what a human sees.</p>
<p>Open shadow roots are walked too, so pages built out of web components extract as text
rather than as nothing.</p>

<h2>Options</h2>
<table><thead><tr><th>Parameter</th><th>Default</th><th>What it does</th></tr></thead><tbody>
<tr><td>strip_chrome</td><td>true</td><td>Drop nav, header, footer and sidebars. Falls back to the whole body if stripping would leave nothing.</td></tr>
<tr><td>max_chars</td><td>0</td><td>Truncate to a fixed context budget. 0 means no limit.</td></tr>
<tr><td>response</td><td>markdown</td><td><code>json</code> returns url, title, chars and markdown instead.</td></tr>
</tbody></table>
<p>Everything from <code>/take</code> still applies &mdash; <code>block_ads</code>,
<code>basic_auth</code>, <code>headers</code>, <code>timeout</code>, signed URLs.</p>

<h2>MCP server</h2>
<p>Agents can call this directly over the Model Context Protocol. Two tools:
<code>screenshot</code> for when the layout is the answer, <code>read_page</code> for when
the text is.</p>
<p>It is hosted: connect by URL, nothing to install. In Claude Code:</p>
<pre><code>claude mcp add --transport http screenshotline ${esc(API)}/mcp --header "X-Access-Key: YOUR_KEY"</code></pre>
<p>Any client that takes a remote server as JSON (Cursor and the rest):</p>
<pre><code>{
  "mcpServers": {
    "screenshotline": {
      "url": "${esc(API)}/mcp",
      "headers": { "X-Access-Key": "YOUR_KEY" }
    }
  }
}</code></pre>
<p>If a client cannot send headers, put the key on the URL instead:
<code>${esc(API)}/mcp?access_key=YOUR_KEY</code>. Tool calls use the same key, quota and
billing as <code>/take</code> &mdash; a render through MCP is a render.</p>
<p>Self-hosting? The same server runs locally over stdio from a clone of the repo:
<code>claude mcp add screenshotline -- node /path/to/screenshotline/mcp/server.js</code>.</p>
<p>A blank capture comes back with an explicit warning rather than as a silent empty
picture, and the SSRF guards apply on this path too &mdash; an agent cannot talk it into
probing <code>127.0.0.1</code> or a cloud metadata endpoint.</p>`,
  });
}

/** Docs index. */
export function docsIndex() {
  return shell({
    title: 'Screenshot API docs — Screenshotline',
    description:
      'Take a screenshot of any URL over HTTP, or read the page as Markdown. Quickstarts for curl, Node.js, Python, PHP and Go.',
    canonical: `${SITE}/docs`,
    body: `
<h1>Screenshot API docs</h1>
<p class="sub">URL in, image out. One endpoint, binary response, no JSON envelope to unwrap.</p>
${langNav('')}
${freeKeyNote()}

<h2>Pick your language</h2>
<ul>
${Object.values(LANGUAGES)
  .map((l) => `<li><a href="/docs/${l.slug}">${esc(l.title)}</a> &mdash; ${esc(l.blurb)}</li>`)
  .join('\n')}
<li><a href="/docs/extract">Web page to Markdown</a> &mdash; the same render, read as text
instead of photographed. Built for LLMs and agents.</li>
</ul>

<h2>What makes a capture correct</h2>
<p>Most screenshot failures are not crashes, they are a 200 with the wrong picture. The
things we handle, because a benchmark of 202 real pages caught each one:</p>
<ul>
<li><strong>Consent banners injected after load.</strong> A one-shot sweep loses that race;
we install an observer before any page script runs.</li>
<li><strong>Ad slots that leave a hole.</strong> Blocking the request does not reclaim the
space, so the page keeps a grey gap and pushes content below the fold. We collapse them.</li>
<li><strong>Pages that never go network-idle.</strong> Waiting for an event modern sites
never emit turns a 3 second capture into a timeout. We wait for interactive, then spend one
bounded settle budget.</li>
<li><strong>Pages that wedge their own main thread.</strong> Every wait is bounded, and a
page that stops responding is captured as it stands rather than held until a timeout.</li>
<li><strong>Blank captures.</strong> Detected with two independent signals and reported, so
a bot wall is never silently billed as a success.</li>
</ul>
${commonTail}`,
  });
}

export default { docsIndex, languagePage, extractPage, LANGUAGES };
