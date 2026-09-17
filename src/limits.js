/**
 * Abuse limits for the traffic nobody pays for.
 *
 * "No card, no signup" is the distribution strategy, and it is also an
 * invitation to burn compute. The hosted box renders one page at a time, so
 * the thing free traffic spends is not dollars - the server is a fixed price -
 * it is slot time a paying customer was about to need. Every limit here is
 * about that, and every one of them applies only to free-plan keys and the
 * /demo. A self-hosted deployment has no free plan and never reaches this file.
 *
 * Three layers, because each one alone is defeated by something cheap:
 *
 *   1. Signups per IP. Without it one script mints unlimited free keys at 500
 *      renders each, which is the real hole - far bigger than /demo.
 *   2. Renders per target domain. Stops the free tier being used to hammer
 *      one third-party site, which is how our IP ends up on the bot-wall
 *      lists that then degrade captures for paying customers.
 *   3. A global budget of slot-seconds per rolling hour, shared by ALL free
 *      and demo traffic. Per-IP limits fall to anyone with a proxy list; this
 *      one does not, because it does not care who is asking. It is measured in
 *      seconds, not renders, because a render is not a unit of cost here: one
 *      that runs to the 60s timeout costs ten ordinary ones.
 *
 * Everything is in-process and resets on restart. That is acceptable: a
 * restart forgives at most one window, and the store stays the one piece of
 * state that has to survive a deploy.
 */
import config from './config.js';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const share = (v, d) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export const LIMITS = {
  signupsPerIpPerDay: int(process.env.SIGNUPS_PER_IP_PER_DAY, 3),
  // Not 10: the landing-page demo is pre-filled with example.com, which
  // renders in ~1.5s, so a launch-day crowd pressing Try it shares ONE bucket.
  freeRendersPerDomainPerMinute: int(process.env.FREE_DOMAIN_LIMIT_PER_MINUTE, 30),
  // Share of total pool time free and demo traffic may use, per rolling hour.
  // 0.75 on a one-slot box is 45 minutes of rendering an hour. Deliberately
  // not tighter: the box is a fixed price, so free traffic costs capacity,
  // not money, and the paid-first queue in browser-pool.js is what protects
  // paying customers minute to minute. This is the backstop against a
  // sustained flood, and the lever to pull - FREE_SLOT_SHARE=0.3 in app.env
  // and a restart - if free traffic ever needs throttling hard. 0 turns free
  // rendering off entirely.
  // Parsed by hand: Number('') is 0, so an empty FREE_SLOT_SHARE= line in an
  // env file would otherwise switch the free tier off without a word.
  freeSlotShare: share(process.env.FREE_SLOT_SHARE, 0.75),
  // Share of THAT budget any one free caller (a free key, or one IP on the
  // demo) may use per rolling hour. Without it one key sending pages that run
  // to the timeout - unbilled, and they never touch the quota - could spend
  // the whole free tier's hour and lock every other free user out.
  freeCallerShare: share(process.env.FREE_CALLER_SHARE, 0.2),
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A sliding-window counter per key. Entries are timestamps or [ts, weight]. */
class Window {
  constructor(ms, maxKeys = 50_000) {
    this.ms = ms;
    this.maxKeys = maxKeys;
    this.map = new Map();
  }

  entries(key, now = Date.now()) {
    const live = (this.map.get(key) || []).filter(([t]) => t > now - this.ms);
    if (live.length) this.map.set(key, live);
    else this.map.delete(key);
    return live;
  }

  total(key, now) {
    return this.entries(key, now).reduce((sum, [, w]) => sum + w, 0);
  }

  add(key, weight = 1, now = Date.now()) {
    // A flood of distinct keys must not grow memory without bound. Clearing
    // forgives everyone at once, which errs towards letting traffic through.
    if (!this.map.has(key) && this.map.size >= this.maxKeys) this.map.clear();
    const live = this.entries(key, now);
    live.push([now, weight]);
    this.map.set(key, live);
  }
}

const signups = new Window(DAY);
const domains = new Window(60_000);
const slotTime = new Window(HOUR, 1);
const callerTime = new Window(HOUR);

function limited(message, code, status = 429) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * The registrable-ish domain a render targets. Deliberately crude - the last
 * two labels, with a leading www. dropped - because the cost of getting
 * example.co.uk wrong is that all of .co.uk shares one bucket for free-tier
 * traffic, which is a limit that errs strict on an abuse control.
 */
export function targetDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  return host.replace(/^www\./, '').split('.').slice(-2).join('.');
}

/** Throws a 429 if this IP has already created its allowance of accounts. */
export function checkSignup(ip, now = Date.now()) {
  if (signups.entries(ip || 'unknown', now).length >= LIMITS.signupsPerIpPerDay) {
    throw limited(
      `This network has created ${LIMITS.signupsPerIpPerDay} accounts in the last 24 hours. One account can hold several keys - POST /v1/keys - so you should not need another.`,
      'signup_rate_limited',
    );
  }
}

export function recordSignup(ip, now = Date.now()) {
  signups.add(ip || 'unknown', 1, now);
}

/** Budget in milliseconds of slot time per rolling hour, for all free traffic. */
export function freeBudgetMs(poolSize = config.poolSize) {
  return LIMITS.freeSlotShare * poolSize * HOUR;
}

/**
 * Throws before a free or demo render if either shared limit is spent.
 * Called after the cache check: a cache hit costs no browser and is never
 * refused here.
 */
export function checkFreeRender(url, { poolSize = config.poolSize, now = Date.now(), caller = '' } = {}) {
  if (slotTime.total('free', now) >= freeBudgetMs(poolSize)) {
    throw limited(
      'Free-tier capacity for this hour is used up. It frees continuously - retry in a few minutes. Paid plans are not affected by this limit.',
      'free_capacity_exhausted',
      503,
    );
  }
  if (caller && callerTime.total(caller, now) >= LIMITS.freeCallerShare * freeBudgetMs(poolSize)) {
    throw limited(
      'You have used your share of free-tier rendering time for the last hour - usually a sign of pages that run to the timeout. It frees continuously. Paid plans have no such limit.',
      'free_caller_limited',
    );
  }
  const domain = targetDomain(url);
  if (domain && domains.entries(domain, now).length >= LIMITS.freeRendersPerDomainPerMinute) {
    throw limited(
      `Free-tier renders of ${domain} are limited to ${LIMITS.freeRendersPerDomainPerMinute} a minute across all free users. Paid plans are not affected.`,
      'domain_rate_limited',
    );
  }
  if (domain) domains.add(domain, 1, now);
}

/** Charge a finished free render - success or failure - to the shared budget. */
export function chargeFreeRender(ms, now = Date.now(), caller = '') {
  if (!(ms > 0)) return;
  slotTime.add('free', ms, now);
  if (caller) callerTime.add(caller, ms, now);
}

/** For /metrics and the tests. */
export function snapshot(now = Date.now()) {
  return {
    free_slot_ms_last_hour: slotTime.total('free', now),
    free_slot_budget_ms: freeBudgetMs(),
  };
}

/** Tests only. */
export function _reset() {
  signups.map.clear();
  domains.map.clear();
  slotTime.map.clear();
  callerTime.map.clear();
}
