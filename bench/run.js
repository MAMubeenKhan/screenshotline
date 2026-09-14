/**
 * Benchmark runner.
 *
 *   node bench/run.js                              20 renderer-breaking pages
 *   node bench/run.js --suite real-world           33 use-case pages
 *   node bench/run.js --suite 200 --concurrency 6  the full hardening sweep
 *   node bench/run.js --only intl                  filter by id, url or category
 *   node bench/run.js --provider screenshotone --key sk_...
 *
 * Output: bench/out/<provider>[-<suite>]/<id>.png plus results.json.
 * Then: node bench/compare.js
 *
 * The important output is not the pass rate, it is the SURPRISES block: an
 * 'ok' page that failed is a bug, and a 'known-hard' page that passed means an
 * assumption changed. Both are worth a look; a raw percentage is not.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_PAGES } from './urls.js';
import { REAL_WORLD } from './real-world.js';
import { SUITE_200 } from './suite-200.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const provider = flag('provider', 'screenshotline');
const apiKey = flag('key', process.env.BENCH_API_KEY || '');
const base = flag('base', 'http://127.0.0.1:3000');
const only = flag('only', '');
const suite = flag('suite', 'hard');
const concurrency = Math.max(1, Number(flag('concurrency', '1')));
const timeout = flag('timeout', '30000');
const fullPage = args.includes('--full-page');

const SUITES = {
  hard: HARD_PAGES,
  'real-world': REAL_WORLD,
  200: SUITE_200,
  all: [...HARD_PAGES, ...REAL_WORLD, ...SUITE_200],
};

const COMMON = { viewportWidth: 1280, viewportHeight: 800 };

/** Each provider maps the same intent onto its own parameter names. */
const PROVIDERS = {
  screenshotline: (page) => {
    const p = new URLSearchParams({
      url: page.url,
      format: 'png',
      full_page: String(fullPage),
      block_ads: 'true',
      block_cookie_banners: 'true',
      viewport_width: String(COMMON.viewportWidth),
      viewport_height: String(COMMON.viewportHeight),
      timeout,
      ...(page.options || {}),
    });
    if (apiKey) p.set('access_key', apiKey);
    return `${base}/take?${p.toString()}`;
  },

  screenshotone: (page) => {
    const p = new URLSearchParams({
      access_key: apiKey,
      url: page.url,
      format: 'png',
      full_page: String(fullPage),
      block_ads: 'true',
      block_cookie_banners: 'true',
      viewport_width: String(COMMON.viewportWidth),
      viewport_height: String(COMMON.viewportHeight),
      cache: 'false',
    });
    if (page.options?.color_scheme === 'dark') p.set('dark_mode', 'true');
    return `https://api.screenshotone.com/take?${p.toString()}`;
  },

  apiflash: (page) => {
    const p = new URLSearchParams({
      access_key: apiKey,
      url: page.url,
      format: 'png',
      full_page: String(fullPage),
      no_ads: 'true',
      no_cookie_banners: 'true',
      width: String(COMMON.viewportWidth),
      height: String(COMMON.viewportHeight),
      response_type: 'image',
    });
    return `https://api.apiflash.com/v1/urltoimage?${p.toString()}`;
  },
};

async function capture(page, build, dir) {
  const started = Date.now();
  const row = {
    id: page.id,
    url: page.url,
    breaks: page.breaks || '',
    category: page.category || 'general',
    expect: page.expect || 'ok',
    blankOk: Boolean(page.blankOk),
    provider,
  };

  try {
    const res = await fetch(build(page), { redirect: 'follow' });
    row.status = res.status;
    row.ms = Date.now() - started;
    row.renderMs = Number(res.headers.get('x-render-ms')) || null;
    row.waitFallback = res.headers.get('x-wait-fallback') === 'true';
    row.upstream = res.headers.get('x-upstream-status') || null;

    if (!res.ok) {
      const text = await res.text();
      row.ok = false;
      try {
        const parsed = JSON.parse(text);
        row.code = parsed.error?.code;
        row.error = parsed.error?.message;
      } catch {
        row.error = text.slice(0, 240);
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(dir, `${page.id}.png`), buf);
      row.ok = true;
      row.bytes = buf.length;
      // Trust the server's own blank detection rather than a byte-size guess:
      // a sparse-but-real page (http://example.com) is small and fine, while a
      // bot wall can be large and useless. Fall back to size only if the
      // header is absent, e.g. for a third-party provider.
      const flagged = res.headers.get('x-blank-suspected');
      row.blankSuspected =
        flagged === null ? buf.length < 12_000 : flagged === 'true';
      row.textLength = Number(res.headers.get('x-text-length')) || 0;
    }
  } catch (err) {
    row.ok = false;
    row.ms = Date.now() - started;
    row.code = 'client_error';
    row.error = String(err.message).slice(0, 240);
  }

  return row;
}

