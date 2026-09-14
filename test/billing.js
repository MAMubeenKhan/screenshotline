/**
 * Billing tests: accounts, keys, quota, metering and webhooks.
 *
 * No browser and no network, so this runs in about a second and belongs in CI
 * next to the smoke suite. The money path deserves tests that are fast enough
 * that nobody is tempted to skip them.
 *
 *   node test/billing.js
 */
process.env.DB_FILE = ':memory:';
process.env.BILLING_ENABLED = 'true';
process.env.POLAR_WEBHOOK_SECRET = `whsec_${Buffer.from('testsecret').toString('base64')}`;
process.env.POLAR_PRODUCT_GROWTH = 'prod_growth_xyz';
process.env.POLAR_PRODUCT_STARTER = 'prod_starter_abc';
process.env.POLAR_ACCESS_TOKEN = 'polar_test_token';
process.env.POLAR_USAGE_METER = 'render';
process.env.POLAR_USAGE_FLUSH_MS = '20';

import crypto from 'node:crypto';

// Imported dynamically, AFTER the env vars above are set. ESM hoists static
// imports and evaluates them before any statement in this file runs, so
// `import config` at the top would read the environment as it was before
// these assignments - which silently gave every module the wrong config.
const store = await import('../src/store.js');
const billing = await import('../src/billing.js');
const polar = await import('../src/polar.js');
const email = await import('../src/email.js');
const ingest = await import('../src/usage-ingest.js');
const config = await import('../src/config.js');

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

