import { pageShell } from './landing-pages.js';
import { PLANS } from './store.js';

/**
 * "[competitor] alternative" pages.
 *
 * Written to be believed, which means conceding everything that is true. A
 * comparison page that only lists wins reads as an advert and converts like
 * one; a page that says "they have video and we never will" is the one a
 * developer forwards to their team. The rules:
 *
 *   - Every competitor figure is quoted from that vendor's own site, with the
 *     date it was checked. Nothing from memory, nothing from a third party.
 *   - Never claim a competitor LACKS something unless that was verified. Where
 *     it was not, say what we have and stop.
 *   - Every figure about us comes from the same config the gateway enforces,
 *     so these pages cannot drift from the product.
 */

const CHECKED = '11 September 2026';
const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
const ISSUES = 'https://github.com/MAMubeenKhan/screenshotline/issues';
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);

const n = (x) => x.toLocaleString('en-US');
const usd = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const per1k = (p) => `$${((p.priceCents / p.included) * 10).toFixed(2)}`;
const over1k = (p) => `$${(p.overagePer1k / 100).toFixed(2)}`;
const { free, starter, growth, scale } = PLANS;

// Shared by every page: what we will not do, said once and the same way.
const OUR_GAPS = `
<h2>What Screenshotline does not do</h2>
<ul>
  <li><strong>Video, GIFs or scrolling-video captures.</strong> Full-page screenshots, yes; moving pictures, no. Out of scope, deliberately.</li>
  <li><strong>Proxies, IP geolocation or stealth mode.</strong> We do not try to get past
  bot walls. When a page shows a captcha, you get the captcha &mdash; and we would rather say
  so than sell a way around it.</li>
  <li><strong>Async jobs, webhooks, or upload to your storage.</strong> A request returns the
  image. That is the whole interface.</li>
  <li><strong>SDKs.</strong> There are copy-paste HTTP snippets for curl, Node.js, Python, PHP
  and Go instead &mdash; the API is one GET request.</li>
  <li><strong>A track record.</strong> The hosted API launched in September 2026 and runs in one
  region (US East). There is no uptime history to show you yet, and no SLA.</li>
</ul>`;

