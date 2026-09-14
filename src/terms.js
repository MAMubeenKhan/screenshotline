import { faviconTags, logoMark, CUSTOMER_PORTAL } from './brand.js';

/**
 * Terms, refunds and acceptable use.
 *
 * Kept short and readable on purpose. A wall of boilerplate nobody reads is
 * not protection - it is a liability you have not understood. Everything here
 * is a rule this business actually intends to follow.
 *
 * The refund rule exists to answer one specific question before it is asked:
 * can someone render 2,000 pages and then ask for their money back. It is
 * generous to the customer who genuinely could not make it work and closed to
 * the one who has already had the value.
 */

const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';
const SUPPORT = process.env.SUPPORT_EMAIL || 'support@screenshotline.com';

export function termsPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms &amp; refunds — Screenshotline</title>
<meta name="description" content="Terms of service, refund policy and acceptable use for the Screenshotline screenshot API.">
<link rel="canonical" href="${SITE}/terms">
${faviconTags()}
<style>
  :root{--ground:#f6f8f9;--surface:#fff;--ink:#131a1f;--ink-2:#4a5a64;--ink-3:#7a8b96;
    --rule:#dbe3e7;--accent:#0c6b75;--accent-soft:#e6f2f3}
  @media (prefers-color-scheme:dark){:root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;
    --ink-2:#a2b3bc;--ink-3:#76888f;--rule:#23323a;--accent:#43b9c2;--accent-soft:#122a2d}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15.5px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:760px;margin:0 auto;padding:0 24px 80px}
  nav{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:14.5px}
  nav .brand{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none;
    margin-right:auto;display:flex;align-items:center;gap:8px}
  nav a{text-decoration:none;color:var(--ink-2)}
  h1{font-size:32px;letter-spacing:-.025em;margin:26px 0 6px}
  .sub{color:var(--ink-3);margin:0 0 34px;font-size:14.5px}
  h2{font-size:19px;letter-spacing:-.01em;margin:40px 0 8px}
  p,li{max-width:68ch}
  ul{padding-left:20px}
  li{margin:5px 0}
  .note{background:var(--accent-soft);border-left:2px solid var(--accent);border-radius:5px;
    padding:15px 18px;margin:16px 0;color:var(--ink-2);font-size:14.5px}
  .note strong{color:var(--ink)}
  code{font-family:ui-monospace,monospace;background:var(--surface);border:1px solid var(--rule);
    padding:1px 5px;border-radius:3px;font-size:13px}
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

<h1>Terms &amp; refunds</h1>
<p class="sub">Short, because rules nobody reads protect nobody.</p>

<h2>Refunds</h2>
<div class="note">
  <strong>Full refund within 14 days, if you have used less than 10% of your
  plan's included renders.</strong> Past either of those, we do not refund a
  period you have already used — but you can cancel any time, keep access to
  the end of the period, and then continue on the free plan.
</div>
<p>The reason for the usage condition is plain: the 10% line is there so that
someone who genuinely could not make this work gets their money back, while
someone who has already rendered ten thousand pages does not.</p>
<p>Two things you are never charged for in the first place, so they should
never be a reason to ask:</p>
<ul>
  <li><strong>Failed renders.</strong> A render that errors or times out is
  never billed. We also detect a blank capture with two independent signals,
  so a bot wall that returns an empty page does not come out of your quota
  &mdash; up to 10% of your plan's renders a month, and at least 50. Beyond
  that, a capture we flag as blank but still deliver counts as a render: the
  flag cannot tell a bot wall from a page built to look empty. Every response
  says whether it counted, in an <code>X-Billed</code> header.</li>
  <li><strong>Cache hits.</strong> You already paid for that image.</li>
</ul>
<p>To request one, email <a href="mailto:${SUPPORT}">${SUPPORT}</a> from the
address on the account. Refunds are issued by Polar, our merchant of record,
and typically land in 5–10 business days depending on your bank.</p>

<h2>Cancelling</h2>
<p>Cancel yourself, any time, from the
<a href="${CUSTOMER_PORTAL}">Polar customer portal</a> — sign in with the
email you subscribed with. You do not have to email us and we will not
ask you why. You keep the
plan until the end of the period you have paid for, then drop to the free
plan — your API keys keep working at 500 renders a month. We do not disable
keys on cancellation, because an integration that hard-fails is a worse
outcome for everyone than one that keeps running smaller.</p>

<h2>What you may not capture</h2>
<p>You are responsible for the URLs you send us. Do not use this service to:</p>
<ul>
  <li>Capture content you are not permitted to access, or circumvent
  authentication, paywalls or access controls you do not hold credentials for</li>
  <li>Capture child sexual abuse material, or content that is illegal in India
  or in your own jurisdiction</li>
  <li>Attack, scan or overload third-party sites — this is a screenshot API,
  not a load-testing tool or a scraper for bulk content theft</li>
  <li>Resell raw capture capacity as a competing screenshot API</li>
</ul>
<p>We render pages as an anonymous visitor would. Private and reserved network
addresses are refused, and every redirect is re-checked, so this cannot be
pointed at internal infrastructure.</p>

<h2>Service</h2>
<ul>
  <li>We do not offer an uptime SLA on self-serve plans. If you need one,
  email us and we will talk.</li>
  <li>We may change prices with 30 days' notice. Existing subscriptions keep
  their price for the period already paid.</li>
  <li>We may suspend an account that is abusing the service or costing far
  more than it pays. We will tell you why, and refund unused time.</li>
</ul>

<h2>Your data</h2>
<ul>
  <li>We store your email, your API key hashes and a count of your renders.
  Keys are stored as SHA-256 hashes — we cannot show you a key again after it
  is created, because we never had it.</li>
  <li>For each API request we keep a short record for 90 days, to run and bill
  the service: the time, which endpoint, the outcome and error code, the render
  time, and the <em>domain</em> of the page you captured. Never the full URL,
  never the image, never the page's content. If you tell us where you heard
  about us at signup, we keep that too.</li>
  <li>The website's server keeps a standard access log — IP address, page,
  browser — rotated by size, for security and to count visits. There is no
  tracking script and no cookie on this site; the account page remembers your
  API key in your own browser so you stay signed in, and nothing else. The
  demo counts unique visitors with a hash that changes every day, so no IP is
  kept for it.</li>
  <li>Captured images are held only to serve the cache you asked for, for the
  TTL you set, and are not used for anything else.</li>
  <li>We do not sell data. Payment details never touch our servers; Polar
  handles them as merchant of record.</li>
  <li>Delete your account by emailing <a href="mailto:${SUPPORT}">${SUPPORT}</a>
  and everything above goes with it.</li>
</ul>

<h2>Liability</h2>
<p>The service is provided as-is. Our liability is limited to what you paid us
in the previous three months. Given the free plan exists precisely so you can
test before committing, please use it.</p>

<h2>Contact</h2>
<p><a href="mailto:${SUPPORT}">${SUPPORT}</a>. Support is best-effort on the
free plan and answered on paid plans. Billing and invoice questions go to
Polar, who are the merchant of record for every transaction.</p>

<footer>
  <a href="/">Home</a> &middot;
  <a href="/docs">Docs</a> &middot;
  <a href="/blog">Blog</a> &middot;
  <a href="/pricing">Pricing</a> &middot;
  <a href="/account">Account</a> &middot;
  <a href="https://status.screenshotline.com">Status</a>
</footer>
</div></body>
</html>`;
}

export default termsPage;
