import { faviconTags, logoMark } from './brand.js';

/**
 * The keyword landing pages.
 *
 * The plan names three: "website screenshot api", "url to image api",
 * "html to image api". They are separate URLs for the same reason the language
 * docs are - one page targeting three phrases ranks for none of them well.
 *
 * These are NOT the docs. Someone arriving here typed a description of a job
 * into a search box; they want to know whether this does that job and what it
 * costs, then a working snippet. The docs are one click away for when they
 * decide yes.
 *
 * Every claim here is one the benchmark can back. No adjectives that a
 * competitor could equally write.
 */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
const API = process.env.PUBLIC_API_URL || SITE;

export const PAGES = {
  'website-screenshot-api': {
    slug: 'website-screenshot-api',
    h1: 'Website screenshot API',
    title: 'Website Screenshot API — capture any URL as an image',
    description:
      'Turn any website into a PNG, JPEG, WebP or PDF over HTTP. Handles cookie banners, lazy images and late-rendering pages. Free tier, no card required.',
    lede:
      'Send a URL, get an image back. One GET request, binary response, no JSON envelope — so the URL drops straight into an <code>&lt;img src&gt;</code>.',
    snippet: `curl -o website.png \\
  "${API}/take?url=https%3A%2F%2Fexample.com\\
&access_key=YOUR_KEY\\
&block_cookie_banners=true\\
&full_page=true"`,
    useCases: [
      ['Link previews and Open Graph images', 'Render the page once, cache it, serve it. Cache hits are never billed.'],
      ['Visual site audits', 'Capture a list of URLs at a fixed viewport and diff them over time.'],
      ['Monitoring and change detection', 'Watch a competitor page or your own checkout for visual regressions.'],
      ['Documentation and reports', 'Embed a live view of a dashboard or a landing page into a PDF.'],
    ],
    focus: 'full',
  },

  'url-to-image-api': {
    slug: 'url-to-image-api',
    h1: 'URL to image API',
    title: 'URL to Image API — convert a link into a PNG or JPEG',
    description:
      'Convert any URL to an image with a single HTTP request. PNG, JPEG, WebP or PDF, custom viewport, full page or a single element. Free tier, no card.',
    lede:
      'A URL in the query string, an image in the response body. Nothing to install, no SDK, no second round trip to fetch the file.',
    snippet: `# PNG at a custom viewport
curl -o out.png "${API}/take?url=https%3A%2F%2Fexample.com&viewport_width=1440&access_key=KEY"

# JPEG at 70% quality
curl -o out.jpg "${API}/take?url=https%3A%2F%2Fexample.com&format=jpeg&quality=70&access_key=KEY"

# Just one element
curl -o card.png "${API}/take?url=https%3A%2F%2Fexample.com&selector=%23pricing&access_key=KEY"`,
    useCases: [
      ['Thumbnails at scale', 'A queue of URLs in, a folder of images out. Failed renders are not billed.'],
      ['Retina output', '<code>device_scale_factor=2</code> for displays that deserve it.'],
      ['One element, not the page', 'Pass a CSS <code>selector</code> and get just that component.'],
      ['Signed URLs for public HTML', 'HMAC over the query, so a key never appears in a page anyone can view-source.'],
    ],
    focus: 'formats',
  },

  'html-to-image-api': {
    slug: 'html-to-image-api',
    h1: 'HTML to image API',
    title: 'HTML to Image API — render a page to PNG or PDF',
    description:
      'Render a live web page to PNG, JPEG, WebP or PDF. JavaScript executed, web fonts loaded, lazy images triggered. Free tier, no card required.',
    lede:
      'Rendered by a real browser, not an HTML-to-canvas approximation. JavaScript runs, web fonts load, CSS grid and flexbox lay out exactly as they do for a visitor.',
    snippet: `# PDF, for reports and invoices
curl -o page.pdf "${API}/take?url=https%3A%2F%2Fexample.com&format=pdf&access_key=KEY"

# Dark mode
curl -o dark.png "${API}/take?url=https%3A%2F%2Fexample.com&color_scheme=dark&access_key=KEY"

# Behind basic auth
curl -o private.png "${API}/take?url=https%3A%2F%2Fexample.com&basic_auth=user%3Apass&access_key=KEY"`,
    useCases: [
      ['PDF reports', 'Same render path as an image, so what you see is what prints.'],
      ['Light and dark variants', '<code>color_scheme</code> flips the page as a visitor would see it.'],
      ['Pages behind auth', '<code>basic_auth</code>, custom headers, and your own user agent.'],
      ['Page to Markdown', 'The same render read as text instead of photographed, for LLMs and agents.'],
    ],
    focus: 'render',
  },
};

