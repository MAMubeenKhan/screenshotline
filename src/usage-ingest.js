/**
 * Usage ingestion into Polar's meters, for billing overage.
 *
 * INERT UNTIL CONFIGURED. Without POLAR_USAGE_METER set, every function here
 * is a no-op, so this cannot affect a deployment that has not opted in - and
 * in particular cannot affect a self-hoster, who has billing off entirely.
 *
 * ONLY THE EXCESS IS INGESTED, and that is the central design decision.
 *
 * The obvious approach is to ingest every render and let Polar subtract the
 * included allowance. That needs Polar's meter and our PLANS table to agree
 * about what "included" means, in two places, forever - and they would drift
 * the first time a plan changed. Instead the gateway, which already knows the
 * allowance because it enforces it, ingests a unit only for renders BEYOND it.
 * Polar then needs to know one thing: a flat price per excess unit. Nothing to
 * keep in sync.
 *
 * Batched, because the alternative is a third-party network round trip on the
 * hot path of the thing customers are paying for. The rule from billing.meter
 * applies here too and harder: losing a count is a revenue bug, losing the
 * customer's image is a product bug, and the second is worse. Nothing in this
 * file may throw into a request, and nothing may make one wait.
 */
import config from './config.js';

const API = {
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
};

/** Buffered events awaiting a flush. */
let queue = [];
let timer = null;
let flushing = false;
const stats = { queued: 0, sent: 0, dropped: 0, failures: 0 };

export const isEnabled = () =>
  Boolean(config.billingEnabled && config.polar.usageMeter && config.polar.accessToken);

/**
 * Record one billable excess render.
 *
 * Called from billing.meter() only when the render is over the plan's included
 * allowance. Never awaited by the caller.
 */
export function ingest(accountId, { units = 1 } = {}) {
  if (!isEnabled() || !accountId) return;

  // A bounded buffer. If Polar is unreachable for long enough that this fills,
  // we drop the oldest rather than grow until the process dies. Under-billing
  // is survivable; an OOM during a traffic spike is not.
  if (queue.length >= config.polar.usageQueueMax) {
    queue.shift();
    stats.dropped += 1;
  }

  queue.push({
    name: config.polar.usageMeter,
    // Our own account id, not Polar's customer id. Ingestion therefore never
    // waits on polar_customer_id being linked by a webhook, and never breaks
    // if that link is missing or arrives late.
    external_customer_id: accountId,
    metadata: { units },
  });
  stats.queued += 1;

  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, config.polar.usageFlushMs);
    // Never hold the process open for a flush that can be redone later.
    if (typeof timer.unref === 'function') timer.unref();
  }
}

/**
 * Send whatever is buffered.
 *
 * Resolves on failure as well as success - callers have nothing useful to do
 * with an ingestion error, and an unhandled rejection here must not reach the
 * process-level handlers that exist to keep the server alive.
 */
export async function flush({ fetchImpl = fetch } = {}) {
  if (!isEnabled() || flushing || queue.length === 0) return { sent: 0 };

  flushing = true;
  const batch = queue.splice(0, config.polar.usageBatchMax);
  try {
    const base = API[config.polar.server] || API.sandbox;
    const res = await fetchImpl(`${base}/v1/events/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.polar.accessToken}`,
        'Content-Type': 'application/json',
        // Pinned - see config.polar.apiVersion. Overage is revenue; its
        // request shape must not change on Polar's release calendar.
        'Polar-Version': config.polar.apiVersion,
      },
      body: JSON.stringify({ events: batch }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      stats.failures += 1;
      // 4xx means this batch is malformed or unauthorised and will fail again
      // forever - keeping it would block every later batch behind it. 5xx and
      // network errors are worth retrying, so those go back on the queue.
      if (res.status >= 400 && res.status < 500) {
        stats.dropped += batch.length;
        console.error(
          `[usage] Polar refused ${batch.length} events with ${res.status}, dropping them:`,
          body.slice(0, 300),
        );
      } else {
        queue.unshift(...batch);
        console.error(`[usage] Polar ingest failed with ${res.status}, will retry`);
      }
      return { sent: 0, failed: batch.length };
    }

    stats.sent += batch.length;
    return { sent: batch.length };
  } catch (err) {
    stats.failures += 1;
    queue.unshift(...batch);
    console.error('[usage] Polar ingest error, will retry:', err.message);
    return { sent: 0, failed: batch.length };
  } finally {
    flushing = false;
    // More arrived (or came back) while we were away.
    if (queue.length > 0 && !timer) {
      timer = setTimeout(() => {
        timer = null;
        flush().catch(() => {});
      }, config.polar.usageFlushMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
  }
}

/** Flush what is buffered on shutdown. Best effort, bounded. */
export async function drain({ timeoutMs = 3000 } = {}) {
  if (!isEnabled() || queue.length === 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await Promise.race([
    (async () => {
      while (queue.length > 0) {
        const before = queue.length;
        await flush();
        if (queue.length >= before) break; // making no progress
      }
    })(),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

export const snapshot = () => ({ ...stats, pending: queue.length, enabled: isEnabled() });

/** Test seam. */
export function reset() {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
  flushing = false;
  Object.assign(stats, { queued: 0, sent: 0, dropped: 0, failures: 0 });
}

export default { ingest, flush, drain, snapshot, isEnabled, reset };
