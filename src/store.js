/**
 * Accounts, API keys and usage metering.
 *
 * Backed by SQLite through node:sqlite, so there is still nothing to install
 * and nothing to run alongside the process. That matters more than usual here:
 * the self-hosting guide is a Phase 4 SEO asset, and "now stand up Postgres"
 * is where a self-hoster closes the tab.
 *
 * Every SQLite detail is confined to this file. If node:sqlite's experimental
 * API moves, or this outgrows one box and needs Postgres, that is one file to
 * rewrite and no callers to touch.
 *
 * Two things are deliberate and worth not undoing:
 *
 *  - Keys are stored as SHA-256 hashes, never in plaintext. The full key is
 *    returned exactly once, at creation. A leaked database should not be a
 *    leaked set of customer keys, and we cannot email someone their key back
 *    if we never had it.
 *  - Usage is counted in one UPSERT per render, inside SQLite, rather than in
 *    a process-local counter. Two workers behind a load balancer would
 *    otherwise each count half the traffic and bill accordingly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';

/**
 * The plans, and the whole of the pricing model.
 *
 * `included` is renders per billing month. `overagePer1k` is what a render
 * beyond that costs, in USD cents per thousand.
 *
 * These prices survive the payment processor's cut with room to spare. Polar
 * takes single-digit percent and a fixed fee per transaction; a render costs
 * about $0.01-0.02 per thousand to serve (measured on the production box: a
 * mean of 9.4 slot-seconds per render, one render at a time, at 100% and 50%
 * utilisation respectively), so the processor's fee costs more per render
 * than the browser does, and gross margin is high on every tier. The full
 * working is in the internal notes rather than here.
 *
 * One consequence is worth stating in the code, because it constrains what
 * can be added to this table: the processor's fee is partly FIXED per
 * transaction, so it is regressive. It costs 2.9% of the Starter price and
 * 0.2% of Scale. A cheaper tier than Starter would hand over a far worse
 * share than anything here - which is the argument against adding one, and a
 * better argument than any guess about who such a plan would attract.
 * * Overage is priced BELOW the plan's own effective rate, which is the opposite
 * of the usual punitive overage. The reasoning is in the plan: the wedge is
 * correct output, not price, so a customer who has a spiky month should not
 * discover that spikiness is expensive. Upgrading is still cheaper again,
 * because the next plan's included rate undercuts the previous plan's overage.
 */
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceCents: 0,
    included: 500,
    // No overage on free. It is a distribution channel, and an unexpected
    // invoice for someone who never entered a card is a support incident and
    // a bad launch-week story.
    overagePer1k: null,
    requiresCard: false,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceCents: 1700,
    included: 2_000,
    // Plan rate is $8.50/1k.
    overagePer1k: 790,
    requiresCard: true,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceCents: 7900,
    included: 10_000,
    // Plan rate is $7.90/1k.
    overagePer1k: 600,
    requiresCard: true,
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    priceCents: 25_900,
    included: 50_000,
    // Plan rate is $5.18/1k.
    overagePer1k: 450,
    requiresCard: true,
  },
};

export const isPlan = (id) => Object.hasOwn(PLANS, id);

/**
 * How many captures flagged blank may be delivered UNBILLED per period.
 *
 * Not billing a blank capture is a promise worth keeping - but a heuristic
 * cannot be made robust against a caller who controls the page and the
 * parameters. inject_js can make any DOM read as empty, a wrapper page can
 * hold the real site in an iframe, and the pixel signal depends on encoding.
 * Unlimited, "blank" was a way to render free forever. So the promise has a
 * size: 10% of the plan, at least 50. An honest customer is nowhere near it;
 * a customer with that many bot walls has a problem we should hear about.
 * Errors and timeouts deliver no image and stay unbilled without limit.
 */
export function blankAllowance(plan) {
  return Math.max(50, Math.round(plan.included * 0.1));
}

/** The billing period a moment falls in. UTC, so it does not drift by host. */
export function periodOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Add n calendar months to an instant, clamping the day to the target month.
 *
 * Subscriptions renew on their anniversary, so a subscription started on the
 * 31st renews on the 28th in February - not the 3rd of March, which is what
 * naive setUTCMonth arithmetic produces and what would silently hand that
 * customer two overlapping periods every February.
 */
function addMonthsUTC(date, n) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    y, m + n, Math.min(day, lastOfTarget),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
  ));
}

