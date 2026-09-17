/**
 * Sustained load test.
 *
 *   node test/load.js --duration 600 --concurrency 4
 *
 * Week 3 of the plan calls for this, and it is the only way to know whether
 * the two headline claims in the README are actually true:
 *
 *   1. Browser recycling stops memory growing without bound.
 *   2. Nothing leaks Chrome processes when browsers are killed.
 *
 * A pass looks like a sawtooth in RSS - climbing, then dropping as browsers
 * retire - around a flat baseline, with the Chrome process count returning to
 * roughly pool size after every recycle. A fail looks like a straight line up,
 * or a process count that only ever grows.
 *
 * Targets are deliberately small and fast so the test is bound by our renderer
 * rather than by someone else's CDN.
 */
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

const BASE = flag('base', 'http://127.0.0.1:3000');
const DURATION = Number(flag('duration', '600')) * 1000;
const CONCURRENCY = Number(flag('concurrency', '4'));
const SAMPLE_MS = Number(flag('sample', '10000'));

const TARGETS = [
  'https://example.com/',
  'https://httpbin.org/html',
  'https://danluu.com/',
  'https://news.ycombinator.com/',
  'https://en.wikipedia.org/wiki/Screenshot',
];

const isWin = process.platform === 'win32';

/** Count live Chrome/Chromium processes and their total working set (MB). */
function chromeStats() {
  try {
    if (isWin) {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH & tasklist /FI "IMAGENAME eq chrome-headless-shell.exe" /FO CSV /NH',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'cmd.exe' },
      );
      const rows = out.split('\n').filter((l) => l.includes('.exe'));
      let mem = 0;
      for (const r of rows) {
        const m = r.match(/"([\d,]+) K"\s*$/);
        if (m) mem += Number(m[1].replace(/,/g, '')) / 1024;
      }
      return { count: rows.length, mb: Math.round(mem) };
    }
    const out = execSync('ps -eo rss,comm | grep -i chrom', { encoding: 'utf8' });
    const rows = out.trim().split('\n').filter(Boolean);
    const mb = rows.reduce((s, r) => s + Number(r.trim().split(/\s+/)[0]) / 1024, 0);
    return { count: rows.length, mb: Math.round(mb) };
  } catch {
    return { count: 0, mb: 0 };
  }
}

/** Zombie/defunct processes. Unix only - Windows has no equivalent state. */
function zombieCount() {
  if (isWin) return null;
  try {
    const out = execSync('ps -eo stat,comm | grep -c "^Z"', { encoding: 'utf8' });
    return Number(out.trim());
  } catch {
    return 0;
  }
}

const stats = {
  sent: 0,
  ok: 0,
  failed: 0,
  latencies: [],
  errors: new Map(),
};

let running = true;

