/**
 * The billing gateway: who is calling, may they, and what did it cost.
 *
 * Kept separate from auth.js because the two answer different questions.
 * auth.js asks "is this request well-formed and signed"; this asks "is there
 * an account behind it and does that account have quota left". A self-hoster
 * runs the first and not the second, which is why BILLING_ENABLED defaults to
 * off and none of this is on the path until it is turned on.
 *
 * The billing policy, which is a product decision and not an accident:
 *
 *   - A cache hit is not billable. The customer already paid for that image.
 *   - A failed render is not billable. We can honour that literally, because
 *     blank detection means we can tell a capture from a blank frame - most
 *     competitors cannot, which is why they promise it and we can prove it.
 *   - A free account is hard-stopped at its limit rather than accruing
 *     overage. Nobody entered a card, so there is nothing to charge and an
 *     invoice would be a surprise.
 */
import config from './config.js';
import * as store from './store.js';
import * as ingest from './usage-ingest.js';

export class BillingError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Resolve the caller to an account and confirm it has quota.
 *
 * Returns null when billing is off, which is the signal to callers that there
 * is nothing to meter.
 */
export function authorize(params, headers = {}) {
  if (!config.billingEnabled) return null;

  const presented = params.access_key || headers['x-access-key'];
  if (!presented) {
    throw new BillingError(
      'Missing API key. Pass ?access_key=... or an X-Access-Key header. Create one free at POST /v1/accounts - no card required.',
      'missing_access_key',
      401,
    );
  }

  const account = store.resolveKey(presented);
  if (!account) {
    throw new BillingError(
      'Unknown or revoked API key.',
      'invalid_access_key',
      403,
    );
  }

  const quota = store.checkQuota(account);
  if (!quota.allowed) {
    // 402 is the honest status here. It is not that the request was malformed
    // or the key was wrong - it is that this costs money and the account is
    // out of room.
    throw new BillingError(quota.message, quota.reason, 402);
  }

  store.touchKey(account.key_id);
  return { account, quota };
}

/**
 * What a delivered capture counts as. A capture flagged blank is unbilled
 * while the account is inside its blank allowance for the period; after
 * that it is a render like any other, because the image was still delivered.
 * `failed` includes errors and timeouts, so the allowance errs strict.
 */
export function kindFor(billing, blankSuspected) {
  if (!blankSuspected) return 'render';
  if (!billing) return 'failed';
  const failedSoFar = billing.quota?.usage?.failed ?? 0;
  return failedSoFar < store.blankAllowance(billing.quota.plan) ? 'failed' : 'render';
}

/** Count one outcome against the account. Never throws into the request path. */
export function meter(billing, kind) {
  if (!billing) return;
  try {
    store.recordUsage(billing.account.id, kind);
  } catch (err) {
    // A metering failure must not turn a good capture into a 500. Losing a
    // count is a revenue bug; losing the customer's image is a product bug,
    // and the second is worse.
    console.error('[usage] failed to record', kind, 'for', billing.account.id, err.message);
  }

  // Only billable EXCESS is reported to Polar, and only for a real render.
  // checkQuota already worked out whether this request is over the plan's
  // included allowance, so Polar never has to know what 'included' means -
  // it just prices each excess unit. Fire and forget: this must never make a
  // customer wait on a third party.
  if (kind === 'render' && billing.quota?.overage > 0) {
    ingest.ingest(billing.account.id);
  }
}

/** Headers so a customer can see their position without a second request. */
export function usageHeaders(billing) {
  if (!billing) return {};
  const { account, quota } = billing;
  const usage = store.getUsage(account.id);
  return {
    'X-Plan': account.plan,
    'X-Quota-Limit': String(quota.plan.included),
    'X-Quota-Used': String(usage.renders),
    'X-Quota-Remaining': String(Math.max(0, quota.plan.included - usage.renders)),
    'X-Quota-Period': usage.period,
  };
}

/**
 * The public shape of an account, for the dashboard and the API.
 *
 * NOTE ON OVERAGE: overage_due_usd is COMPUTED AND DISPLAYED, NOT CHARGED.
 * Polar products are configured as a fixed monthly price, and nothing here
 * pushes usage into a Polar meter, so a paid account that runs past its
 * included amount keeps working and is never invoiced for the excess.
 *
 * That is a deliberate staging decision, not an oversight: fixed price gets
 * the whole subscribe/webhook/entitlement loop working and earning, and the
 * cost of un-billed overage is cents at Starter volume. It stops being cents
 * at Scale volume.
 *
 * TO ACTUALLY CHARGE IT (do this before the first Scale customer):
 *
 *  1. In Polar, create a meter that filters events by name = 'render' and
 *     aggregates with count (or sum over metadata.units if we ever weight
 *     a full-page capture differently from a viewport one).
 *  2. Add a METERED price to each subscription product alongside the fixed
 *     one, priced at PLANS[x].overagePer1k. Metered prices only attach to
 *     subscription products, which ours are.
 *  3. Ingest on every billable render, from meter() below:
 *       POST /v1/events/ingest
 *       { events: [{ name: 'render',
 *                    external_customer_id: <our account.id>,
 *                    metadata: { units: 1 } }] }
 *     Use external_customer_id, NOT customer_id: it takes our own account
 *     id, so ingestion never has to wait for polar_customer_id to be linked
 *     by a webhook, and never breaks if that link is missing.
 *  4. Batch it. One HTTP call per render would put a third-party network
 *     round trip on the hot path of the thing customers are paying for -
 *     buffer and flush on an interval, and drop the buffer rather than fail
 *     a capture. Losing a count is a revenue bug; losing the image is a
 *     product bug, and the second is worse (same rule as meter() below).
 *  5. Polar then aggregates and invoices the excess itself, so the number
 *     shown here stops being decorative. Keep computing it locally anyway -
 *     it is what the dashboard shows mid-month, before Polar has invoiced.
 *
 * Related: our usage periods are calendar months while subscriptions renew
 * on their anniversary. Polar's meter uses the subscription period, so once
 * this lands the two will disagree for anyone who did not subscribe on the
 * 1st. subscription.cycled is the event that reconciles them.
 */
export function accountSummary(accountId) {
  const account = store.getAccount(accountId);
  if (!account) return null;
  const plan = store.PLANS[account.plan] || store.PLANS.free;
  const usage = store.getUsage(account.id);
  const overageUnits = Math.max(0, usage.renders - plan.included);
  return {
    id: account.id,
    email: account.email,
    status: account.status,
    plan: {
      id: plan.id,
      name: plan.name,
      price_usd: plan.priceCents / 100,
      included: plan.included,
      overage_per_1k_usd: plan.overagePer1k === null ? null : plan.overagePer1k / 100,
    },
    usage: {
      period: usage.period,
      renders: usage.renders,
      cached: usage.cached,
      failed: usage.failed,
      remaining: Math.max(0, plan.included - usage.renders),
      overage_units: overageUnits,
      overage_due_usd:
        plan.overagePer1k === null ? 0 : Number(((overageUnits / 1000) * (plan.overagePer1k / 100)).toFixed(4)),
    },
    keys: store.listKeys(account.id),
  };
}

export default { authorize, meter, usageHeaders, accountSummary, BillingError };