/**
 * The usage period key for one account.
 *
 * Free accounts bill on calendar months, so their key is YYYY-MM. Paid
 * accounts renew on their subscription anniversary, so theirs is the start
 * of the current subscription period, YYYY-MM-DD.
 *
 * This exists because the two disagree. Subscribe on the 15th with 2,000
 * included: a calendar-month counter resets on the 1st, so the customer gets
 * 2,000 renders between the 15th and the 31st and another 2,000 between the
 * 1st and the 14th - 4,000 inside a single billing period Polar invoices as
 * one. Every one of those extra renders is unbilled overage.
 *
 * The window is rolled forward locally rather than read from a stored end
 * date, so a subscription.cycled webhook that never arrives cannot freeze the
 * period and hand someone an unlimited month. When cycled does arrive it
 * re-anchors period_start to Polar's own value, which corrects any drift.
 */
export function periodForAccount(account, date = new Date()) {
  const raw = account?.period_start;
  if (!raw) return periodOf(date);
  const anchor = new Date(raw);
  if (Number.isNaN(anchor.getTime())) return periodOf(date);
  // Before the anchor means the clock is behind Polar; the first period is
  // still the right answer.
  if (date < anchor) return anchor.toISOString().slice(0, 10);
  let months = 0;
  // 600 is a stop, not a limit - fifty years of missed webhooks.
  while (months < 600 && date >= addMonthsUTC(anchor, months + 1)) months += 1;
  return addMonthsUTC(anchor, months).toISOString().slice(0, 10);
}
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id                   TEXT PRIMARY KEY,
    email                TEXT NOT NULL UNIQUE,
    plan                 TEXT NOT NULL DEFAULT 'free',
    status               TEXT NOT NULL DEFAULT 'active',
    polar_customer_id    TEXT,
    polar_subscription_id TEXT,
    -- Start of the current SUBSCRIPTION period, from Polar. Null on free
    -- accounts, which use calendar months. See periodForAccount.
    period_start         TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'default',
    key_hash    TEXT NOT NULL UNIQUE,
    prefix      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(account_id);

  -- One row per account per billing period. The period key is a calendar
  -- month (YYYY-MM) for free accounts and a subscription period start
  -- (YYYY-MM-DD) for paid ones. Counted, not derived from a log,
  -- so the quota check is a single indexed read on the hot path.
  CREATE TABLE IF NOT EXISTS usage (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period     TEXT NOT NULL,
    renders    INTEGER NOT NULL DEFAULT 0,
    cached     INTEGER NOT NULL DEFAULT 0,
    failed     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, period)
  );

  -- One row per request, for the operator's own analytics: who did what,
  -- through which door, with what result. Deliberately NO full URL -
  -- customers capture private pages - only the target's domain. Demo
  -- visitors are a salted hash that rotates daily, never an IP. Pruned to
  -- 90 days. The terms page says exactly this; keep them in step.
  CREATE TABLE IF NOT EXISTS events (
    ts         TEXT NOT NULL,
    account_id TEXT,
    visitor    TEXT,
    endpoint   TEXT NOT NULL,
    via        TEXT,
    outcome    TEXT,
    status     INTEGER,
    code       TEXT,
    ms         INTEGER,
    domain     TEXT
  );
  CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS events_account ON events(account_id, ts);

  -- Small server-side settings, such as the visitor-hash salt.
  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  -- Webhook deliveries we have already applied. Polar retries, and a retried
  -- subscription event must not be applied twice.
  CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
`;

let db = null;

export function open(file = config.dbFile) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // WAL lets reads proceed while a write is in flight. Without it, a render
  // finishing its usage write blocks every quota check behind it.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists,
  // so a new column needs an explicit ALTER. Production has a live database;
  // this is the only path that reaches it.
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  if (!columns.includes('period_start')) {
    db.exec('ALTER TABLE accounts ADD COLUMN period_start TEXT');
  }
  return db;
}

/** Test seam: drop the handle so a suite can point at a fresh file. */
export function close() {
  if (db) db.close();
  db = null;
}

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;

export const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// --- Accounts ---------------------------------------------------------------

export function createAccount(email, { plan = 'free' } = {}) {
  const normalised = String(email).trim().toLowerCase();
  if (!normalised || !normalised.includes('@')) {
    throw Object.assign(new Error('A valid email address is required.'), {
      code: 'invalid_email',
      status: 400,
    });
  }
  if (!isPlan(plan)) {
    throw Object.assign(new Error(`Unknown plan "${plan}".`), {
      code: 'invalid_plan',
      status: 400,
    });
  }
  const account = {
    id: id('acct'),
    email: normalised,
    plan,
    status: 'active',
    created_at: now(),
    updated_at: now(),
  };
  try {
    open()
      .prepare(
        `INSERT INTO accounts (id, email, plan, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(account.id, account.email, account.plan, account.status, account.created_at, account.updated_at);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw Object.assign(new Error('An account with that email already exists.'), {
        code: 'email_taken',
        status: 409,
      });
    }
    throw err;
  }
  return account;
}