export const COMPARISONS = {
  screenshotone: {
    slug: 'screenshotone-alternative',
    name: 'ScreenshotOne',
    title: 'ScreenshotOne alternative — an honest comparison',
    description:
      `Screenshotline vs ScreenshotOne: the same prices, a ${n(free.included)}-render free tier instead of 100, and open source. Where ScreenshotOne is better, said plainly.`,
    lede: `ScreenshotOne is a good screenshot API with a real track record. The paid plans are
priced identically, so the honest question is what else differs. Here is all of it,
including where ScreenshotOne is the better choice.`,
    short: `Same prices. ScreenshotOne has more features, SDKs and a longer track record. Screenshotline
has a free tier five times larger, a higher rate limit on the entry plan, and its entire
renderer is open source.`,
    sources: [['ScreenshotOne pricing', 'https://screenshotone.com/pricing/'], ['ScreenshotOne', 'https://screenshotone.com/']],
    table: {
      head: ['Screenshotline', 'ScreenshotOne'],
      rows: [
        ['Free', `${n(free.included)} renders/month, no card`, '100 screenshots/month, no card'],
        [usd(starter.priceCents) + '/month', `${n(starter.included)} renders, then ${over1k(starter)}/1k`, '2,000 screenshots, then $9.00/1k ($0.009 each)'],
        [usd(growth.priceCents) + '/month', `${n(growth.included)} renders, then ${over1k(growth)}/1k`, '10,000 screenshots, then $6.00/1k'],
        [usd(scale.priceCents) + '/month', `${n(scale.included)} renders, then ${over1k(scale)}/1k`, '50,000 screenshots, then $4.00/1k'],
        ['Rate limit', `${RATE_LIMIT} requests/minute on every plan`, '40 / 80 / 150 requests/minute by plan'],
        ['Billing', 'Failed renders and cache hits not billed', '“Pay only for successful requests”'],
      ],
    },
    theyWin: [
      '<strong>Track record.</strong> They state “3,700+ active developers” and “no less than 99.958% uptime”.',
      '<strong>SDKs and integrations.</strong> Official SDKs for Java, Go, Node.js, PHP, Python, Ruby and C#, plus Zapier, Make, n8n, Airtable and Bubble.',
      '<strong>More on the entry plan.</strong> Basic includes upload to S3, webhooks and stealth mode. We have none of the three on any plan.',
      '<strong>More on the upper plans.</strong> Growth adds choosing the IP location, scrolling screenshots and video generation; Scale adds GPU rendering and priority support.',
      `<strong>Cheaper overage at the top.</strong> $4.00 per 1,000 on Scale against our ${over1k(scale)}, and 150 requests a minute against our ${RATE_LIMIT}.`,
      '<strong>Cookie banners by rule volume.</strong> They cite “50,000+ rules and heuristics”. We use a heuristic plus a short named list, measured against 202 real pages.',
    ],
    weWin: [
      `<strong>A free tier you can build on.</strong> ${n(free.included)} renders a month against 100 &mdash; enough to run a side project for real before paying.`,
      `<strong>Cheaper overage on the entry plan.</strong> ${over1k(starter)} per 1,000 against $9.00. Every plan's overage is priced below its own plan rate, so a spiky month costs less per render, not more.`,
      `<strong>A higher rate limit where most people start.</strong> ${RATE_LIMIT} requests a minute on every plan, against 40 on Basic and 80 on Growth.`,
      '<strong>Open source.</strong> The renderer is AGPL-3.0. Read exactly what happens to your page, or self-host the same code with <code>docker compose up</code>.',
      '<strong>It tells you when a 200 is wrong.</strong> A capture that is probably blank is flagged in an <code>X-Blank-Suspected</code> header rather than returned as a silent success.',
      '<strong>Markdown from the same render.</strong> <code>/extract</code> returns the rendered page as clean Markdown for LLMs, on the same key and quota.',
    ],
    measured: `<p>On 9 September 2026 we sent the same 18 news front pages &mdash; consent walls, lazy
images, heavy embeds &mdash; through both APIs at the same viewport. Screenshotline captured
18 of 18, ScreenshotOne 17 of 18. ScreenshotOne was faster: a median of 5.6s against our
6.0s, and ours was measured from a laptop while theirs ran on their production
infrastructure. One benchmark on one category, so treat it as “comparable”, not as a win.</p>`,
    chooseThem: [
      'You need video, scrolling captures, IP geolocation or GPU rendering',
      'You want captures delivered to S3 or by webhook',
      'You want an SDK in your language, or a no-code integration',
      'You need years of uptime history before you depend on a vendor',
    ],
    chooseUs: [
      `You want ${n(free.included)} free renders a month to prove it out properly`,
      'You want to read, audit or self-host the renderer',
      'You want the rendered page as Markdown for an LLM, not only as an image',
      `You are on the entry plan and burst above 40 requests a minute`,
    ],
  },

  urlbox: {
    slug: 'urlbox-alternative',
    name: 'Urlbox',
    title: 'Urlbox alternative — an honest comparison',
    description:
      `Screenshotline vs Urlbox: a permanent ${n(free.included)}-render free tier, open source, and lower prices at small volume. Urlbox does far more; here is exactly what.`,
    lede: `Urlbox has been doing this for over a decade and does a great deal more than we do.
If you need most of what is below, use Urlbox. If you need screenshots and Markdown done
correctly, cheaply, and in code you can read, read on.`,
    short: `Urlbox is the fuller product: video, proxies, storage delivery, ten SDKs and an uptime
SLA. Screenshotline is cheaper to start with, has a free tier instead of a trial, and is
open source.`,
    sources: [['Urlbox pricing', 'https://urlbox.com/pricing'], ['Urlbox', 'https://urlbox.com/']],
    table: {
      head: ['Screenshotline', 'Urlbox'],
      rows: [
        ['Try it', `Free forever: ${n(free.included)} renders/month, no card`, '“7 day free trial. No credit card required.”'],
        ['1st paid plan', `${usd(starter.priceCents)}/month for ${n(starter.included)} (${per1k(starter)}/1k)`, 'Lo-Fi $19/month for 2,000 ($9.50/1k) &mdash; “Low quality screenshots of 3rd party websites”'],
        ['2nd paid plan', `${usd(growth.priceCents)}/month for ${n(growth.included)} (${per1k(growth)}/1k)`, 'Hi-Fi $49/month for 5,000 ($9.80/1k) &mdash; “Suitable for 80% of use cases”'],
        ['3rd paid plan', `${usd(scale.priceCents)}/month for ${n(scale.included)} (${per1k(scale)}/1k)`, 'Ultra $99/month for 15,000 ($6.60/1k) &mdash; “Capture any webpage”'],
        ['Above that', 'Nothing yet', 'Business and Enterprise plans, with SLAs and dedicated support'],
      ],
    },
    theyWin: [
      '<strong>Track record.</strong> They state “13+ years of experience”, “800M+ screenshots rendered” and “1,700+ customers”, with a “99.99% uptime SLA”.',
      '<strong>Formats.</strong> PNG, JPEG, WebP and AVIF; PDF and SVG; MP4 and WebM video; Markdown, JSON and HTML. We do PNG, JPEG, WebP, PDF and Markdown.',
      '<strong>Getting past the wall.</strong> Proxies in “200+ countries” and a stealth mode. We deliberately do neither.',
      '<strong>Delivery.</strong> Direct upload to AWS, Azure, Google Cloud and Cloudflare storage.',
      '<strong>SDKs.</strong> Ten, from JavaScript to Rust and Elixir, plus Zapier, n8n and LLM integrations with structured output.',
      '<strong>Cheaper per render in the middle.</strong> Ultra is $6.60 per 1,000 at 15,000 a month; our ' + usd(growth.priceCents) + ' plan works out at ' + per1k(growth) + '.',
    ],
    weWin: [
      `<strong>A free tier, not a trial.</strong> ${n(free.included)} renders every month, indefinitely, with no card. A seven-day trial ends before most side projects start.`,
      `<strong>Full quality from the first dollar.</strong> ${usd(starter.priceCents)} buys ${n(starter.included)} renders of any site. Urlbox's cheapest plan describes third-party captures as “low quality”; the next plan up is $49.`,
      '<strong>Open source.</strong> The renderer is AGPL-3.0. Read what happens to your page, or self-host the same code.',
      '<strong>It tells you when a 200 is wrong.</strong> A probably-blank capture is flagged in an <code>X-Blank-Suspected</code> header, and within a monthly allowance it is not billed.',
      'Markdown output is <em>not</em> a difference: Urlbox has it too.',
    ],
    measured: '',
    chooseThem: [
      'You need video, AVIF or SVG output',
      'You need proxies, geolocation or stealth to reach bot-protected pages',
      'You want renders uploaded to your own cloud storage',
      'You need an uptime SLA and a vendor with a long history',
    ],
    chooseUs: [
      'You want to start free and stay free while you build',
      `You need up to ${n(starter.included)} renders a month of any site, at full quality`,
      'You want to read, audit or self-host the renderer',
    ],
  },

  apiflash: {
    slug: 'apiflash-alternative',
    name: 'ApiFlash',
    title: 'ApiFlash alternative — an honest comparison',
    description:
      `Screenshotline vs ApiFlash: ApiFlash is much cheaper at volume. Screenshotline has a ${n(free.included)}-render free tier, open source, PDF and Markdown output.`,
    lede: `ApiFlash is a simple, inexpensive screenshot API built on Chrome and AWS Lambda. At
volume it is much cheaper than we are, and this page will not pretend otherwise. Here is
what the difference buys.`,
    short: `ApiFlash is cheaper &mdash; less than half our price at 10,000 a month. Screenshotline
has a bigger free tier, more control over what gets removed from the page, PDF and
Markdown output, and an open-source renderer.`,
    sources: [['ApiFlash pricing', 'https://apiflash.com/']],
    table: {
      head: ['Screenshotline', 'ApiFlash'],
      rows: [
        ['Free', `${n(free.included)} renders/month, no card`, '100 screenshots/month, no card'],
        ['Entry', `${usd(starter.priceCents)}/month for ${n(starter.included)}`, 'Lite $7/month for 1,000'],
        ['10,000 a month', `${usd(growth.priceCents)}/month (${per1k(growth)}/1k)`, 'Medium $35/month ($3.50/1k)'],
        ['High volume', `${usd(scale.priceCents)}/month for ${n(scale.included)} (${per1k(scale)}/1k)`, 'Large $180/month for 100,000 ($1.80/1k)'],
      ],
    },
    theyWin: [
      '<strong>Price.</strong> $3.50 per 1,000 at 10,000 a month against our ' + per1k(growth) + ', and $1.80 per 1,000 at 100,000. If cost per render is what decides it, ApiFlash wins.',
      '<strong>A cheaper way in.</strong> $7 a month for 1,000 screenshots.',
      '<strong>Export to S3</strong> on every paid plan. We do not upload anywhere.',
      '<strong>Serverless scaling.</strong> Built on AWS Lambda; we run a warm browser pool in one region.',
      '<strong>Proxies and IP geolocation</strong> on their Enterprise plan. We offer neither.',
    ],
    weWin: [
      `<strong>A bigger free tier.</strong> ${n(free.included)} renders a month against 100.`,
      '<strong>More control over the page.</strong> Besides ads and cookie banners: chat widgets, newsletter and donation popups, hiding any selector, injecting CSS or JavaScript, setting cookies, and capturing a single element.',
      '<strong>PDF and Markdown output.</strong> <code>format=pdf</code>, and <code>/extract</code> for the rendered page as Markdown.',
      '<strong>It tells you when a 200 is wrong.</strong> A probably-blank capture is flagged in an <code>X-Blank-Suspected</code> header, and within a monthly allowance it is not billed.',
      '<strong>Open source.</strong> The renderer is AGPL-3.0; self-host it if the hosted price is the problem.',
    ],
    measured: `<p>On 9 September 2026 we sent the same 18 news front pages through both APIs at the
same viewport. Both captured all 18. We are not quoting a latency comparison: our
benchmark did not force fresh renders, so ApiFlash's free tier served some pages from its
cache, and a cached image is not a render time.</p>`,
    chooseThem: [
      'Cost per render is the deciding factor, at any real volume',
      'You want captures exported to S3',
      'Plain screenshots of cooperative pages are all you need',
    ],
    chooseUs: [
      `You want ${n(free.included)} free renders a month`,
      'You need chat widgets, popups or specific elements removed',
      'You need PDF or Markdown from the same API',
      'You want to self-host rather than pay per render at all',
    ],
  },
};