async function worker(id) {
  let i = id;
  while (running) {
    const url = TARGETS[i++ % TARGETS.length];
    const started = Date.now();
    stats.sent += 1;
    try {
      const res = await fetch(
        `${BASE}/take?url=${encodeURIComponent(url)}&block_ads=true&timeout=30000`,
      );
      const ms = Date.now() - started;
      if (res.ok) {
        await res.arrayBuffer();
        stats.ok += 1;
        stats.latencies.push(ms);
      } else {
        stats.failed += 1;
        let code = String(res.status);
        try {
          code = (await res.json()).error?.code || code;
        } catch {}
        stats.errors.set(code, (stats.errors.get(code) || 0) + 1);
      }
    } catch (err) {
      stats.failed += 1;
      const code = err.message.slice(0, 40);
      stats.errors.set(code, (stats.errors.get(code) || 0) + 1);
    }
    // Back off after a failure. Without this a fast-failing server (a rate
    // limit, say) turns the loop into a spin that measures nothing but how
    // quickly we can be rejected - which is exactly what happened the first
    // time this ran: 498,914 rate_limited responses and 60 real renders.
    if (stats.failed && stats.sent > 0 && !stats.latencies.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

const samples = [];

async function sample(elapsed) {
  let pool = {};
  let heapMb = 0;
  try {
    const h = await fetch(`${BASE}/healthz`).then((r) => r.json());
    pool = h.pool;
  } catch {
    pool = { error: true };
  }
  const chrome = chromeStats();
  const recent = stats.latencies.slice(-200).sort((a, b) => a - b);
  const p50 = recent.length ? recent[Math.floor(recent.length / 2)] : 0;

  const row = {
    t: Math.round(elapsed / 1000),
    renders: pool.renders ?? 0,
    recycled: pool.recycled ?? 0,
    killed: pool.killed ?? 0,
    launchFailures: pool.launchFailures ?? 0,
    chromeProcs: chrome.count,
    chromeMb: chrome.mb,
    p50,
    ok: stats.ok,
    failed: stats.failed,
    zombies: zombieCount(),
  };
  samples.push(row);

  console.log(
    `  ${String(row.t).padStart(4)}s  renders ${String(row.renders).padStart(5)}` +
      `  recyc ${String(row.recycled).padStart(3)}  kill ${String(row.killed).padStart(3)}` +
      `  lfail ${String(row.launchFailures).padStart(2)}` +
      `  chrome ${String(row.chromeProcs).padStart(3)}proc ${String(row.chromeMb).padStart(5)}MB` +
      `  p50 ${String(row.p50).padStart(5)}ms  ok ${row.ok} fail ${row.failed}`,
  );
}

async function main() {
  console.log(`\nLoad test: ${DURATION / 1000}s at concurrency ${CONCURRENCY}`);
  console.log(`Target: ${BASE}\n`);

  const health = await fetch(`${BASE}/healthz`).then((r) => r.json());
  console.log(`Pool size ${health.pool.size}, ${health.pool.launched} browsers launched\n`);

  const baseline = chromeStats();
  console.log(`Baseline: ${baseline.count} chrome processes, ${baseline.mb} MB\n`);

  const started = Date.now();
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));

  const timer = setInterval(() => sample(Date.now() - started), SAMPLE_MS);

  await new Promise((r) => setTimeout(r, DURATION));
  running = false;
  clearInterval(timer);
  await Promise.allSettled(workers);
  await sample(Date.now() - started);

  // --- Verdict --------------------------------------------------------------
  const all = stats.latencies.sort((a, b) => a - b);
  const p = (q) => (all.length ? all[Math.floor((all.length - 1) * q)] : 0);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const mid = samples[Math.floor(samples.length / 2)];

  console.log(`\n${'='.repeat(74)}`);
  console.log(`  requests    ${stats.sent}  (${stats.ok} ok, ${stats.failed} failed)`);
  console.log(`  throughput  ${(stats.ok / (DURATION / 1000)).toFixed(2)} renders/sec`);
  console.log(`  latency     p50 ${p(0.5)}ms  p90 ${p(0.9)}ms  p99 ${p(0.99)}ms  max ${p(1)}ms`);
  console.log(`  recycles    ${last.recycled}   kills ${last.killed}   launch failures ${last.launchFailures}`);

  console.log(`\n  memory (all chrome processes):`);
  console.log(`    start ${first.chromeMb} MB / ${first.chromeProcs} procs`);
  console.log(`    mid   ${mid.chromeMb} MB / ${mid.chromeProcs} procs`);
  console.log(`    end   ${last.chromeMb} MB / ${last.chromeProcs} procs`);

  const peakMb = Math.max(...samples.map((s) => s.chromeMb));
  const peakProcs = Math.max(...samples.map((s) => s.chromeProcs));
  console.log(`    peak  ${peakMb} MB / ${peakProcs} procs`);

  console.log(`\n  VERDICT`);
  const memGrowth = last.chromeMb - first.chromeMb;
  const procGrowth = last.chromeProcs - first.chromeProcs;

  const checks = [
    [
      'memory bounded',
      memGrowth < first.chromeMb * 1.5 && last.chromeMb < peakMb * 1.3,
      `${memGrowth >= 0 ? '+' : ''}${memGrowth} MB end vs start, peak ${peakMb} MB`,
    ],
    [
      'no process leak',
      procGrowth <= Math.max(4, first.chromeProcs * 0.5),
      `${procGrowth >= 0 ? '+' : ''}${procGrowth} processes end vs start`,
    ],
    ['recycling ran', last.recycled > 0, `${last.recycled} browsers retired`],
    ['no launch failures', last.launchFailures === 0, `${last.launchFailures}`],
    ['error rate under 2%', stats.failed / Math.max(1, stats.sent) < 0.02, `${((stats.failed / Math.max(1, stats.sent)) * 100).toFixed(2)}%`],
    [
      'latency stable',
      mid.p50 > 0 && last.p50 < mid.p50 * 2.5,
      `p50 ${mid.p50}ms mid -> ${last.p50}ms end`,
    ],
  ];

  let failures = 0;
  for (const [name, pass, detail] of checks) {
    if (!pass) failures += 1;
    console.log(`    ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${detail}`);
  }

  if (stats.errors.size) {
    console.log(`\n  errors:`);
    for (const [code, n] of [...stats.errors].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${code}`);
    }
  }

  console.log(`\n${failures === 0 ? '  ALL CHECKS PASSED' : `  ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
