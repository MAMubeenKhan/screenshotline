/**
 * Polar integration: checkout, and the webhooks that keep plans in sync.
 *
 * Polar is the merchant of record, which is the whole reason it was chosen
 * over Stripe direct. It sells to the customer, collects the money, and
 * handles sales tax, VAT and GST in every jurisdiction it sells into. We are
 * a supplier to Polar, not a merchant, so we never register for VAT anywhere
 * and never file an OSS return. That is worth several percent of revenue in
 * fees and is the correct trade for a solo operator - especially one in India,
 * where Stripe standalone is invite-only and Polar's Connect Express payouts
 * work regardless.
 *
 * Deliberately hand-rolled against the REST API rather than pulling in the
 * Polar SDK. Two endpoints and one signature check do not justify a
 * dependency that would ship to every self-hoster who has billing turned off.
 *
 * SUBSCRIPTION STATE LIVES IN POLAR, NOT HERE. Our accounts table caches the
 * plan so the gateway can answer a quota question in one indexed read, but
 * webhooks are the only thing that writes it. Never infer a plan change from a
 * successful checkout redirect: the customer can close the tab, and the card
 * can still fail afterwards.
 */
import crypto from 'node:crypto';
import config from './config.js';
import * as store from './store.js';

const API = {
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
};

const base = () => API[config.polar.server] || API.sandbox;

