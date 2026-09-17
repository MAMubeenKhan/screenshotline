/**
 * Abuse-limit tests: the free-tier fences, the pool's paid-first queue, and
 * the demo=true billing bypass that was live in production until 2026-09-11.
 *
 * The first two sections need no browser. The last boots the real server with
 * billing on, because the bypass only exists there - smoke.js runs with
 * billing off and could never have caught it.
 *
 *   node test/limits.js
 */
process.env.PORT = process.env.LIMITS_TEST_PORT || '3198';
process.env.POOL_SIZE = '1';
process.env.ACCESS_KEYS = '';
process.env.DB_FILE = ':memory:';
process.env.BILLING_ENABLED = 'true';
process.env.ACQUIRE_TIMEOUT_MS = '2000';

import { setTimeout as sleep } from 'node:timers/promises';

// Dynamic, AFTER the env above: ESM hoists static imports, so a static
// `import config` would freeze the pre-test environment.
const limits = await import('../src/limits.js');
const { BrowserPool } = await import('../src/browser-pool.js');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const throwsCode = (fn, code) => {
  try {
    fn();
  } catch (err) {
    assert(err.code === code, `expected ${code}, got ${err.code}`);
    return err;
  }
  throw new Error(`expected ${code}, nothing was thrown`);
};

console.log('\nlimits:\n');

await check('targetDomain folds subdomains and www', () => {
  assert(limits.targetDomain('https://www.nytimes.com/x') === 'nytimes.com', 'www');
  assert(limits.targetDomain('https://edition.cnn.com/') === 'cnn.com', 'subdomain');
  assert(limits.targetDomain('http://93.184.216.34/') === '93.184.216.34', 'ip literal kept whole');
  assert(limits.targetDomain('not a url') === '', 'garbage is empty, not a throw');
});

await check('signups: allowance per IP, then 429, and other IPs unaffected', () => {
  limits._reset();
  const t = Date.now();
  for (let i = 0; i < limits.LIMITS.signupsPerIpPerDay; i += 1) {
    limits.checkSignup('1.2.3.4', t);
    limits.recordSignup('1.2.3.4', t);
  }
  const err = throwsCode(() => limits.checkSignup('1.2.3.4', t), 'signup_rate_limited');
  assert(err.status === 429, `status ${err.status}`);
  limits.checkSignup('5.6.7.8', t);
});

await check('signups: the window rolls after 24 hours', () => {
  limits._reset();
  const t = Date.now();
  for (let i = 0; i < limits.LIMITS.signupsPerIpPerDay; i += 1) limits.recordSignup('1.2.3.4', t);
  limits.checkSignup('1.2.3.4', t + 24 * 3_600_000 + 1);
});

await check('per-domain: free renders of one site are capped per minute', () => {
  limits._reset();
  const t = Date.now();
  const n = limits.LIMITS.freeRendersPerDomainPerMinute;
  for (let i = 0; i < n; i += 1) limits.checkFreeRender(`https://www.example.com/${i}`, { now: t });
  const err = throwsCode(() => limits.checkFreeRender('https://example.com/', { now: t }), 'domain_rate_limited');
  assert(err.status === 429, `status ${err.status}`);
  limits.checkFreeRender('https://example.org/', { now: t });
  limits.checkFreeRender('https://example.com/', { now: t + 60_001 });
});

await check('global budget: free slot time is capped per rolling hour, then frees', () => {
  limits._reset();
  const t = Date.now();
  const budget = limits.freeBudgetMs(1);
  assert(budget === limits.LIMITS.freeSlotShare * 3_600_000, `budget ${budget}`);
  assert(limits.LIMITS.freeSlotShare === 0.75, `default share ${limits.LIMITS.freeSlotShare}`);
  limits.chargeFreeRender(budget - 1, t);
  limits.checkFreeRender('https://a.test/', { poolSize: 1, now: t });
  limits.chargeFreeRender(1, t);
  const err = throwsCode(() => limits.checkFreeRender('https://b.test/', { poolSize: 1, now: t }), 'free_capacity_exhausted');
  assert(err.status === 503, `status ${err.status}`);
  limits.checkFreeRender('https://c.test/', { poolSize: 1, now: t + 3_600_001 });
});