const shared = `
<h2>What breaks, and what this does about it</h2>
<p>Most screenshot failures are not crashes. They are a 200 with the wrong
picture — a consent wall, a half-loaded page, a blank frame your pipeline
records as a success. These are the ones a 202-page benchmark of the real web
actually found:</p>
<ul>
  <li><strong>Consent banners injected after load.</strong> A one-shot sweep loses
  that race, so an observer is installed before any page script runs.</li>
  <li><strong>Ad slots that leave a hole.</strong> Blocking the request does not
  reclaim the space — most tools leave a grey gap that pushes content below the
  fold. The empty slot is collapsed.</li>
  <li><strong>Lazy images below the fold.</strong> Full-page captures scroll the
  document first, then return to the top.</li>
  <li><strong>Hero videos that have not buffered.</strong> A video with no frame
  paints a black rectangle indistinguishable from a broken capture.</li>
  <li><strong>Blank captures.</strong> Detected with two independent signals and
  reported in a header, so a bot wall is never silently billed as a success.</li>
</ul>

<h2>Measured against the incumbents</h2>
<p>18 news front pages — consent walls, lazy images, heavy embeds — captured
through three APIs on the same day at the same viewport.</p>
<table>
  <thead><tr><th>18 news pages</th><th>Screenshotline</th><th>ScreenshotOne</th><th>ApiFlash</th></tr></thead>
  <tbody>
    <tr><td>Captured</td><td class="win">18/18</td><td>17/18</td><td>18/18</td></tr>
    <tr><td>timesofindia.com</td><td class="win">414 KB</td><td>261 KB</td><td>358 KB</td></tr>
  </tbody>
</table>

<h2>Pricing</h2>
<p><strong>Free: 500 renders a month, no credit card.</strong> Then $17 for 2,000,
$79 for 10,000, $259 for 50,000 — with overage priced <em>below</em> the plan
rate, so a spiky month costs less per render rather than more.</p>
<p><strong>Failed renders and cache hits are never billed.</strong> Most APIs
promise that; blank detection is what lets this one mean it literally.</p>
<p><a href="/pricing">Full pricing</a> &middot; <a href="/docs">Documentation</a></p>

<h2>Open source</h2>
<p>The renderer is AGPL-3.0 and self-hostable — the same code that runs here,
with nothing held back for the hosted version. Read it before you trust it, or
run it yourself. The paid product is the hosted API: a warm browser pool, a
cache, and someone else's pager.</p>
`;

/**
 * The page frame shared by the keyword pages and the comparison pages: head,
 * styles, nav and footer. One copy, so the two sets of pages cannot drift
 * apart. extraCss is appended inside the same <style> block.
 */
export function pageShell({ title, description, canonical, body, extraCss = '', extraHead = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${faviconTags()}${extraHead ? `\n${extraHead}` : ''}
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
  .wrap{max-width:820px;margin:0 auto;padding:0 24px 80px}
  nav{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:14.5px}
  nav .brand{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none;
    margin-right:auto;display:flex;align-items:center;gap:8px}
  nav a{text-decoration:none;color:var(--ink-2)}
  h1{font-size:34px;letter-spacing:-.025em;margin:26px 0 10px}
  .lede{font-size:18px;color:var(--ink-2);margin:0 0 22px;max-width:60ch}
  h2{font-size:21px;letter-spacing:-.01em;margin:46px 0 10px}
  p,li{max-width:68ch}
  pre{background:var(--code-bg);color:var(--code-ink);padding:15px 17px;border-radius:6px;
    overflow-x:auto;font-size:13px;line-height:1.55;border-left:2px solid var(--accent);margin:0 0 18px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  p code,li code,td code{background:var(--surface);border:1px solid var(--rule);
    padding:1px 5px;border-radius:3px;font-size:13px;white-space:nowrap}
  ul{padding-left:20px}
  li{margin:6px 0}
  .cases{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin:18px 0}
  .case{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:15px 17px}
  .case h3{margin:0 0 4px;font-size:15px}
  .case p{margin:0;font-size:14px;color:var(--ink-2);max-width:none}
  table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}
  th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;
    color:var(--ink-3);padding:0 12px 7px 0;font-weight:600}
  td{padding:9px 12px 9px 0;border-top:1px solid var(--rule);color:var(--ink-2)}
  td:first-child{color:var(--ink)}
  .win{color:var(--accent);font-weight:600;font-family:ui-monospace,monospace}
  .ctarow{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}
  .btn{display:inline-block;padding:11px 20px;border-radius:6px;text-decoration:none;
    font-weight:600;font-size:14.5px;border:1px solid var(--rule);color:var(--ink)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--rule);
    color:var(--ink-3);font-size:13.5px}
${extraCss}</style>
</head>
<body><div class="wrap">
<nav>
  <a class="brand" href="/">${logoMark(21)}<span>Screenshotline</span></a>
  <a href="/docs">Docs</a>
  <a href="/blog">Blog</a>
  <a href="/pricing">Pricing</a>
  <a href="/account">Account</a>
</nav>

${body}

<footer>
  <a href="/">Home</a> &middot;
  <a href="/docs">Docs</a> &middot;
  <a href="/blog">Blog</a> &middot;
  <a href="/pricing">Pricing</a> &middot;
  <a href="https://status.screenshotline.com">Status</a> &middot;
  <a href="/terms">Terms</a>
</footer>
</div></body>
</html>`;
}

export function landingPageFor(slug) {
  const page = PAGES[slug];
  if (!page) return null;

  const others = Object.values(PAGES).filter((p) => p.slug !== slug);

  return pageShell({
    title: page.title,
    description: page.description,
    canonical: `${SITE}/${page.slug}`,
    body: `<h1>${esc(page.h1)}</h1>
<p class="lede">${page.lede}</p>

<pre><code>${esc(page.snippet)}</code></pre>

<div class="ctarow">
  <a class="btn primary" href="/account">Get a free key — no card</a>
  <a class="btn" href="/">Try it without signing up</a>
</div>

<h2>What people use it for</h2>
<div class="cases">
${page.useCases
  .map((c) => `  <div class="case"><h3>${esc(c[0])}</h3><p>${c[1]}</p></div>`)
  .join('\n')}
</div>
${shared}

<h2>Related</h2>
<ul>
${others.map((o) => `  <li><a href="/${o.slug}">${esc(o.h1)}</a></li>`).join('\n')}
  <li><a href="/docs/extract">Web page to Markdown</a></li>
  <li>Compared honestly: <a href="/screenshotone-alternative">ScreenshotOne</a>,
  <a href="/urlbox-alternative">Urlbox</a>, <a href="/apiflash-alternative">ApiFlash</a></li>
</ul>`,
  });
}

export default { landingPageFor, PAGES };