const secretKey = Buffer.from(Buffer.from('testsecret').toString('base64'), 'base64');
function signedDelivery(id, body, { skewSeconds = 0 } = {}) {
  const ts = Math.floor(Date.now() / 1000) + skewSeconds;
  const sig = crypto.createHmac('sha256', secretKey).update(`${id}.${ts}.${body}`).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${sig}`,
  };
}

async function main() {
  store.open(':memory:');
  console.log('\nbilling checks:\n');

  await check('signup issues a working key, hashed at rest', () => {
    const account = store.createAccount('a@example.com');
    const issued = store.createKey(account.id);
    assert(issued.key.startsWith('sl_live_'), 'key should be prefixed sl_live_');
    const resolved = store.resolveKey(issued.key);
    assert(resolved && resolved.id === account.id, 'key should resolve to its account');
    const db = store.open();
    const row = db.prepare('SELECT key_hash FROM api_keys WHERE id = ?').get(issued.id);
    assert(!row.key_hash.includes(issued.key), 'plaintext key must never be stored');
    assert(row.key_hash === store.hashKey(issued.key), 'stored hash should be sha256 of the key');
  });

  await check('revoked keys stop resolving', () => {
    const account = store.createAccount('b@example.com');
    const issued = store.createKey(account.id);
    assert(store.revokeKey(account.id, issued.id), 'revoke should report success');
    assert(store.resolveKey(issued.key) === null, 'revoked key must not resolve');
    assert(!store.revokeKey(account.id, issued.id), 'second revoke should be a no-op');
  });

  await check('one account cannot revoke another account key', () => {
    const mine = store.createAccount('c@example.com');
    const theirs = store.createAccount('d@example.com');
    const key = store.createKey(theirs.id);
    assert(!store.revokeKey(mine.id, key.id), 'cross-account revoke must fail');
    assert(store.resolveKey(key.key) !== null, 'their key should still work');
  });

  await check('free plan hard-stops at its limit', () => {
    const account = store.createAccount('e@example.com');
    for (let i = 0; i < store.PLANS.free.included - 1; i += 1) store.recordUsage(account.id, 'render');
    assert(store.checkQuota(store.getAccount(account.id)).allowed, 'one under the free limit should pass');
    store.recordUsage(account.id, 'render');
    const quota = store.checkQuota(store.getAccount(account.id));
    assert(!quota.allowed, 'the free limit itself should stop');
    assert(quota.reason === 'quota_exceeded', `unexpected reason: ${quota.reason}`);
  });

  await check('paid plans bill overage instead of stopping', () => {
    const account = store.createAccount('f@example.com');
    store.updateAccount(account.id, { plan: 'starter' });
    for (let i = 0; i < 2_050; i += 1) store.recordUsage(account.id, 'render');
    const quota = store.checkQuota(store.getAccount(account.id));
    assert(quota.allowed, 'a paid plan over its included amount should continue');
    assert(quota.overage === 51, `expected 51 overage units, got ${quota.overage}`);
  });

  await check('overage is priced below the plan rate', () => {
    // The deliberate inversion of the usual punitive overage. If this ever
    // flips, a spiky month starts punishing the customer.
    for (const id of ['starter', 'growth', 'scale']) {
      const plan = store.PLANS[id];
      const planRatePer1k = (plan.priceCents / plan.included) * 1000;
      assert(
        plan.overagePer1k < planRatePer1k,
        `${id}: overage ${plan.overagePer1k} should be under plan rate ${planRatePer1k.toFixed(0)}`,
      );
    }
  });

  await check('free plan never accrues overage', () => {
    assert(store.PLANS.free.overagePer1k === null, 'free must have no overage price');
    assert(store.PLANS.free.requiresCard === false, 'free must not require a card');
  });

  await check('suspended accounts are refused', () => {
    const account = store.createAccount('g@example.com');
    store.updateAccount(account.id, { status: 'past_due' });
    const quota = store.checkQuota(store.getAccount(account.id));
    assert(!quota.allowed, 'a past_due account should be refused');
    assert(quota.reason === 'account_inactive', `unexpected reason: ${quota.reason}`);
  });

  await check('cache hits and failures are not billable', () => {
    const account = store.createAccount('h@example.com');
    store.recordUsage(account.id, 'render');
    store.recordUsage(account.id, 'cached');
    store.recordUsage(account.id, 'failed');
    store.recordUsage(account.id, 'failed');
    const usage = store.getUsage(account.id);
    assert(usage.renders === 1, `only renders bill; got renders=${usage.renders}`);
    assert(usage.cached === 1 && usage.failed === 2, 'cached and failed counted separately');
    const quota = store.checkQuota(store.getAccount(account.id));
    assert(quota.remaining === store.PLANS.free.included - 1, `quota should only count renders, got ${quota.remaining}`);
  });

  await check('billing.authorize rejects missing and bad keys', () => {
    let threw = null;
    try {
      billing.authorize({}, {});
    } catch (err) {
      threw = err;
    }
    assert(threw?.status === 401, 'missing key should be 401');
    try {
      billing.authorize({ access_key: 'sl_live_nope' }, {});
    } catch (err) {
      threw = err;
    }
    assert(threw?.status === 403, 'unknown key should be 403');
  });

  await check('analytics: visitor hash rotates daily and never holds the IP; old events are purged', () => {
    const d1 = new Date('2026-09-14T10:00:00Z');
    const d1later = new Date('2026-09-14T23:00:00Z');
    const d2 = new Date('2026-09-15T01:00:00Z');
    const a = store.visitorHash('203.0.113.7', d1);
    assert(a && a.length === 16, 'expected a 16-char hash');
    assert(a === store.visitorHash('203.0.113.7', d1later), 'same visitor, same day, same hash');
    assert(a !== store.visitorHash('203.0.113.7', d2), 'a new day must not link to the last');
    assert(a !== store.visitorHash('203.0.113.8', d1), 'different visitors must differ');
    assert(!a.includes('203'), 'the hash must not contain the IP');

    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    store.recordEvent({ ts: old, endpoint: 'take', outcome: 'render' });
    store.recordEvent({ endpoint: 'take', outcome: 'render', domain: 'example.com' });
    const before = store.open().prepare('SELECT COUNT(*) AS n FROM events').get().n;
    const purged = store.purgeEvents();
    const after = store.open().prepare('SELECT COUNT(*) AS n FROM events').get().n;
    assert(purged === 1, `expected 1 purged, got ${purged}`);
    assert(after === before - 1, 'only the 91-day-old event goes');
  });

  await check('blank captures are unbilled only within the monthly allowance', () => {
    // Detection can be gamed by a caller who controls the page, so "blank
    // means free" has a size: 10% of the plan, at least 50.
    const free = store.PLANS.free;
    const allowance = store.blankAllowance(free);
    assert(allowance === 50, `free allowance ${allowance}`);
    assert(store.blankAllowance(store.PLANS.growth) === 1000, 'growth allowance');
    const within = { quota: { plan: free, usage: { failed: allowance - 1 } } };
    const spent = { quota: { plan: free, usage: { failed: allowance } } };
    assert(billing.kindFor(within, true) === 'failed', 'inside the allowance a blank is unbilled');
    assert(billing.kindFor(spent, true) === 'render', 'past the allowance a delivered blank counts');
    assert(billing.kindFor(spent, false) === 'render', 'a normal capture always counts');
    assert(billing.kindFor(null, true) === 'failed', 'self-hosted: nothing to bill');
  });

  await check('billing.authorize returns 402 when out of quota', () => {
    const account = store.createAccount('i@example.com');
    const key = store.createKey(account.id);
    for (let i = 0; i < store.PLANS.free.included; i += 1) store.recordUsage(account.id, 'render');
    let threw = null;
    try {
      billing.authorize({ access_key: key.key }, {});
    } catch (err) {
      threw = err;
    }
    assert(threw?.status === 402, `expected 402 payment required, got ${threw?.status}`);
  });

  await check('webhook rejects a bad signature', () => {
    const body = JSON.stringify({ type: 'subscription.created', data: {} });
    const headers = signedDelivery('wh_bad', body);
    headers['webhook-signature'] = 'v1,notarealsignature';
    let threw = null;
    try {
      polar.verifyWebhook(Buffer.from(body), headers);
    } catch (err) {
      threw = err;
    }
    assert(threw?.code === 'invalid_signature', `expected invalid_signature, got ${threw?.code}`);
  });

  await check('webhook rejects a replayed old timestamp', () => {
    const body = JSON.stringify({ type: 'subscription.created', data: {} });
    let threw = null;
    try {
      polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_old', body, { skewSeconds: -4000 }));
    } catch (err) {
      threw = err;
    }
    assert(threw?.code === 'invalid_signature', 'a stale delivery must be refused');
  });

  await check('webhook maps a product id to a plan', () => {
    const account = store.createAccount('j@example.com');
    // No metadata.plan here on purpose: this exercises the product-id path,
    // which is the one Polar actually populates.
    const body = JSON.stringify({
      type: 'subscription.created',
      data: {
        id: 'sub_9',
        product_id: 'prod_growth_xyz',
        customer_id: 'cus_9',
        metadata: { account_id: account.id },
      },
    });
    const event = polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_prod', body));
    const outcome = polar.applyEvent(event);
    assert(outcome.applied === 'plan=growth', `expected plan=growth, got ${outcome.applied}`);
    assert(store.getAccount(account.id).plan === 'growth', 'account should now be on growth');
  });

  await check('webhook reads the product from data.product.id too', () => {
    // Webhooks follow the endpoint's API version (ours: 2026-10, still
    // "Next" until October). A payload that nests the product must still
    // upgrade the customer.
    const account = store.createAccount('nested@example.com');
    const body = JSON.stringify({
      type: 'subscription.created',
      data: { id: 'sub_n', product: { id: 'prod_starter_abc' }, customer_id: 'cus_n', metadata: { account_id: account.id } },
    });
    const outcome = polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_nested', body)));
    assert(outcome.applied === 'plan=starter' && !outcome.problem, `got ${JSON.stringify(outcome)}`);
  });

  await check('a paid event that cannot be applied is a problem, never a quiet "ignored"', () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(' '));
    try {
      const account = store.createAccount('unresolved@example.com');
      const unknownProduct = JSON.stringify({
        type: 'subscription.created',
        data: { id: 'sub_u', product_id: 'prod_nobody_knows', customer_id: 'cus_u', metadata: { account_id: account.id } },
      });
      const a = polar.applyEvent(polar.verifyWebhook(Buffer.from(unknownProduct), signedDelivery('wh_unknown', unknownProduct)));
      assert(a.problem === 'plan_not_resolved', `expected plan_not_resolved, got ${a.problem}`);
      assert(store.getAccount(account.id).plan === 'free', 'an unresolved plan must not change the account');

      const nobody = JSON.stringify({
        type: 'order.paid',
        data: { id: 'ord_x', customer_id: 'cus_nobody', customer: { email: 'nobody@example.com' } },
      });
      const b = polar.applyEvent(polar.verifyWebhook(Buffer.from(nobody), signedDelivery('wh_nobody', nobody)));
      assert(b.problem === 'no_matching_account', `expected no_matching_account, got ${b.problem}`);

      const harmless = JSON.stringify({ type: 'checkout.created', data: { id: 'co_h' } });
      const c = polar.applyEvent(polar.verifyWebhook(Buffer.from(harmless), signedDelivery('wh_harmless', harmless)));
      assert(!c.problem, 'an event we do not act on is not a problem');

      assert(logged.some((l) => l.includes('WEBHOOK NOT APPLIED') && l.includes('plan_not_resolved')), 'must be logged loudly');
      assert(!logged.some((l) => l.includes('nobody@example.com')), 'the log must not carry customer data');
    } finally {
      console.error = originalError;
    }
  });

  await check('the report puts billing events that did not apply at the top', async () => {
    store.recordEvent({ endpoint: 'billing', outcome: 'subscription.created', code: 'not_applied:plan_not_resolved', status: 200 });
    const { buildReport } = await import('../tools/report.js');
    const report = buildReport(store.open(), { days: 1 });
    assert(report.indexOf('BILLING EVENTS NOT APPLIED') !== -1, 'the warning section is missing');
    assert(report.indexOf('BILLING EVENTS NOT APPLIED') < report.indexOf('FUNNEL BY DAY'), 'the warning must come first');
  });

  await check('webhook redelivery is idempotent', () => {
    const account = store.createAccount('k@example.com');
    const body = JSON.stringify({
      type: 'subscription.created',
      data: { id: 'sub_2', product_id: 'prod_starter_abc', customer_id: 'cus_2', metadata: { account_id: account.id } },
    });
    const headers = signedDelivery('wh_dup', body);
    polar.applyEvent(polar.verifyWebhook(Buffer.from(body), headers));
    const second = polar.applyEvent(polar.verifyWebhook(Buffer.from(body), headers));
    assert(second.duplicate === true, 'a redelivered event must be a no-op');
  });

  await check('cancellation degrades to free rather than locking out', () => {
    const account = store.createAccount('l@example.com');
    store.updateAccount(account.id, { plan: 'scale' });
    const body = JSON.stringify({
      type: 'subscription.canceled',
      data: { id: 'sub_3', customer_id: 'cus_3', metadata: { account_id: account.id } },
    });
    polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_cancel', body)));
    const after = store.getAccount(account.id);
    assert(after.plan === 'free', `expected free, got ${after.plan}`);
    assert(after.status === 'active', 'a cancelled customer keeps a working free tier');
  });

  await check('usage is scoped to the billing period', () => {
    const account = store.createAccount('m@example.com');
    store.recordUsage(account.id, 'render', '2026-01');
    store.recordUsage(account.id, 'render', '2026-02');
    assert(store.getUsage(account.id, '2026-01').renders === 1, 'January should hold one');
    assert(store.getUsage(account.id, '2026-02').renders === 1, 'February should hold one');
    assert(store.getUsage(account.id, '2026-03').renders === 0, 'March should be empty');
  });

  await check('account summary reports overage in dollars', () => {
    const account = store.createAccount('n@example.com');
    store.updateAccount(account.id, { plan: 'starter' });
    for (let i = 0; i < 3_000; i += 1) store.recordUsage(account.id, 'render');
    const summary = billing.accountSummary(account.id);
    assert(summary.usage.overage_units === 1_000, `expected 1000 overage, got ${summary.usage.overage_units}`);
    // 1,000 units at $7.90/1k.
    assert(summary.usage.overage_due_usd === 7.9, `expected $7.90, got ${summary.usage.overage_due_usd}`);
  });

  await check('a failed renewal suspends, and resuming clears it', () => {
    const account = store.createAccount('o@example.com');
    store.updateAccount(account.id, { plan: 'growth' });
    const mk = (type, id) => {
      const body = JSON.stringify({
        type,
        data: { id: 'sub_pd', customer_id: 'cus_pd', metadata: { account_id: account.id } },
      });
      return polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery(id, body)));
    };

    mk('subscription.past_due', 'wh_pd');
    let current = store.getAccount(account.id);
    assert(current.status === 'past_due', `expected past_due, got ${current.status}`);
    // The plan is kept: a card that fails today may succeed tomorrow, and
    // wiping the plan would lose what they are paying for.
    assert(current.plan === 'growth', 'suspension must not downgrade the plan');
    const quota = store.checkQuota(current);
    assert(!quota.allowed && quota.reason === 'account_inactive', 'a past_due account must be refused');

    mk('subscription.resumed', 'wh_res');
    current = store.getAccount(account.id);
    assert(current.status === 'active', 'resuming should restore service');
    assert(store.checkQuota(current).allowed, 'a resumed account should render again');
  });

  await check('a paid account bills on its subscription period, not the calendar', () => {
    const account = store.createAccount('cycle1@example.com');
    store.updateAccount(account.id, { plan: 'starter', period_start: '2026-01-15T00:00:00Z' });
    const acct = store.getAccount(account.id);
    const key = (iso) => store.periodForAccount(acct, new Date(iso));

    // The whole window from the 15th to the 14th is ONE period.
    assert(key('2026-01-15T00:00:00Z') === '2026-01-15', key('2026-01-15T00:00:00Z'));
    assert(key('2026-01-31T23:59:00Z') === '2026-01-15', "the 31st is still inside the January period");
    assert(key('2026-02-01T00:00:00Z') === '2026-01-15', 'the 1st must NOT start a new period');
    assert(key('2026-02-14T23:59:00Z') === '2026-01-15', 'the 14th is the last day');
    assert(key('2026-02-15T00:00:00Z') === '2026-02-15', 'the 15th starts the next one');
  });

  await check('the quota does not reset on the 1st for a mid-month subscriber', () => {
    const account = store.createAccount('cycle2@example.com');
    store.updateAccount(account.id, { plan: 'starter', period_start: '2026-01-15T00:00:00Z' });
    const acct = store.getAccount(account.id);
    const jan20 = store.periodForAccount(acct, new Date('2026-01-20T00:00:00Z'));
    const feb05 = store.periodForAccount(acct, new Date('2026-02-05T00:00:00Z'));
    assert(jan20 === feb05, 'renders either side of the 1st must land in one period');
    for (let i = 0; i < 1_500; i += 1) store.recordUsage(account.id, 'render', jan20);
    for (let i = 0; i < 600; i += 1) store.recordUsage(account.id, 'render', feb05);
    // 2,100 against a 2,000 plan is 100 of overage. Under calendar months it
    // would have read 1,500 and 600 - two under-quota months, nothing billed.
    assert(store.getUsage(account.id, jan20).renders === 2_100, 'both halves land in one period');
    const quota = store.checkQuota(acct, jan20);
    assert(quota.overage === 101, `expected overage, got ${quota.overage}`);
  });

  await check('an anniversary on the 31st clamps into short months', () => {
    const account = store.createAccount('cycle3@example.com');
    store.updateAccount(account.id, { plan: 'starter', period_start: '2026-01-31T00:00:00Z' });
    const acct = store.getAccount(account.id);
    const key = (iso) => store.periodForAccount(acct, new Date(iso));
    // February has no 31st. The period must roll on the 28th, not leak into
    // March 3rd and overlap the next one.
    assert(key('2026-02-27T00:00:00Z') === '2026-01-31', key('2026-02-27T00:00:00Z'));
    assert(key('2026-02-28T12:00:00Z') === '2026-02-28', key('2026-02-28T12:00:00Z'));
    assert(key('2026-03-30T00:00:00Z') === '2026-02-28', key('2026-03-30T00:00:00Z'));
    assert(key('2026-03-31T00:00:00Z') === '2026-03-31', key('2026-03-31T00:00:00Z'));
  });

  await check('a missed cycled webhook cannot freeze the period', () => {
    const account = store.createAccount('cycle4@example.com');
    store.updateAccount(account.id, { plan: 'starter', period_start: '2026-01-15T00:00:00Z' });
    const acct = store.getAccount(account.id);
    // Six months later with no webhook ever delivered. The window still has
    // to advance, or the customer renders free forever.
    const key = store.periodForAccount(acct, new Date('2026-07-20T00:00:00Z'));
    assert(key === '2026-07-15', `expected 2026-07-15, got ${key}`);
  });

  await check('subscription.cycled re-anchors the period to Polar', () => {
    const account = store.createAccount('cycle5@example.com');
    store.updateAccount(account.id, { plan: 'starter', period_start: '2026-01-15T00:00:00Z' });
    const body = JSON.stringify({
      type: 'subscription.cycled',
      data: {
        id: 'sub_cyc',
        customer_id: 'cus_cyc',
        current_period_start: '2026-02-15T00:00:00Z',
        metadata: { account_id: account.id },
      },
    });
    const res = polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_cyc', body)));
    assert(res.applied.startsWith('cycled='), `expected cycled, got ${res.applied}`);
    const acct = store.getAccount(account.id);
    assert(acct.period_start === '2026-02-15T00:00:00Z', acct.period_start);
    assert(acct.plan === 'starter', 'a renewal must not change the plan');
    // A fresh period means a fresh usage row, which is the reset.
    assert(store.getUsage(account.id, store.periodForAccount(acct, new Date('2026-02-20T00:00:00Z'))).renders === 0,
      'the new period starts empty');
  });

  await check('losing a subscription returns the account to calendar months', () => {
    const account = store.createAccount('cycle6@example.com');
    store.updateAccount(account.id, { plan: 'growth', period_start: '2026-01-15T00:00:00Z' });
    const body = JSON.stringify({
      type: 'subscription.revoked',
      data: { id: 'sub_rev2', customer_id: 'cus_rev2', metadata: { account_id: account.id } },
    });
    polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_rev2', body)));
    const acct = store.getAccount(account.id);
    assert(acct.plan === 'free', 'revoked drops to free');
    assert(!acct.period_start, `the anchor must be cleared, got ${acct.period_start}`);
    assert(store.periodForAccount(acct, new Date('2026-03-09T00:00:00Z')) === '2026-03',
      'a free account is back on calendar months');
  });
  await check('order.paid links the Polar customer id', () => {
    const account = store.createAccount('p@example.com');
    const body = JSON.stringify({
      type: 'order.paid',
      data: { id: 'ord_1', customer_id: 'cus_link', metadata: { account_id: account.id } },
    });
    polar.applyEvent(polar.verifyWebhook(Buffer.from(body), signedDelivery('wh_paid', body)));
    assert(
      store.getAccount(account.id).polar_customer_id === 'cus_link',
      'order.paid should link the customer id for later lookups',
    );
  });

  await check('email shape validation', () => {
    const good = ['a@b.co', 'first.last+tag@sub.example.org'];
    const bad = ['', 'nope', 'a@b', 'a@@b.co', 'a b@c.co', '@b.co', 'a@', 'a@.co', 'a@b..co'];
    for (const e of good) assert(email.hasValidShape(e), `${e} should be valid`);
    for (const e of bad) assert(!email.hasValidShape(e), `${JSON.stringify(e)} should be invalid`);
  });

  await check('deliverability follows MX, and fails OPEN on resolver trouble', async () => {
    // Injected resolver, so this never touches the network.
    const withMx = () => Promise.resolve([{ exchange: 'mx.example.net', priority: 10 }]);
    const noMx = () => Promise.resolve([]);
    // RFC 7505 null MX - a record that says 'no mail here'. example.com
    // publishes this, and a length-only check reads it as deliverable.
    const nullMx = () => Promise.resolve([{ exchange: '', priority: 0 }]);
    const dotMx = () => Promise.resolve([{ exchange: '.', priority: 0 }]);
    const nxdomain = () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
    const servfail = () => Promise.reject(Object.assign(new Error('boom'), { code: 'ESERVFAIL' }));

    assert(await email.isDeliverable('a@b.co', { resolveMx: withMx }), 'MX present should pass');
    assert(!(await email.isDeliverable('a@b.co', { resolveMx: noMx })), 'empty MX should fail');
    assert(!(await email.isDeliverable('a@b.co', { resolveMx: nxdomain })), 'NXDOMAIN should fail');
    // The important one: OUR dns being broken must never reject a customer.
    assert(await email.isDeliverable('a@b.co', { resolveMx: servfail }), 'resolver failure must fail open');
    assert(!(await email.isDeliverable('a@b.co', { resolveMx: nullMx })), 'null MX must be refused');
    assert(!(await email.isDeliverable('a@b.co', { resolveMx: dotMx })), 'dot MX must be refused');
  });

  await check('checkEmail returns an actionable error, not a boolean', async () => {
    const withMx = () => Promise.resolve([{ exchange: 'mx', priority: 1 }]);
    const noMx = () => Promise.resolve([]);
    assert((await email.checkEmail('good@example.org', { resolveMx: withMx })) === null, 'valid should pass');
    const shape = await email.checkEmail('nonsense', { resolveMx: withMx });
    assert(shape?.code === 'invalid_email', `expected invalid_email, got ${shape?.code}`);
    const undeliverable = await email.checkEmail('a@nomx.test', { resolveMx: noMx });
    assert(undeliverable?.code === 'undeliverable_email', 'expected undeliverable_email');
    assert(undeliverable.message.includes('nomx.test'), 'the error should name the domain at fault');
  });

  await check('email can be changed, and collisions are refused', () => {
    const a = store.createAccount('before@example.com');
    const b = store.createAccount('taken@example.com');
    const updated = store.updateEmail(a.id, 'After@Example.com  ');
    assert(updated.email === 'after@example.com', `expected normalised, got ${updated.email}`);
    assert(store.getAccountByEmail('after@example.com')?.id === a.id, 'lookup should follow the change');
    assert(store.getAccountByEmail('before@example.com') === null, 'the old address should stop resolving');
    let threw = null;
    try { store.updateEmail(a.id, b.email); } catch (err) { threw = err; }
    assert(threw?.code === 'email_taken', `expected email_taken, got ${threw?.code}`);
    assert(store.getAccount(a.id).email === 'after@example.com', 'a refused change must not partially apply');
  });

  await check('changing email does not disturb keys, plan or usage', () => {
    const account = store.createAccount('keep@example.com');
    const key = store.createKey(account.id);
    store.updateAccount(account.id, { plan: 'growth' });
    store.recordUsage(account.id, 'render');
    store.updateEmail(account.id, 'moved@example.com');
    const resolved = store.resolveKey(key.key);
    assert(resolved?.id === account.id, 'the key must still work after an email change');
    assert(resolved.plan === 'growth', 'plan must survive');
    assert(store.getUsage(account.id).renders === 1, 'usage must survive');
  });

  await check('only EXCESS renders are ingested, never included ones', () => {
    ingest.reset();
    const account = store.createAccount('q@example.com');
    store.updateAccount(account.id, { plan: 'starter' });
    const key = store.createKey(account.id);

    // Well inside the allowance: nothing should be reported to Polar.
    let auth = billing.authorize({ access_key: key.key }, {});
    billing.meter(auth, 'render');
    assert(ingest.snapshot().pending === 0, 'an included render must not be ingested');

    // Push the account over its included 2,000.
    for (let i = 0; i < 2_000; i += 1) store.recordUsage(account.id, 'render');
    auth = billing.authorize({ access_key: key.key }, {});
    assert(auth.quota.overage > 0, 'this request should be over the allowance');
    billing.meter(auth, 'render');
    assert(ingest.snapshot().pending === 1, 'an excess render must be ingested');
  });

  await check('ingested events carry our account id, not a Polar id', async () => {
    ingest.reset();
    const sent = [];
    ingest.ingest('acct_known');
    await ingest.flush({
      fetchImpl: async (url, opts) => {
        sent.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
        return { ok: true, status: 200, text: async () => '' };
      },
    });
    assert(sent.length === 1, 'one batch should have been sent');
    assert(sent[0].headers['Polar-Version'] === '2026-04', `ingest not pinned: ${sent[0].headers['Polar-Version']}`);
    assert(sent[0].url.endsWith('/v1/events/ingest'), `unexpected url ${sent[0].url}`);
    const ev = sent[0].body.events[0];
    assert(ev.external_customer_id === 'acct_known', 'must use external_customer_id with OUR id');
    assert(ev.customer_id === undefined, 'must not send a Polar customer_id');
    assert(ev.name === 'render', `unexpected meter name ${ev.name}`);
  });

  await check('checkout requests are pinned to a Polar API version', async () => {
    // Unpinned requests follow Polar's "Current", which changes every quarter
    // - first on 1 October 2026 - so the contract would move without a deploy.
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      seen.push({ url, headers: opts.headers });
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'co_1', url: 'https://polar.test/co_1' }) };
    };
    try {
      const account = store.createAccount('pinned@example.com');
      await polar.createCheckout({ account, plan: 'starter' });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert(seen.length === 1 && seen[0].url.endsWith('/v1/checkouts/'), `unexpected calls: ${JSON.stringify(seen)}`);
    assert(seen[0].headers['Polar-Version'] === '2026-04', `checkout not pinned: ${seen[0].headers['Polar-Version']}`);
  });

  await check('a 5xx is retried, a 4xx is dropped', async () => {
    ingest.reset();
    ingest.ingest('acct_a');
    await ingest.flush({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'nope' }) });
    assert(ingest.snapshot().pending === 1, 'a 5xx must put the batch back for retry');

    await ingest.flush({ fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'bad' }) });
    assert(ingest.snapshot().pending === 0, 'a 4xx would fail forever, so it must be dropped');
    assert(ingest.snapshot().dropped === 1, 'the drop should be counted, not silent');
  });

  await check('a network error keeps the events for later', async () => {
    ingest.reset();
    ingest.ingest('acct_b');
    await ingest.flush({ fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert(ingest.snapshot().pending === 1, 'a thrown fetch must not lose the batch');
    assert(ingest.snapshot().sent === 0, 'nothing was sent');
  });

  await check('the buffer is bounded', () => {
    ingest.reset();
    const max = 50_000;
    for (let i = 0; i < max + 25; i += 1) ingest.ingest('acct_c');
    const snap = ingest.snapshot();
    assert(snap.pending === max, `buffer should cap at ${max}, got ${snap.pending}`);
    assert(snap.dropped === 25, `expected 25 dropped, got ${snap.dropped}`);
  });

  await check('ingestion is inert when no meter is configured', async () => {
    ingest.reset();
    const original = config.default.polar.usageMeter;
    config.default.polar.usageMeter = '';
    try {
      ingest.ingest('acct_d');
      assert(ingest.snapshot().pending === 0, 'nothing should queue without a meter');
      assert(ingest.isEnabled() === false, 'isEnabled should be false');
    } finally {
      config.default.polar.usageMeter = original;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  store.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('billing run crashed:', err);
  process.exit(1);
});