await check('one free caller cannot spend more than its share of the free budget', () => {
  limits._reset();
  const t = Date.now();
  const share = limits.LIMITS.freeCallerShare * limits.freeBudgetMs(1);
  limits.chargeFreeRender(share, t, 'acct:greedy');
  const err = throwsCode(
    () => limits.checkFreeRender('https://a.test/', { poolSize: 1, now: t, caller: 'acct:greedy' }),
    'free_caller_limited',
  );
  assert(err.status === 429, `status ${err.status}`);
  limits.checkFreeRender('https://a.test/', { poolSize: 1, now: t, caller: 'acct:someone-else' });
  limits.checkFreeRender('https://a.test/', { poolSize: 1, now: t + 3_600_001, caller: 'acct:greedy' });
});

await check('global budget scales with the pool', () => {
  assert(limits.freeBudgetMs(4) === 4 * limits.freeBudgetMs(1), 'not proportional');
});

console.log('\npool priority:\n');

await check('a paid waiter is served before a queued free one', async () => {
  const pool = new BrowserPool(1);
  const slot = await pool.takeSlot();
  const order = [];
  const lowP = pool.takeSlot({ low: true }).then((s) => { order.push('free'); pool.release(s); });
  const paidP = pool.takeSlot().then((s) => { order.push('paid'); pool.release(s); });
  pool.release(slot);
  await Promise.all([lowP, paidP]);
  assert(order.join(',') === 'paid,free', `order was ${order.join(',')}`);
});

await check('free traffic holds at most one queue place; a second is refused at once', async () => {
  const pool = new BrowserPool(1);
  const slot = await pool.takeSlot();
  const first = pool.takeSlot({ low: true });
  const started = Date.now();
  let code = null;
  await pool.takeSlot({ low: true }).catch((err) => { code = err.code; });
  assert(code === 'free_capacity_busy', `expected free_capacity_busy, got ${code}`);
  assert(Date.now() - started < 200, 'refusal waited instead of failing fast');
  // Paid traffic still queues normally behind a free waiter.
  const paid = pool.takeSlot();
  pool.release(slot);
  pool.release(await paid);
  pool.release(await first);
});

console.log('\nhttp, billing on:\n');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const { pool } = await import('../src/index.js');
for (let i = 0; i < 60; i += 1) {
  const res = await fetch(`${BASE}/healthz`).catch(() => null);
  if (res?.ok && (await res.json()).pool.launched > 0) break;
  await sleep(500);
}
limits._reset();

await check('REGRESSION: /take?demo=true without a key is refused', async () => {
  const res = await fetch(`${BASE}/take?url=https://example.com&demo=true`);
  const body = await res.json().catch(() => ({}));
  assert(res.status === 401, `expected 401, got ${res.status} - the billing bypass is back`);
  assert(body.error?.code === 'missing_access_key', `code ${body.error?.code}`);
});

await check('REGRESSION: same for POST /take with demo in the body', async () => {
  const res = await fetch(`${BASE}/take`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', demo: 'true' }),
  });
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

await check('the real /demo still renders with no key', async () => {
  const res = await fetch(`${BASE}/demo?url=https://example.com`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((res.headers.get('content-type') || '').includes('image/png'), 'not a png');
});

await check('a demo render is charged to the free budget', async () => {
  const m = await (await fetch(`${BASE}/metrics`)).json();
  assert(m.limits.free_slot_ms_last_hour > 0, `charged ${m.limits.free_slot_ms_last_hour}ms`);
});

let key = null;
await check('signup is rationed per IP over HTTP', async () => {
  const n = limits.LIMITS.signupsPerIpPerDay;
  const stamp = Date.now();
  for (let i = 0; i < n; i += 1) {
    const res = await fetch(`${BASE}/v1/accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `limits-test-${stamp}-${i}@gmail.com`, source: i === 0 ? 'hacker-news' : 'not-a-real-source' }),
    });
    assert(res.status === 201, `signup ${i + 1} got ${res.status}`);
    key ||= (await res.json()).api_key;
  }
  const res = await fetch(`${BASE}/v1/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `limits-test-${stamp}-x@gmail.com` }),
  });
  const body = await res.json();
  assert(res.status === 429, `expected 429, got ${res.status}`);
  assert(body.error?.code === 'signup_rate_limited', `code ${body.error?.code}`);
});