export const getAccount = (accountId) =>
  open().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) || null;

export const getAccountByEmail = (email) =>
  open()
    .prepare('SELECT * FROM accounts WHERE email = ?')
    .get(String(email).trim().toLowerCase()) || null;

export const getAccountByPolarCustomer = (polarCustomerId) =>
  open().prepare('SELECT * FROM accounts WHERE polar_customer_id = ?').get(polarCustomerId) || null;

/**
 * Change the account email.
 *
 * Separate from updateAccount because email is the one field with a unique
 * constraint, and because a collision here needs a 409 rather than a 500.
 * Deliberately does NOT touch the Polar customer: Polar is the merchant of
 * record and owns the billing identity, so a customer changes the address
 * their receipts go to in Polar's own portal. Our copy is for us.
 */
export function updateEmail(accountId, email) {
  const normalised = String(email).trim().toLowerCase();
  try {
    const result = open()
      .prepare('UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?')
      .run(normalised, now(), accountId);
    if (result.changes === 0) return null;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw Object.assign(new Error('Another account already uses that email address.'), {
        code: 'email_taken',
        status: 409,
      });
    }
    throw err;
  }
  return getAccount(accountId);
}

export function updateAccount(accountId, fields) {
  const allowed = ['plan', 'status', 'polar_customer_id', 'polar_subscription_id', 'period_start'];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!entries.length) return getAccount(accountId);
  const sql = `UPDATE accounts SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  open()
    .prepare(sql)
    .run(...entries.map(([, v]) => v), now(), accountId);
  return getAccount(accountId);
}

// --- API keys ---------------------------------------------------------------

/**
 * Issue a key. The plaintext is returned here and never again - it is not
 * stored, only its hash.
 */
export function createKey(accountId, { name = 'default', live = true } = {}) {
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = `sl_${live ? 'live' : 'test'}_${secret}`;
  const row = {
    id: id('key'),
    account_id: accountId,
    name: String(name).slice(0, 60),
    key_hash: hashKey(key),
    // Enough to tell two keys apart in a dashboard, not enough to use.
    prefix: key.slice(0, 15),
    created_at: now(),
  };
  open()
    .prepare(
      `INSERT INTO api_keys (id, account_id, name, key_hash, prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.account_id, row.name, row.key_hash, row.prefix, row.created_at);
  return { ...row, key };
}

