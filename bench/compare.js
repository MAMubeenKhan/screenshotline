/**
 * Builds bench/out/compare.html - every page, every provider, side by side.
 *
 * This is the Phase 1 decision gate. Open it, look at all of them, and write
 * down the pages where you win. Those five pages are your marketing copy, your
 * comparison page, and the spine of your Show HN post.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function loadProviders() {
  let dirs;
  try {
    dirs = await fs.readdir(OUT, { withFileTypes: true });
  } catch {
    console.error('No bench/out directory. Run: node bench/run.js');
    process.exit(1);
  }

  const providers = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(OUT, d.name, 'results.json'), 'utf8');
      providers.push(JSON.parse(raw));
    } catch {
      /* directory without results - skip */
    }
  }
  return providers;
}

function summary(provider) {
  const ok = provider.results.filter((r) => r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  return {
    name: provider.provider,
    ok: ok.length,
    total: provider.results.length,
    median: times.length ? times[Math.floor(times.length / 2)] : 0,
    avgKb: ok.length
      ? Math.round(ok.reduce((s, r) => s + (r.bytes || 0), 0) / ok.length / 1024)
      : 0,
  };
}

async function main() {
  const providers = await loadProviders();
  if (!providers.length) {
    console.error('No results found. Run: node bench/run.js');
    process.exit(1);
  }

  const names = providers.map((p) => p.provider);
  const byId = new Map();
  for (const provider of providers) {
    for (const row of provider.results) {
      if (!byId.has(row.id)) byId.set(row.id, { id: row.id, url: row.url, breaks: row.breaks, cells: {} });
      byId.get(row.id).cells[provider.provider] = row;
    }
  }

  const summaries = providers.map(summary);

  const rows = [...byId.values()]
    .map((page) => {
      const cells = names
        .map((name) => {
          const cell = page.cells[name];
          if (!cell) return `<div class="cell empty"><div class="ph">not captured</div></div>`;
          if (!cell.ok) {
            return `<div class="cell"><div class="ph fail">${esc(cell.error || `status ${cell.status}`)}</div>
              <div class="cap"><b>${esc(name)}</b> &middot; failed</div></div>`;
          }
          return `<div class="cell">
            <a href="${esc(name)}/${esc(page.id)}.png" target="_blank" rel="noreferrer">
              <img loading="lazy" src="${esc(name)}/${esc(page.id)}.png" alt="${esc(page.id)} by ${esc(name)}">
            </a>
            <div class="cap"><b>${esc(name)}</b> &middot; ${cell.ms}ms &middot; ${Math.round((cell.bytes || 0) / 1024)} KB</div>
          </div>`;
        })
        .join('');

      return `<section>
        <h2>${esc(page.id)}</h2>
        <p class="meta"><a href="${esc(page.url)}" target="_blank" rel="noreferrer">${esc(page.url)}</a></p>
        <p class="breaks">Breaks: ${esc(page.breaks || '')}</p>
        <div class="grid" style="grid-template-columns:repeat(${names.length},minmax(0,1fr))">${cells}</div>
      </section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screenshot API benchmark</title>
<style>
  :root{--ground:#f6f8f9;--surface:#fff;--ink:#131a1f;--ink-2:#4a5a64;--ink-3:#7a8b96;
    --rule:#dbe3e7;--accent:#0c6b75;--crit:#a02a20}
  @media (prefers-color-scheme:dark){:root{--ground:#0c1216;--surface:#131c21;--ink:#e6edf0;
    --ink-2:#a2b3bc;--ink-3:#76888f;--rule:#23323a;--accent:#43b9c2;--crit:#e58074}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:1500px;margin:0 auto;padding:36px 24px 72px}
  h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--ink-2);margin:0 0 26px}
  table.sum{border-collapse:collapse;margin:0 0 34px;font-size:14px}
  table.sum th,table.sum td{text-align:left;padding:8px 22px 8px 0;border-bottom:1px solid var(--rule)}
  table.sum th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
  section{margin:0 0 42px;padding-top:22px;border-top:1px solid var(--rule)}
  h2{font-size:17px;margin:0 0 3px}
  .meta{margin:0 0 2px;font-size:13px}
  .meta a{color:var(--accent)}
  .breaks{margin:0 0 14px;font-size:13px;color:var(--ink-3)}
  .grid{display:grid;gap:14px}
  .cell{background:var(--surface);border:1px solid var(--rule);border-radius:4px;overflow:hidden}
  .cell img{width:100%;height:auto;display:block;max-height:640px;object-fit:cover;object-position:top}
  .cap{font-size:12px;color:var(--ink-3);padding:8px 10px;border-top:1px solid var(--rule);
    font-family:ui-monospace,monospace}
  .ph{padding:44px 14px;text-align:center;color:var(--ink-3);font-size:13px;
    font-family:ui-monospace,monospace;word-break:break-word}
  .ph.fail{color:var(--crit)}
  .cell.empty{opacity:.5}
</style></head><body><div class="wrap">
<h1>Screenshot API benchmark</h1>
<p class="sub">${byId.size} pages &middot; ${names.length} provider(s) &middot; generated ${new Date().toLocaleString()}</p>

<table class="sum">
  <tr><th>Provider</th><th>Captured</th><th>Median</th><th>Avg size</th></tr>
  ${summaries
    .map(
      (s) =>
        `<tr><td><b>${esc(s.name)}</b></td><td>${s.ok}/${s.total}</td><td>${s.median}ms</td><td>${s.avgKb} KB</td></tr>`,
    )
    .join('')}
</table>

${rows}
</div></body></html>`;

  const file = path.join(OUT, 'compare.html');
  await fs.writeFile(file, html);
  console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
  console.log('open it and look at every row.\n');
  for (const s of summaries) {
    console.log(`  ${s.name.padEnd(16)} ${String(s.ok).padStart(2)}/${s.total}  median ${s.median}ms  avg ${s.avgKb}KB`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
