/**
 * Account, key and plan endpoints.
 *
 * Mounted only when BILLING_ENABLED is on, so a self-hosted deployment does
 * not grow a signup form it never asked for.
 *
 * Signup takes an email and returns a working key immediately, with no card
 * and no confirmation step. That is deliberate and it is in the plan: the
 * free tier is a distribution channel, and every field between a developer
 * and their first successful curl is a place they leave.
 *
 * There is still no confirmation email - nobody has to click a link to start
 * rendering. But the address IS checked for deliverability at signup, which
 * is a change from the original design and worth explaining. Polar refuses a
 * checkout for a domain with no MX records. Leaving that to the upgrade meant
 * a customer could sign up with a typo, integrate for weeks, and hit an
 * unfixable error at the exact moment they tried to pay us. Two seconds of
 * DNS at signup, or a lost sale later.
 */
import express from 'express';
import * as store from './store.js';
import * as billing from './billing.js';
import * as polar from './polar.js';
import config from './config.js';
import { checkEmail } from './email.js';
import * as limits from './limits.js';

// "Where did you hear about us?" - optional, self-reported, and the only
// attribution we collect: no tracking script, no cookie, no fingerprint.
// Anything outside this list is dropped rather than stored.
export const SIGNUP_SOURCES = [
  'hacker-news', 'reddit', 'github', 'search', 'mcp-directory', 'x-twitter',
  'linkedin', 'product-hunt', 'dev-to', 'friend', 'other',
];

/** Authenticate a management request with an API key belonging to the account. */
function requireAccount(req) {
  const presented =
    req.headers['x-access-key'] ||
    req.query.access_key ||
    (req.body && req.body.access_key) ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const account = store.resolveKey(presented);
  if (!account) {
    throw Object.assign(new Error('Provide a valid API key as X-Access-Key or Authorization: Bearer.'), {
      code: 'invalid_access_key',
      status: 401,
    });
  }
  return account;
}

export function accountsRouter() {
  const router = express.Router();

  // The price list, public. Also the single source of truth for the pricing
  // page, so the page can never drift from what the gateway enforces.
  router.get('/v1/plans', (req, res) => {
    res.json({
      plans: Object.values(store.PLANS).map((p) => ({
        id: p.id,
        name: p.name,
        price_usd: p.priceCents / 100,
        included_renders: p.included,
        overage_per_1k_usd: p.overagePer1k === null ? null : p.overagePer1k / 100,
        requires_card: p.requiresCard,
      })),
    });
  });

  // Sign up. No card, no confirmation, working key in the response.
  router.post('/v1/accounts', async (req, res, next) => {
    const source = SIGNUP_SOURCES.includes(req.body?.source) ? req.body.source : null;
    try {
      const email = req.body?.email;
      // Free keys are free compute, so minting them is rationed per network.
      // Counted on success only: a typo'd address does not use the allowance.
      limits.checkSignup(req.ip);
      // Checked here rather than at upgrade time. Polar refuses a checkout
      // for a domain with no MX records, and discovering that months later,
      // at the moment someone tries to pay, is the worst possible ordering.
      const bad = await checkEmail(email);
      if (bad) throw bad;
      const account = store.createAccount(email);
      const key = store.createKey(account.id, { name: 'default' });
      limits.recordSignup(req.ip);
      store.recordEvent({
        endpoint: 'signup', outcome: 'created', status: 201,
        account_id: account.id, code: source, visitor: store.visitorHash(req.ip),
      });
      res.status(201).json({
        account_id: account.id,
        email: account.email,
        plan: account.plan,
        included_renders: store.PLANS[account.plan].included,
        // Said once, because it is stored only as a hash and cannot be shown
        // again. The dashboard says the same thing.
        api_key: key.key,
        warning: 'Save this key now. It is stored hashed and cannot be shown again.',
      });
    } catch (err) {
      // Refused signups are part of the funnel too: rate limits, bad email.
      store.recordEvent({
        endpoint: 'signup', outcome: 'rejected', status: err.status || 400,
        code: err.code || null, visitor: store.visitorHash(req.ip),
      });
      next(err);
    }
  });

  router.get('/v1/account', (req, res, next) => {
    try {
      const account = requireAccount(req);
      res.json(billing.accountSummary(account.id));
    } catch (err) {
      next(err);
    }
  });

  // Change the account email. Exists because the checkout error tells people
  // to do exactly this, and for a while nothing let them.
  router.patch('/v1/account', async (req, res, next) => {
    try {
      const account = requireAccount(req);
      const email = req.body?.email;
      const bad = await checkEmail(email);
      if (bad) throw bad;
      const updated = store.updateEmail(account.id, email);
      if (!updated) {
        return res.status(404).json({
          error: { code: 'account_not_found', message: 'No such account.' },
        });
      }
      res.json({
        id: updated.id,
        email: updated.email,
        // Said plainly, because it is the kind of thing a customer discovers
        // by not receiving an invoice.
        note: account.polar_customer_id
          ? 'Updated here. Receipts and invoices come from Polar, so change the billing email in their customer portal too.'
          : undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/v1/keys', (req, res, next) => {
    try {
      const account = requireAccount(req);
      const key = store.createKey(account.id, { name: req.body?.name || 'default' });
      res.status(201).json({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        api_key: key.key,
        warning: 'Save this key now. It is stored hashed and cannot be shown again.',
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/v1/keys/:id', (req, res, next) => {
    try {
      const account = requireAccount(req);
      const revoked = store.revokeKey(account.id, req.params.id);
      if (!revoked) {
        return res.status(404).json({
          error: { code: 'key_not_found', message: 'No such active key on this account.' },
        });
      }
      res.json({ revoked: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  // Start an upgrade. Returns a Polar checkout URL to send the customer to.
  router.post('/v1/checkout', async (req, res, next) => {
    try {
      const account = requireAccount(req);
      const plan = String(req.body?.plan || '');
      if (!store.isPlan(plan) || plan === 'free') {
        return res.status(400).json({
          error: {
            code: 'invalid_plan',
            message: `Choose one of: ${Object.keys(store.PLANS).filter((p) => p !== 'free').join(', ')}.`,
          },
        });
      }
      const checkout = await polar.createCheckout({ account, plan });
      res.json(checkout);
    } catch (err) {
      next(err);
    }
  });

  // Polar calls this. Raw body, because the signature covers the exact bytes.
  router.post(
    '/v1/webhooks/polar',
    express.raw({ type: '*/*', limit: '1mb' }),
    (req, res) => {
      try {
        const event = polar.verifyWebhook(req.body, req.headers);
        const outcome = polar.applyEvent(event);
        // The paid end of the funnel: subscriptions, renewals, cancellations.
        if (!outcome.duplicate) {
          store.recordEvent({
            endpoint: 'billing', outcome: String(event.type).slice(0, 40), status: 200,
            account_id: outcome.account_id,
            // A problem outranks what was applied: tools/report.js lists every
            // not_applied:* event at the top, because each may be a customer
            // who paid and was not upgraded.
            code: outcome.problem ? `not_applied:${outcome.problem}`
              : outcome.applied ? String(outcome.applied).slice(0, 60) : null,
          });
        }
        // 200 on a duplicate too. Polar retries anything else, and a retry
        // storm over an event we already applied helps nobody.
        res.json({ ok: true, ...outcome });
      } catch (err) {
        console.error('[polar] webhook rejected:', err.message);
        res.status(err.status || 400).json({
          error: { code: err.code || 'webhook_rejected', message: err.message },
        });
      }
    },
  );

  return router;
}

export default accountsRouter;
