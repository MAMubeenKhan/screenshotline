import config from './config.js';
import { faviconTags, logoMark, CUSTOMER_PORTAL } from './brand.js';

/**
 * The dashboard: keys and usage. Nothing else.
 *
 * The plan says "minimal dashboard (keys + usage only)" and that is a
 * ceiling, not a starting point. A usage-analytics dashboard is explicitly on
 * the do-not-build list for the first 90 days, and every hour spent on charts
 * here is an hour not spent on the docs pages that actually rank.
 *
 * Deliberately one file, no build step, no framework. It is served by the same
 * process as the API, so there is no second deploy to keep in sync.
 *
 * The key is held in localStorage and sent as X-Access-Key. That is the same
 * trust model as the key itself - anyone holding it can already spend the
 * quota - so a session layer would add a login to protect something the key
 * already protects. When there is a reason for real sessions (team seats), it
 * will be a real reason.
 */
export function dashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screenshotline &mdash; account</title>
${faviconTags()}
<style>
  :root {
    --ground:#f6f8f9; --surface:#fff; --ink:#131a1f; --ink-2:#4a5a64; --ink-3:#7a8b96;
    --rule:#dbe3e7; --accent:#0c6b75; --code-bg:#101a1f; --code-ink:#d9e4e9;
    --warn:#8a5a00; --warn-bg:#fff6e0; --bar:#0c6b75;
  }
  @media (prefers-color-scheme:dark){
    :root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;--ink-2:#a2b3bc;--ink-3:#76888f;
    --rule:#23323a;--accent:#43b9c2;--code-bg:#070e12;--code-ink:#d3e0e6;
    --warn:#f0c169;--warn-bg:#2a2010;--bar:#43b9c2;}
  }
  *{box-sizing:border-box}
  nav{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:14.5px}
  nav .brand{font-weight:700;font-size:16px;color:var(--ink);text-decoration:none;
    margin-right:auto;display:flex;align-items:center;gap:8px}
  nav a{text-decoration:none;color:var(--ink-2)}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:44px 24px 72px}
  h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--ink-2);margin:0 0 26px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);
    margin:32px 0 10px;font-weight:600}
  .card{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:18px 20px}
  form{display:grid;grid-template-columns:1fr auto;gap:10px}
  input{padding:10px 12px;border:1px solid var(--rule);border-radius:4px;
    background:var(--surface);color:var(--ink);font-size:15px;min-width:0;width:100%}
  button{padding:10px 18px;border:0;border-radius:4px;background:var(--accent);
    color:#fff;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
  button.ghost{background:transparent;color:var(--ink-2);border:1px solid var(--rule)}
  button:disabled{opacity:.5;cursor:progress}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;font-weight:600;color:var(--ink-3);font-size:12px;
    text-transform:uppercase;letter-spacing:.05em;padding:0 10px 6px 0}
  td{padding:9px 10px 9px 0;border-top:1px solid var(--rule);color:var(--ink-2);vertical-align:middle}
  td.mono,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .bar{height:7px;background:var(--rule);border-radius:99px;overflow:hidden;margin:10px 0 6px}
  .bar>i{display:block;height:100%;background:var(--bar);border-radius:99px;transition:width .3s}
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .big{font-size:28px;font-weight:600;color:var(--ink);letter-spacing:-.02em}
  .muted{color:var(--ink-3);font-size:13px}
  .keybox{background:var(--code-bg);color:var(--code-ink);padding:13px 15px;border-radius:4px;
    font-family:ui-monospace,monospace;font-size:13px;word-break:break-all;margin:10px 0 0}
  .warn{background:var(--warn-bg);color:var(--warn);border:1px solid currentColor;
    border-radius:4px;padding:10px 13px;font-size:13.5px;margin-top:10px}
  .err{color:#b3261e;font-size:13.5px;margin-top:10px}
  @media (prefers-color-scheme:dark){.err{color:#f2b8b5}}
  .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .plan{border:1px solid var(--rule);border-radius:5px;padding:13px;background:var(--surface)}
  .plan.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .plan h3{margin:0 0 2px;font-size:15px}
  .plan .p{font-size:19px;font-weight:600;margin:0 0 2px}
  a{color:var(--accent)}
  .hide{display:none}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="brand" href="/">${logoMark(21)}<span>Screenshotline</span></a>
    <a href="/docs">Docs</a>
    <a href="/blog">Blog</a>
    <a href="/pricing">Pricing</a>
    <a href="/terms">Terms</a>
  </nav>
  <h1>Your account</h1>
  <p class="sub">Keys and usage. Nothing else, on purpose.</p>

  <!-- Signed out -->
  <section id="anon">
    <h2>Sign in</h2>
    <div class="card">
      <form id="signin">
        <input id="key" type="password" placeholder="sl_live_..." autocomplete="off" required>
        <button type="submit">Continue</button>
      </form>
      <p class="muted" style="margin:12px 0 0">Paste an API key. It is kept in this browser only.</p>
      <div id="signin-err" class="err hide"></div>
    </div>

    <h2>No account yet</h2>
    <div class="card">
      <form id="signup">
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email" required>
        <button type="submit">Create free account</button>
      </form>
      <label class="muted" style="display:block;margin:10px 0 0;font-size:13.5px">
        Where did you hear about us? <span style="opacity:.7">(optional)</span>
        <select id="source" style="margin-left:6px">
          <option value="">&mdash;</option>
          <option value="hacker-news">Hacker News</option>
          <option value="reddit">Reddit</option>
          <option value="github">GitHub</option>
          <option value="search">Search engine</option>
          <option value="mcp-directory">MCP directory</option>
          <option value="x-twitter">X / Twitter</option>
          <option value="linkedin">LinkedIn</option>
          <option value="product-hunt">Product Hunt</option>
          <option value="dev-to">Dev.to</option>
          <option value="friend">A friend or colleague</option>
          <option value="other">Somewhere else</option>
        </select>
      </label>
      <p class="muted" style="margin:12px 0 0">
        ${'500 renders a month, no card, no confirmation email.'}
      </p>
      <div id="signup-out" class="hide">
        <div class="keybox" id="newkey"></div>
        <div class="warn">Save this now. It is stored hashed and cannot be shown again.</div>
      </div>
      <div id="signup-err" class="err hide"></div>
    </div>
  </section>

  <!-- Signed in -->
  <section id="app" class="hide">
    <h2>Usage</h2>
    <div class="card">
      <div class="row">
        <div><span class="big" id="used">0</span> <span class="muted">of <span id="limit">0</span> renders</span></div>
        <div class="muted" id="period"></div>
      </div>
      <div class="bar"><i id="barfill" style="width:0%"></i></div>
      <div class="row muted">
        <span id="breakdown"></span>
        <span id="overage"></span>
      </div>
    </div>

    <h2>Plan</h2>
    <div class="plans" id="plans"></div>
    <div id="plan-err" class="err hide"></div>

    <h2>Email</h2>
    <div class="card">
      <form id="emailform">
        <input id="newemail" type="email" placeholder="you@example.com" required>
        <button type="submit">Update</button>
      </form>
      <p class="muted" style="margin:12px 0 0">
        Receipts come from Polar, so change the billing address in their
        portal too if you have a paid plan.
      </p>
      <p class="muted" style="margin:10px 0 0">
        <strong>Manage or cancel your subscription:</strong>
        <a href="${CUSTOMER_PORTAL}" target="_blank" rel="noopener">Polar customer portal</a>.
        Sign in with the email you subscribed with. Cancelling keeps your keys
        working on the free plan - nothing breaks.
      </p>
      <div id="email-err" class="err hide"></div>
    </div>

    <h2>API keys</h2>
    <div class="card">
      <table>
        <thead><tr><th>Key</th><th>Name</th><th>Last used</th><th></th></tr></thead>
        <tbody id="keys"></tbody>
      </table>
      <form id="newkeyform" style="margin-top:16px">
        <input id="keyname" type="text" placeholder="Name this key (e.g. production)" required>
        <button type="submit">Create key</button>
      </form>
      <div id="issued" class="hide">
        <div class="keybox" id="issuedkey"></div>
        <div class="warn">Save this now. It is stored hashed and cannot be shown again.</div>
      </div>
    </div>

    <p style="margin-top:28px">
      <button class="ghost" id="signout">Sign out</button>
    </p>
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hide', !on);
let KEY = localStorage.getItem('screenshotline_key') || '';

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-access-key': KEY, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || ('Request failed with ' + res.status));
  return body;
};

const fmt = (n) => n.toLocaleString('en-US');
const when = (iso) => (iso ? new Date(iso).toLocaleDateString() : 'never');

async function load() {
  const [account, { plans }] = await Promise.all([api('/v1/account'), api('/v1/plans')]);

  const used = account.usage.renders;
  const limit = account.plan.included;
  $('used').textContent = fmt(used);
  $('limit').textContent = fmt(limit);
  $('period').textContent = account.usage.period + ' \\u00b7 ' + account.email;
  $('barfill').style.width = Math.min(100, (used / limit) * 100) + '%';
  $('breakdown').textContent =
    fmt(account.usage.cached) + ' cached, ' + fmt(account.usage.failed) + ' failed \\u2014 neither is billed';
  $('overage').textContent = account.usage.overage_units
    ? fmt(account.usage.overage_units) + ' over included \\u00b7 $' + account.usage.overage_due_usd.toFixed(2)
    : '';

  $('plans').innerHTML = plans
    .map(
      (p) =>
        '<div class="plan' + (p.id === account.plan.id ? ' on' : '') + '">' +
        '<h3>' + p.name + '</h3>' +
        '<p class="p">$' + p.price_usd + '<span class="muted" style="font-size:12px">/mo</span></p>' +
        '<p class="muted" style="margin:0">' + fmt(p.included_renders) + ' renders</p>' +
        (p.id === account.plan.id
          ? '<p class="muted" style="margin:8px 0 0">Current plan</p>'
          : p.id === 'free'
            ? ''
            : '<button style="margin-top:10px;width:100%" data-plan="' + p.id + '">Upgrade</button>') +
        '</div>',
    )
    .join('');

  $('keys').innerHTML = account.keys
    .filter((k) => !k.revoked_at)
    .map(
      (k) =>
        '<tr><td class="mono">' + k.prefix + '\\u2026</td><td>' + k.name + '</td>' +
        '<td class="muted">' + when(k.last_used_at) + '</td>' +
        '<td style="text-align:right"><button class="ghost" data-revoke="' + k.id + '">Revoke</button></td></tr>',
    )
    .join('');

  show($('anon'), false);
  show($('app'), true);
}

$('signin').onsubmit = async (e) => {
  e.preventDefault();
  KEY = $('key').value.trim();
  try {
    await load();
    localStorage.setItem('screenshotline_key', KEY);
  } catch (err) {
    KEY = '';
    $('signin-err').textContent = err.message;
    show($('signin-err'), true);
  }
};

$('signup').onsubmit = async (e) => {
  e.preventDefault();
  show($('signup-err'), false);
  try {
    const res = await fetch('/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), source: $('source').value || undefined }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || 'Signup failed');
    $('newkey').textContent = body.api_key;
    show($('signup-out'), true);
    KEY = body.api_key;
    localStorage.setItem('screenshotline_key', KEY);
    // Deliberately does NOT jump to the dashboard. The key is on screen once
    // and navigating away from it is how someone loses it.
  } catch (err) {
    $('signup-err').textContent = err.message;
    show($('signup-err'), true);
  }
};

$('emailform').onsubmit = async (e) => {
  e.preventDefault();
  show($('email-err'), false);
  try {
    await api('/v1/account', {
      method: 'PATCH',
      body: JSON.stringify({ email: $('newemail').value.trim() }),
    });
    $('newemail').value = '';
    await load();
  } catch (err) {
    $('email-err').textContent = err.message;
    show($('email-err'), true);
  }
};

$('newkeyform').onsubmit = async (e) => {
  e.preventDefault();
  const issued = await api('/v1/keys', {
    method: 'POST',
    body: JSON.stringify({ name: $('keyname').value.trim() }),
  });
  $('issuedkey').textContent = issued.api_key;
  show($('issued'), true);
  $('keyname').value = '';
  await load();
};

document.addEventListener('click', async (e) => {
  const revoke = e.target.dataset?.revoke;
  const plan = e.target.dataset?.plan;
  if (revoke) {
    if (!confirm('Revoke this key? Anything using it stops working immediately.')) return;
    await api('/v1/keys/' + revoke, { method: 'DELETE' });
    await load();
  }
  if (plan) {
    show($('plan-err'), false);
    try {
      const { checkout_url } = await api('/v1/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      window.location = checkout_url;
    } catch (err) {
      $('plan-err').textContent = err.message;
      show($('plan-err'), true);
    }
  }
});

$('signout').onclick = () => {
  localStorage.removeItem('screenshotline_key');
  location.reload();
};

// The plan only changes when Polar says so, so a return from checkout just
// reloads: the webhook may land a moment later, and showing an optimistic
// upgrade that then reverts is worse than showing the truth a second late.
if (KEY) load().catch(() => { KEY = ''; localStorage.removeItem('screenshotline_key'); });
</script>
</body>
</html>`;
}

export default dashboardPage;