const EXTRA_CSS = `  .short{background:var(--surface);border:1px solid var(--rule);border-left:2px solid var(--accent);
    border-radius:6px;padding:14px 17px;margin:0 0 8px;max-width:68ch}
  .short p{margin:0}
  .choose{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin:14px 0}
  .choose>div{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:14px 17px}
  .choose h3{margin:0 0 6px;font-size:15px}
  .choose ul{margin:0}
  .tablewrap{overflow-x:auto}
  .src{font-size:13.5px;color:var(--ink-3)}
`;

export function comparePage(slug) {
  const c = Object.values(COMPARISONS).find((x) => x.slug === slug);
  if (!c) return null;
  const others = Object.values(COMPARISONS).filter((x) => x.slug !== slug);
  const list = (items) => items.map((i) => `  <li>${i}</li>`).join('\n');

  const body = `<h1>${c.name} alternative</h1>
<p class="lede">${c.lede}</p>

<div class="short"><p><strong>The short version.</strong> ${c.short}</p></div>

<h2>Price, side by side</h2>
<div class="tablewrap"><table>
  <thead><tr><th></th><th>${c.table.head[0]}</th><th>${c.table.head[1]}</th></tr></thead>
  <tbody>
${c.table.rows.map((r) => `    <tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('\n')}
  </tbody>