await check('hosted MCP: tools list without a key, calls need one, and a free key works', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const connect = async (headers = {}) => {
    const c = new Client({ name: 'limits', version: '0.0.1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers } }));
    return c;
  };
  const anon = await connect();
  assert((await anon.listTools()).tools.length === 2, 'tools/list must work without a key');
  const refused = await anon.callTool({ name: 'screenshot', arguments: { url: 'https://example.com' } });
  assert(refused.isError, 'a keyless call must not render');
  assert(refused.content[0].text.includes('X-Access-Key'), `unhelpful message: ${refused.content[0].text}`);
  await anon.close();

  assert(key, 'no key from signup');
  const keyed = await connect({ 'X-Access-Key': key });
  const shot = await keyed.callTool({ name: 'screenshot', arguments: { url: 'https://example.com' } });
  assert(!shot.isError, `keyed call errored: ${shot.content?.[0]?.text}`);
  assert(shot.content[0].type === 'image', 'expected an image');
  await keyed.close();
});

await check('REGRESSION: tuned parameters no longer make a real capture "blank" and free', async () => {
  // Each of these flagged a complete capture of example.com as blank on
  // 2026-09-11, so it was delivered unbilled and never touched the quota.
  assert(key, 'no key from signup');
  for (const q of ['selector=h1', 'viewport_width=3840&viewport_height=4320', 'format=jpeg&quality=1', 'format=webp&quality=1']) {
    const res = await fetch(`${BASE}/take?url=https://example.com&cache=false&${q}&access_key=${key}`);
    assert(res.ok, `${q}: status ${res.status}`);
    assert(res.headers.get('x-blank-suspected') === 'false', `${q}: still flagged blank`);
    assert(res.headers.get('x-billed') === 'true', `${q}: not billed`);
  }
});

await check('analytics: requests leave the right events, and never a full URL', async () => {
  const store = await import('../src/store.js');
  // 'finish' listeners run after the response is sent; give them a tick.
  await sleep(200);
  const rows = store.open().prepare('SELECT * FROM events').all();
  const has = (pred, what) => assert(rows.some(pred), `no event for ${what}`);
  has((e) => e.endpoint === 'signup' && e.outcome === 'created' && e.code === 'hacker-news', 'a signup with its source');
  has((e) => e.endpoint === 'signup' && e.outcome === 'created' && e.code === null, 'an invalid source dropped, not stored');
  has((e) => e.endpoint === 'signup' && e.outcome === 'rejected' && e.code === 'signup_rate_limited', 'a refused signup');
  has((e) => e.endpoint === 'demo' && e.outcome === 'render' && e.visitor && e.account_id === null, 'a demo render by a hashed visitor');
  has((e) => e.endpoint === 'take' && e.via === 'mcp' && e.outcome === 'render', 'a render through hosted MCP');
  has((e) => e.endpoint === 'mcp' && e.outcome === 'tools/call' && e.code === 'screenshot', 'the MCP tool call itself');
  has((e) => e.endpoint === 'take' && e.outcome === 'rejected' && e.code === 'missing_access_key', 'a keyless request');
  for (const e of rows) {
    assert(!JSON.stringify(e).includes('https://'), `an event stored a URL: ${JSON.stringify(e)}`);
    assert(!JSON.stringify(e).includes('127.0.0.1'), `an event stored an IP: ${JSON.stringify(e)}`);
  }
  const { buildReport, buildAccountReport } = await import('../tools/report.js');
  const report = buildReport(store.open(), { days: 1 });
  assert(report.includes('FUNNEL BY DAY') && report.includes('hacker-news'), 'report missing the funnel or the source');
  const acct = rows.find((e) => e.endpoint === 'signup' && e.code === 'hacker-news').account_id;
  assert(buildAccountReport(store.open(), acct).includes('LAST 50 EVENTS'), 'account report failed');
});

await check('a free key is refused once the free budget is spent', async () => {
  assert(key, 'no key from signup');
  limits.chargeFreeRender(limits.freeBudgetMs() + 1);
  const res = await fetch(`${BASE}/take?url=https://example.com&cache=false&access_key=${key}`);
  const body = await res.json().catch(() => ({}));
  assert(res.status === 503, `expected 503, got ${res.status}`);
  assert(body.error?.code === 'free_capacity_exhausted', `code ${body.error?.code}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
await pool.close();
process.exit(failed === 0 ? 0 : 1);
