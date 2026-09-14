import puppeteer from 'puppeteer';
import config from './config.js';

/**
 * A fixed pool of browsers, one render at a time each.
 *
 * The three production failure modes this exists to prevent:
 *
 *  1. Memory growth. Chrome does not release memory cleanly across
 *     navigations. Every browser carries a render counter and is retired at
 *     maxRendersPerBrowser rather than being allowed to grow until the OOM
 *     killer takes it (and every in-flight render with it).
 *
 *  2. Zombie processes. When Chrome crashes mid-render its children can be
 *     orphaned. Inside a container the fix is an init process that reaps them
 *     - see the Dockerfile, which uses `tini` as PID 1. Here we additionally
 *     hard-kill the process rather than relying on a graceful close that may
 *     itself hang.
 *
 *  3. Slot exhaustion. A page with a resource that never finishes loading will
 *     hold a slot forever. Every acquisition is time-bounded and every render
 *     is killed on a wall-clock timeout by the caller.
 */

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // Docker gives /dev/shm only 64MB by default and Chrome falls over on
  // image-heavy pages. Either this flag or --shm-size=1g; the flag travels
  // better across hosts.
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  // HttpsUpgrades silently rewrites http:// to https:// and then stalls on
  // hosts that genuinely have no TLS listener. Customers archiving legacy or
  // internal sites hit this immediately and it presents as an unexplained
  // timeout, not as a protocol error.
  '--disable-features=IsolateOrigins,site-per-process,TranslateUI,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
  '--font-render-hinting=none',
];

class Slot {
  constructor(id) {
    this.id = id;
    this.browser = null;
    this.renders = 0;
    this.bornAt = 0;
    this.busy = false;
    this.starting = null;
  }

  get needsRecycle() {
    if (!this.browser) return true;
    if (!this.browser.connected) return true;
    if (this.renders >= config.maxRendersPerBrowser) return true;
    if (Date.now() - this.bornAt > config.maxBrowserAgeMs) return true;
    return false;
  }
}

export class BrowserPool {
  constructor(size = config.poolSize) {
    this.slots = Array.from({ length: size }, (_, i) => new Slot(i));
    this.waiters = [];
    this.closing = false;
    this.stats = { launched: 0, recycled: 0, killed: 0, renders: 0, launchFailures: 0 };
  }

  /**
   * Launch with retries.
   *
   * Launching is not reliable under load. On a saturated host Chrome can fail
   * to report its WebSocket endpoint inside the timeout, and Puppeteer's own
   * cleanup of the temp profile then races the dying process - on Windows that
   * surfaces as EBUSY unlinking first_party_sets.db. Observed for real during a
   * 202-page sweep, where it killed the entire server.
   *
   * A failed launch must degrade to "this slot is unavailable for a moment",
   * never to a process exit.
   */
  async launch(slot, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        slot.browser = await puppeteer.launch({
          headless: true,
          args: LAUNCH_ARGS,
          executablePath: config.executablePath,
          protocolTimeout: config.maxRenderTimeoutMs + 15_000,
        });
        slot.renders = 0;
        slot.bornAt = Date.now();
        this.stats.launched += 1;
        return slot.browser;
      } catch (err) {
        lastError = err;
        this.stats.launchFailures += 1;
        console.error(
          `[pool] launch failed for slot ${slot.id} (attempt ${attempt}/${attempts}): ${err.message}`,
        );
        // Back off: a launch storm usually means the host is momentarily out
        // of CPU, and retrying instantly makes that worse.
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    const err = new Error(
      `Could not start a browser after ${attempts} attempts: ${lastError?.message}`,
    );
    err.code = 'browser_launch_failed';
    err.status = 503;
    throw err;
  }

  /** Tear a browser down hard. Never awaits a graceful close for long. */
  async destroy(slot, { kill = false } = {}) {
    const browser = slot.browser;
    slot.browser = null;
    slot.renders = 0;
    if (!browser) return;

    const proc = browser.process();
    if (kill) {
      this.stats.killed += 1;
      // SIGKILL the process group. A polite close waits on whatever hung.
      try {
        proc?.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      return;
    }

    this.stats.recycled += 1;
    try {
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      /* fall through to the kill below */
    }
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  async acquire({ low = false } = {}) {
    if (this.closing) throw new Error('Pool is shutting down');

    const slot = await this.takeSlot({ low });
    try {
      if (slot.needsRecycle) {
        if (slot.browser) await this.destroy(slot);
        await this.launch(slot);
      }
      slot.renders += 1;
      this.stats.renders += 1;
      return slot;
    } catch (err) {
      this.release(slot);
      throw err;
    }
  }

  /**
   * `low` marks free-tier and demo traffic. Two rules, both so that launch-day
   * attention on the free tier cannot become a paying customer's 503:
   *   - a paid waiter is queued ahead of every low one, and
   *   - low traffic may hold only ONE place in the queue. A second is refused
   *     at once rather than left to sit in front of the acquire timeout.
   * On a one-slot box the queue is the whole of our spare capacity.
   */
  takeSlot({ low = false } = {}) {
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }

    if (low && this.waiters.some((w) => w.low)) {
      const err = new Error('The free tier is at capacity this moment. Retry in a few seconds - paid plans queue ahead of free traffic.');
      err.code = 'free_capacity_busy';
      err.status = 503;
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null, low };
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i !== -1) this.waiters.splice(i, 1);
        const err = new Error('All renderers are busy. Retry shortly.');
        err.code = 'pool_exhausted';
        err.status = 503;
        reject(err);
      }, config.acquireTimeoutMs);
      const firstLow = low ? -1 : this.waiters.findIndex((w) => w.low);
      if (firstLow === -1) this.waiters.push(waiter);
      else this.waiters.splice(firstLow, 0, waiter);
    });
  }

  release(slot) {
    slot.busy = false;
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      slot.busy = true;
      waiter.resolve(slot);
    }
  }

  /** Called when a render times out or the browser is suspect. */
  async discard(slot) {
    await this.destroy(slot, { kill: true });
    this.release(slot);
  }

  async warm() {
    // Chromium cold start is 3-5 seconds. Pay it at boot, never on a request.
    await Promise.allSettled(
      this.slots.map(async (slot) => {
        if (!slot.browser) await this.launch(slot);
      }),
    );
  }

  async close() {
    this.closing = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Server shutting down'));
    }
    await Promise.all(this.slots.map((slot) => this.destroy(slot, { kill: true })));
  }

  snapshot() {
    return {
      size: this.slots.length,
      busy: this.slots.filter((s) => s.busy).length,
      queued: this.waiters.length,
      ...this.stats,
    };
  }
}

export default BrowserPool;