/** Simple worker-pool so 200 pages do not take twenty minutes. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const build = PROVIDERS[provider];
  if (!build) {
    console.error(`Unknown provider "${provider}". Known: ${Object.keys(PROVIDERS).join(', ')}`);
    process.exit(1);
  }
  if (provider !== 'screenshotline' && !apiKey) {
    console.error(`Provider "${provider}" needs --key or BENCH_API_KEY.`);
    process.exit(1);
  }

  const chosen = SUITES[suite];
  if (!chosen) {
    console.error(`Unknown suite "${suite}". Known: ${Object.keys(SUITES).join(', ')}`);
    process.exit(1);
  }

  // An exact category name wins outright. Without this, --only http matched
  // every page in the suite, because every URL contains "http".
  const byCategory = chosen.filter((p) => p.category === only);
  const pages = !only
    ? chosen
    : byCategory.length
      ? byCategory
      : chosen.filter((p) => p.id.includes(only) || p.url.includes(only));

  const dir = path.join(OUT, suite === 'hard' ? provider : `${provider}-${suite}`);
  await fs.mkdir(dir, { recursive: true });

  console.log(
    `\n${provider} / suite "${suite}": ${pages.length} pages, concurrency ${concurrency}\n`,
  );

  let done = 0;
  const results = await runPool(pages, concurrency, async (page) => {
    const row = await capture(page, build, dir);
    done += 1;
    const tag = row.ok ? (row.blankSuspected ? 'BLANK' : 'ok') : 'FAIL';
    const size = row.ok ? `${String(Math.round(row.bytes / 1024)).padStart(5)} KB` : `${String(row.status || '---').padStart(5)}   `;
    console.log(
      `  [${String(done).padStart(3)}/${pages.length}] ${tag.padEnd(5)} ${row.id.padEnd(26)} ${size} ${String(row.ms).padStart(6)}ms${row.waitFallback ? '  (wait-fallback)' : ''}`,
    );
    return row;
  });

  const ok = results.filter((r) => r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => (times.length ? times[Math.floor((times.length - 1) * p)] : 0);

  await fs.writeFile(
    path.join(dir, 'results.json'),
    JSON.stringify({ provider, suite, ranAt: new Date().toISOString(), results }, null, 2),
  );

  // --- Report ---------------------------------------------------------------
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  captured   ${ok.length}/${results.length}  (${Math.round((ok.length / results.length) * 100)}%)`);
  console.log(`  latency    p50 ${pct(0.5)}ms   p90 ${pct(0.9)}ms   p99 ${pct(0.99)}ms`);
  console.log(`  fallbacks  ${results.filter((r) => r.waitFallback).length} pages never went network-idle`);

  const byCat = new Map();
  for (const r of results) {
    const c = byCat.get(r.category) || { ok: 0, total: 0 };
    c.total += 1;
    if (r.ok) c.ok += 1;
    byCat.set(r.category, c);
  }
  console.log('\n  by category:');
  for (const [cat, c] of [...byCat].sort()) {
    const bar = '#'.repeat(Math.round((c.ok / c.total) * 20)).padEnd(20, '.');
    console.log(`    ${cat.padEnd(10)} ${bar} ${String(c.ok).padStart(3)}/${String(c.total).padEnd(3)}`);
  }

  const regressions = results.filter((r) => r.expect === 'ok' && !r.ok);
  const improvements = results.filter((r) => r.expect === 'known-hard' && r.ok);
  const thin = results.filter((r) => r.ok && r.blankSuspected);
  // A blank frame on a page we have not already diagnosed is the failure this
  // whole suite exists to catch: a 200 that a customer's pipeline records as a
  // success while the image shows nothing.
  const unexpectedBlank = thin.filter((r) => !r.blankOk);
  const knownBlank = thin.filter((r) => r.blankOk);

  if (regressions.length) {
    console.log(`\n  BUGS - expected to work, failed (${regressions.length}):`);
    for (const r of regressions) {
      console.log(`    ${r.id.padEnd(26)} ${r.code || r.status}`);
      if (r.error) console.log(`      ${String(r.error).slice(0, 120)}`);
    }
  }
  if (improvements.length) {
    console.log(`\n  Expected hard, but worked (${improvements.length}) - verify the image is real content, not a bot wall:`);
    for (const r of improvements) console.log(`    ${r.id}`);
  }
  if (knownBlank.length) {
    console.log(`
  Blank, and known to be (${knownBlank.length}) - not a regression:`);
    for (const r of knownBlank) {
      console.log(`    ${r.id.padEnd(26)} ${Math.round(r.bytes / 1024)} KB   ${r.breaks || ''}`);
    }
  }
  if (unexpectedBlank.length) {
    console.log(`
  BLANK CAPTURES - a 200 with no visible content (${unexpectedBlank.length}):`);
    for (const r of unexpectedBlank) {
      console.log(`    ${r.id.padEnd(26)} ${Math.round(r.bytes / 1024)} KB`);
    }
    console.log('    Open the image. If the page really is blank for everyone,');
    console.log('    mark it blankOk in bench/suite-200.js. Otherwise it is a bug.');
  }

  console.log(`\n  wrote ${path.relative(process.cwd(), dir)}`);
  console.log(`  next: node bench/compare.js\n`);

  // Exit non-zero so a silent blank regression cannot pass quietly in a
  // script or a CI job that only checks the status code.
  if (unexpectedBlank.length) {
    console.log(`  FAILED: ${unexpectedBlank.length} unexpected blank capture(s).
`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