export const listKeys = (accountId) =>
  open()
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at, revoked_at
       FROM api_keys WHERE account_id = ? ORDER BY created_at`,
    )
    .all(accountId);

export function revokeKey(accountId, keyId) {
  const result = open()
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL')
    .run(now(), keyId, accountId);
  return result.changes > 0;
}

/**
 * Resolve a presented key to its account.
 *
 * Looked up by hash, so this is an index probe rather than a scan, and a
 * timing-safe comparison is unnecessary: the attacker never sees a comparison,
 * only a hash lookup that either hits or does not.
 */
export function resolveKey(key) {
  if (!key) return null;
  const row = open()
    .prepare(
      `SELECT k.id AS key_id, k.revoked_at, a.*
       FROM api_keys k JOIN accounts a ON a.id = k.account_id
       WHERE k.key_hash = ?`,
    )
    .get(hashKey(key));
  if (!row || row.revoked_at) return null;
  return row;
}

/**
 * Stamp last-used, at most once a minute per key.
 *
 * A write on every request would serialise the hot path behind the WAL for a
 * column nobody reads in real time.
 */
const lastUsedStamped = new Map();
export function touchKey(keyId) {
  const at = Date.now();
  if (at - (lastUsedStamped.get(keyId) || 0) < 60_000) return;
  lastUsedStamped.set(keyId, at);
  if (lastUsedStamped.size > 10_000) lastUsedStamped.clear();
  open().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now(), keyId);
}

// --- Usage ------------------------------------------------------------------

export function getUsage(accountId, period) {
  if (period === undefined) period = periodForAccount(getAccount(accountId));
  const row = open()
    .prepare('SELECT * FROM usage WHERE account_id = ? AND period = ?')
    .get(accountId, period);
  return row || { account_id: accountId, period, renders: 0, cached: 0, failed: 0 };
}

/**
 * Count one request. `kind` is 'render', 'cached' or 'failed'.
 *
 * Cache hits and failures are counted separately and never billed: a customer
 * should not pay twice for the same image, nor at all for one we could not
 * produce. That is a policy this codebase can actually honour, because blank
 * detection means we know the difference between a capture and a blank frame.
 */
export function recordUsage(accountId, kind = 'render', period) {
  if (period === undefined) period = periodForAccount(getAccount(accountId));
  const column = { render: 'renders', cached: 'cached', failed: 'failed' }[kind];
  if (!column) throw new Error(`Unknown usage kind "${kind}".`);
  open()
    .prepare(
      `INSERT INTO usage (account_id, period, ${column})
       VALUES (?, ?, 1)
       ON CONFLICT(account_id, period)
       DO UPDATE SET ${column} = ${column} + 1`,
    )
    .run(accountId, period);
}

/**
 * Is this account allowed one more render?
 *
 * Returns { allowed, reason, usage, plan, remaining }. A paid plan with
 * overage enabled is never hard-stopped; a free account is, because there is
 * no card to charge and silently accruing a debt someone never agreed to is
 * worse than a 402.
 */
export function checkQuota(account, period = periodForAccount(account)) {
  const plan = PLANS[account.plan] || PLANS.free;
  const usage = getUsage(account.id, period);
  const used = usage.renders;
  const remaining = Math.max(0, plan.included - used);

  if (account.status !== 'active') {
    return {
      allowed: false,
      reason: 'account_inactive',
      message: `This account is ${account.status}. Update the payment method to resume.`,
      plan,
      usage,
      remaining,
    };
  }
  if (used < plan.included) {
    return { allowed: true, plan, usage, remaining, overage: 0 };
  }
  if (plan.overagePer1k === null) {
    return {
      allowed: false,
      reason: 'quota_exceeded',
      message: `The ${plan.name} plan includes ${plan.included} renders per month and this account has used ${used}. Upgrade to continue.`,
      plan,
      usage,
      remaining: 0,
    };
  }
  return { allowed: true, plan, usage, remaining: 0, overage: used - plan.included + 1 };
}

// --- Analytics events ---------------------------------------------------------

export const EVENT_RETENTION_DAYS = 90;

/** The visitor-hash salt: random, created once, kept in the database. */
function salt() {
  const db = open();
  const row = db.prepare("SELECT v FROM meta WHERE k = 'visitor_salt'").get();
  if (row) return row.v;
  const v = crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('visitor_salt', ?)").run(v);
  return db.prepare("SELECT v FROM meta WHERE k = 'visitor_salt'").get().v;
}

/**
 * A daily-rotating pseudonym for an unauthenticated visitor. Counts unique
 * demo users per day without storing an IP: the salt never leaves the
 * database and the day is part of the input, so two days cannot be linked.
 */
export function visitorHash(ip, date = new Date()) {
  if (!ip) return null;
  try {
    const day = date.toISOString().slice(0, 10);
    return crypto.createHash('sha256').update(`${salt()}|${day}|${ip}`).digest('hex').slice(0, 16);
  } catch {
    // Called on the demo's request path. A database hiccup must cost a
    // unique-visitor count, never the capture.
    return null;
  }
}

/**
 * Append one analytics event. Never throws: analytics is the last thing
 * allowed to break a request. A no-op when billing is off, so a self-hosted
 * deployment never grows a database it did not ask for.
 */
export function recordEvent(ev) {
  if (!config.billingEnabled) return;
  try {
    open()
      .prepare(
        `INSERT INTO events (ts, account_id, visitor, endpoint, via, outcome, status, code, ms, domain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ev.ts || now(),
        ev.account_id ?? null,
        ev.visitor ?? null,
        ev.endpoint,
        ev.via ?? null,
        ev.outcome ?? null,
        ev.status ?? null,
        ev.code ?? null,
        Number.isFinite(ev.ms) ? Math.round(ev.ms) : null,
        ev.domain ?? null,
      );
  } catch (err) {
    console.error('[events] not recorded:', err.message);
  }
}

/** Drop events past the retention window. Returns the number removed. */
export function purgeEvents(days = EVENT_RETENTION_DAYS, at = Date.now()) {
  const cutoff = new Date(at - days * 86_400_000).toISOString();
  return open().prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes;
}

export default {
  open,
  close,
  recordEvent,
  purgeEvents,
  visitorHash,
  PLANS,
  periodOf,
  periodForAccount,
  createAccount,
  getAccount,
  getAccountByEmail,
  getAccountByPolarCustomer,
  updateAccount,
  updateEmail,
  createKey,
  listKeys,
  revokeKey,
  resolveKey,
  touchKey,
  getUsage,
  recordUsage,
  checkQuota,
};
