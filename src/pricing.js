import * as store from './store.js';
import { faviconTags, logoMark } from './brand.js';

/**
 * The public pricing page.
 *
 * Built from store.PLANS, which is the same table the gateway enforces quota
 * against and the same one billing.js prices overage from. A pricing page that
 * disagrees with what you actually charge is a refund and a trust problem, and
 * the only reliable way to prevent that is to have one source.
 *
 * This page exists because not having one was the single biggest hole in the
 * site: a visitor could not find out what the product cost without creating an
 * account. Every competitor puts prices on a public page.
 */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';

const money = (cents) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
const num = (n) => n.toLocaleString('en-US');

/**
 * Effective price per 1,000 included renders, IN DOLLARS.
 *
 * PLANS holds cents. Returning cents here printed "$850.00 per 1,000" next to
 * "Then $7.90 per 1,000", which is a hundredfold error sitting on the pricing
 * page - the one page where a wrong number costs trust immediately.
 */
const per1k = (plan) =>
  plan.priceCents === 0 ? null : (plan.priceCents / plan.included) * 1000 / 100;

export function pricingPage() {
  const plans = Object.values(store.PLANS);

  const cards = plans
    .map((p) => {
      const rate = per1k(p);
      return `
    <div class="plan${p.id === 'growth' ? ' featured' : ''}">
      ${p.id === 'growth' ? '<div class="tag">Most popular</div>' : ''}
      <h2>${esc(p.name)}</h2>
      <div class="price">${money(p.priceCents)}<span>/month</span></div>
      <div class="inc">${num(p.included)} renders</div>
      <ul>
        <li>${rate ? `$${rate.toFixed(2)} per 1,000 included` : 'No card required'}</li>
        <li>${
          p.overagePer1k === null
            ? 'Stops at the limit — never an unexpected bill'
            : `Then $${(p.overagePer1k / 100).toFixed(2)} per 1,000`
        }</li>
        <li>${p.requiresCard ? 'Cancel any time' : 'No signup friction, no confirmation email'}</li>
      </ul>
      <a class="cta${p.id === 'growth' ? ' primary' : ''}" href="/account">${
        p.priceCents === 0 ? 'Start free' : 'Choose ' + esc(p.name)
      }</a>
    </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pricing — Screenshotline</title>
<meta name="description" content="Screenshot API pricing. Free tier with 500 renders a month and no card. Paid plans from $17. Failed renders and cache hits are never billed.">
<link rel="canonical" href="${SITE}/pricing">
${faviconTags()}
<style>
  :root{--ground:#f6f8f9;--surface:#fff;--ink:#131a1f;--ink-2:#4a5a64;--ink-3:#7a8b96;
    --rule:#dbe3e7;--accent:#0c6b75;--accent-soft:#e6f2f3}
  @media (prefers-color-scheme:dark){:root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;
    --ink-2:#a2b3bc;--ink-3:#76888f;--rule:#23323a;--accent:#43b9c2;--accent-soft:#122a2d}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15.5px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:1000px;margin:0 auto;padding:0 24px 80px}
  nav{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:14.5px}
  nav .brand{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none;margin-right:auto;display:flex;align-items:center;gap:8px}
  nav a{text-decoration:none;color:var(--ink-2)}
  nav a:hover{color:var(--accent)}
  h1{font-size:34px;letter-spacing:-.025em;margin:26px 0 8px;text-align:center}
  .sub{color:var(--ink-2);font-size:17px;margin:0 auto 38px;text-align:center;max-width:560px}
  .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:16px;align-items:start}
  .plan{background:var(--surface);border:1px solid var(--rule);border-radius:9px;padding:22px 20px;position:relative}
  .plan.featured{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .tag{position:absolute;top:-10px;left:20px;background:var(--accent);color:#fff;
    font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
    padding:3px 9px;border-radius:99px}
  .plan h2{font-size:16px;margin:0 0 6px}
  .price{font-size:32px;font-weight:600;letter-spacing:-.03em;line-height:1.1}
  .price span{font-size:14px;font-weight:400;color:var(--ink-3);letter-spacing:0}
  .inc{color:var(--ink-2);margin:4px 0 14px;font-size:14.5px}
  .plan ul{list-style:none;padding:0;margin:0 0 18px;font-size:13.5px;color:var(--ink-2)}
  .plan li{padding:5px 0;border-top:1px solid var(--rule)}
  .cta{display:block;text-align:center;padding:9px;border:1px solid var(--rule);
    border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;color:var(--ink)}
  .cta.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  h3{font-size:19px;margin:52px 0 10px;letter-spacing:-.01em}
  .note{background:var(--accent-soft);border-left:2px solid var(--accent);
    border-radius:5px;padding:15px 18px;margin:18px 0;color:var(--ink-2);font-size:14.5px}
  .note strong{color:var(--ink)}
  dl{margin:0}
  dt{font-weight:600;margin:20px 0 3px}
  dd{margin:0;color:var(--ink-2);font-size:14.5px}
  code{font-family:ui-monospace,monospace;background:var(--surface);
    border:1px solid var(--rule);padding:1px 5px;border-radius:3px;font-size:13px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--rule);
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

<h1>Pricing</h1>
<p class="sub">Priced per render. The free tier needs no card, and you are never
billed for a capture we failed to produce.</p>

<div class="plans">${cards}
</div>

<div class="note">
  <strong>Two things we do not charge for.</strong>
  A cache hit is free — you already paid for that image. And a failed render is
  free, which we can promise literally rather than as marketing: an error or a
  timeout is never billed, and the renderer detects a blank capture using two
  independent signals, so a bot wall that returns an empty page does not come
  out of your quota &mdash; up to 10% of your plan's renders a month, at least 50.
  Every response says whether it counted, in an <code>X-Billed</code> header.
</div>

<h3>How overage works</h3>
<p>Go past your included renders on a paid plan and the extra are billed at the
plan's overage rate — which is <em>lower</em> than the rate you already pay.</p>

<div class="note">
  On <strong>Starter</strong> you pay $8.50 per 1,000 included renders. Overage is
  $7.90. A spiky month costs you less per render, not more. That is deliberate:
  the reason to choose this API is correct output on hard pages, so an unusual
  month should not be punished.
</div>

<p>The free plan has no overage at all. It stops at 500 and waits for the next
month, because nobody entered a card and an unexpected invoice is not something
we will ever send.</p>

<h3>Refunds</h3>
<div class="note">
  <strong>Full refund within 14 days, if you have used less than 10% of your
  plan's included renders.</strong> Past either of those we do not refund a
  period you have already used &mdash; but you can cancel any time, keep
  access to the end of it, and continue on the free plan afterwards.
</div>
<p>Cancelling never disables your keys. You drop to the free plan and keep
rendering at 500 a month, because an integration that hard-fails is a worse
outcome for everyone than one that keeps running smaller.
<a href="/terms">Full terms</a>.</p>

<h3>Questions</h3>
<dl>
  <dt>Do I need a credit card to start?</dt>
  <dd>No. The free plan takes an email and returns a working key immediately.
  There is no confirmation email and no trial clock.</dd>

  <dt>What counts as a render?</dt>
  <dd>One successful capture. Cache hits and failures do not count. A full-page
  screenshot is one render, the same as a viewport one.</dd>

  <dt>Is Markdown extraction billed the same?</dt>
  <dd>Yes — <code>/extract</code> runs the same render, so it costs one render.</dd>

  <dt>What happens if I cancel?</dt>
  <dd>You drop to the free plan, not to nothing. Your keys keep working at 500
  renders a month, so whatever you built stays alive.</dd>

  <dt>Can I self-host instead?</dt>
  <dd>Yes. The renderer is the same one running here. The paid product is the
  hosted API — the warm browser pool, the cache and the uptime.</dd>

  <dt>Who handles payment?</dt>
  <dd>Polar, as merchant of record. They handle billing, invoices and sales tax
  in your jurisdiction.</dd>
</dl>

<footer>
  <a href="/">Home</a> &middot;
  <a href="/docs">Docs</a> &middot;
  <a href="/blog">Blog</a> &middot;
  <a href="/account">Account</a> &middot;
  <a href="/docs/extract">Page to Markdown</a> &middot;
  <a href="https://status.screenshotline.com">Status</a> &middot;
  <a href="/terms">Terms</a>
</footer>
</div></body>
</html>`;
}

export default pricingPage;