class PolarError extends Error {
  constructor(message, code = 'polar_error', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call(path, { method = 'GET', body } = {}) {
  if (!config.polar.accessToken) {
    throw new PolarError(
      'Billing is not configured on this deployment - POLAR_ACCESS_TOKEN is unset.',
      'billing_not_configured',
      503,
    );
  }
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.polar.accessToken}`,
      'Content-Type': 'application/json',
      // Pinned, so Polar's quarterly releases cannot change the contract
      // under us. See config.polar.apiVersion.
      'Polar-Version': config.polar.apiVersion,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PolarError(
      `Polar ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`,
      'polar_request_failed',
      502,
    );
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Create a checkout session for an upgrade.
 *
 * The account id rides along in metadata so the webhook can find its way back
 * to us without depending on the email matching - a customer can perfectly
 * well pay with a different address than they signed up with.
 */
export async function createCheckout({ account, plan }) {
  const productId = config.polar.products[plan];
  if (!productId) {
    throw new PolarError(
      `No Polar product is configured for the "${plan}" plan. Set POLAR_PRODUCT_${plan.toUpperCase()}.`,
      'plan_not_configured',
      503,
    );
  }

  // Polar validates that the email domain actually accepts mail (it checks
  // MX records), and rejects the whole checkout if it does not. Our signup
  // only checks for an '@', so a customer can hold a perfectly good account
  // for weeks and then hit this at the exact worst moment - the upgrade.
  // Translate it into something they can act on.
  let checkout;
  try {
    checkout = await call('/v1/checkouts/', {
      method: 'POST',
      body: {
        products: [productId],
        // Our account id, stamped onto the Polar customer at creation.
        //
        // This is what makes usage ingestion work: events are ingested with
        // external_customer_id = account.id, and Polar can only attribute
        // them to a customer that carries the same external id. Without this
        // line the events are accepted and then belong to nobody, so overage
        // silently never bills - the failure mode is no error at all.
        external_customer_id: account.id,
        customer_email: account.email,
        success_url: config.polar.successUrl || undefined,
        metadata: { account_id: account.id, plan },
      },
    });
  } catch (err) {
    if (/customer_email/.test(err.message) && /not a valid email|does not accept email/i.test(err.message)) {
      throw new PolarError(
        `Our payment provider will not accept ${account.email} - that domain does not receive mail, and a receipt could never reach you. Update the account email and try again.`,
        'undeliverable_email',
        400,
      );
    }
    throw err;
  }

  return {
    checkout_url: checkout.url,
    checkout_id: checkout.id,
    plan,
    expires_at: checkout.expires_at,
  };
}

/**
 * Verify a webhook.
 *
 * Polar signs with the Standard Webhooks scheme: the signed payload is
 * `${id}.${timestamp}.${body}`, HMAC-SHA256 with the secret, base64. The
 * secret arrives base64-encoded behind a `whsec_` prefix.
 *
 * `body` must be the raw bytes. Anything that re-serialises JSON first will
 * produce a different string and fail every time, which is why the route
 * mounts express.raw.
 */
export function verifyWebhook(rawBody, headers) {
  const secret = config.polar.webhookSecret;
  if (!secret) {
    throw new PolarError('POLAR_WEBHOOK_SECRET is not set.', 'webhook_not_configured', 503);
  }

  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader) {
    throw new PolarError('Missing webhook signature headers.', 'invalid_signature', 400);
  }

  // Reject anything older than five minutes, so a captured delivery cannot be
  // replayed later to downgrade or upgrade an account.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    throw new PolarError('Webhook timestamp is outside the accepted window.', 'invalid_signature', 400);
  }

  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'utf8');

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');

  // The header carries a space-separated list of `v1,<sig>` - more than one
  // during a secret rotation. Any match is a pass.
  const provided = String(signatureHeader)
    .split(' ')
    .map((part) => part.split(',').pop());

  const ok = provided.some((sig) => {
    const a = Buffer.from(sig || '');
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw new PolarError('Webhook signature does not match.', 'invalid_signature', 403);

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    throw new PolarError('Webhook body is not valid JSON.', 'invalid_webhook', 400);
  }
  return { ...event, deliveryId: id };
}

/** Map a Polar subscription to one of our plans, by product id. */
function planForProduct(productId) {
  const entry = Object.entries(config.polar.products).find(([, id]) => id && id === productId);
  return entry ? entry[0] : null;
}

/**
 * Apply a verified event.
 *
 * Idempotent by delivery id: Polar retries on any non-2xx, and applying a
 * subscription change twice must be a no-op rather than a double downgrade.
 */
export function applyEvent(event) {
  const db = store.open();
  const already = db
    .prepare('SELECT id FROM webhook_events WHERE id = ?')
    .get(event.deliveryId);
  if (already) return { duplicate: true, type: event.type };

  const data = event.data || {};
  const accountId = data.metadata?.account_id || data.checkout?.metadata?.account_id;
  const customerId = data.customer_id || data.customer?.id;

  let account = accountId ? store.getAccount(accountId) : null;
  if (!account && customerId) account = store.getAccountByPolarCustomer(customerId);
  if (!account && data.customer?.email) account = store.getAccountByEmail(data.customer.email);

  let applied = 'ignored';
  // Webhook payloads follow the endpoint's API version, set in Polar's
  // dashboard - ours are on 2026-10, which is Polar's "Next" (free to
  // change) until 1 October 2026. So read the product both ways, and never
  // let a money event that should have changed an account pass as a quiet
  // "ignored": that is a customer who paid and was not upgraded.
  let problem = null;
  const productId = data.product_id || data.product?.id;

  if (!account && MONEY_EVENTS.has(event.type)) problem = 'no_matching_account';

  if (account) {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated': {
        const plan = planForProduct(productId) || data.metadata?.plan;
        if (!(plan && store.isPlan(plan))) problem = 'plan_not_resolved';
        if (plan && store.isPlan(plan)) {
          store.updateAccount(account.id, {
            plan,
            status: 'active',
            polar_customer_id: customerId || account.polar_customer_id,
            polar_subscription_id: data.id || account.polar_subscription_id,
            period_start: data.current_period_start || account.period_start || null,
          });
          applied = `plan=${plan}`;
        }
        break;
      }
      // A renewal. Polar's meter counts usage per SUBSCRIPTION period, ours
      // counted per calendar month, and for anyone who did not subscribe on
      // the 1st those are different windows - so a customer could use their
      // full allowance twice inside one invoiced period and be billed for
      // neither excess. Re-anchoring here is what reconciles them, and it
      // uses Polar's own current_period_start rather than our arithmetic, so
      // any local drift is corrected once a month.
      case 'subscription.cycled': {
        if (!data.current_period_start) problem = 'no_period_start';
        if (data.current_period_start) {
          store.updateAccount(account.id, {
            period_start: data.current_period_start,
            status: 'active',
          });
          applied = `cycled=${data.current_period_start}`;
        }
        break;
      }
      case 'subscription.canceled':
      case 'subscription.revoked': {
        // Back to free rather than locked out. A lapsed customer who can still
        // make 500 calls a month keeps their integration alive and comes back;
        // one whose integration hard-fails rips it out and does not.
        // period_start goes with it: a free account bills on calendar months,
        // and leaving a stale anchor behind would keep resetting their 500 on
        // the old subscription anniversary.
        store.updateAccount(account.id, { plan: 'free', status: 'active', period_start: null });
        applied = 'plan=free';
        break;
      }
      // A failed renewal suspends rather than downgrades. checkQuota already
      // refuses a non-active account with account_inactive - until now
      // nothing ever set that status, so the refusal was unreachable.
      case 'subscription.past_due': {
        store.updateAccount(account.id, { status: 'past_due' });
        applied = 'status=past_due';
        break;
      }
      case 'subscription.paused': {
        store.updateAccount(account.id, { status: 'paused' });
        applied = 'status=paused';
        break;
      }
      case 'subscription.resumed':
      case 'subscription.uncanceled': {
        store.updateAccount(account.id, { status: 'active' });
        applied = 'status=active';
        break;
      }
      case 'order.created':
      case 'order.paid': {
        if (customerId && !account.polar_customer_id) {
          store.updateAccount(account.id, { polar_customer_id: customerId });
          applied = 'linked_customer';
        }
        break;
      }
      default:
        break;
    }
  }

  db.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)').run(
    event.deliveryId,
    event.type,
    new Date().toISOString(),
  );

  if (problem) {
    // Loud, and without customer data: the field NAMES say whether Polar
    // changed the payload shape, which is the question this exists to answer.
    console.error(
      `[polar] WEBHOOK NOT APPLIED: ${event.type} (${problem}) delivery=${event.deliveryId} ` +
      `data keys=[${Object.keys(data).join(',')}]`,
    );
  }

  return { duplicate: false, type: event.type, account_id: account?.id || null, applied, problem };
}

// Events that must change an account when they arrive. Any of these that
// matches no account, or cannot be applied, is reported as a problem.
const MONEY_EVENTS = new Set([
  'subscription.created', 'subscription.active', 'subscription.updated',
  'subscription.cycled', 'subscription.canceled', 'subscription.revoked',
  'subscription.past_due', 'order.paid',
]);

export default { createCheckout, verifyWebhook, applyEvent };