</table></div>

<h2>Where ${c.name} is better</h2>
<ul>
${list(c.theyWin)}
</ul>

<h2>Where Screenshotline is better</h2>
<ul>
${list(c.weWin)}
</ul>
${c.measured ? `\n<h2>Measured, not claimed</h2>\n${c.measured}\n` : ''}${OUR_GAPS}

<h2>Which to choose</h2>
<div class="choose">
  <div><h3>Choose ${c.name} if</h3><ul>
${list(c.chooseThem)}
  </ul></div>
  <div><h3>Choose Screenshotline if</h3><ul>
${list(c.chooseUs)}
  </ul></div>
</div>

<div class="ctarow">
  <a class="btn primary" href="/account">Get a free key &mdash; no card</a>
  <a class="btn" href="/">Try it without signing up</a>
</div>

<p class="src">${c.name}'s prices and features were checked on ${CHECKED} on their own site:
${c.sources.map(([label, url]) => `<a href="${url}" rel="nofollow">${label}</a>`).join(', ')}.
Prices change. If anything here is out of date or unfair, <a href="${ISSUES}">open an issue</a>
and it will be corrected.</p>

<h2>Other comparisons</h2>
<ul>
${others.map((o) => `  <li><a href="/${o.slug}">${o.name} alternative</a></li>`).join('\n')}
  <li><a href="/pricing">Screenshotline pricing</a></li>
</ul>`;

  return pageShell({
    title: c.title,
    description: c.description,
    canonical: `${SITE}/${c.slug}`,
    body,
    extraCss: EXTRA_CSS,
  });
}

export default { comparePage, COMPARISONS };
