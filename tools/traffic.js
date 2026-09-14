#!/usr/bin/env node
/**
 * Website traffic from Caddy's access log - page views, visitors, where
 * they came from - with no tracking script on the site at all. A developer
 * audience notices trackers, and a product whose job is removing consent
 * banners should not need one of its own.
 *
 * Reads Caddy's JSON log lines on stdin. Visitors are counted as distinct
 * (IP + browser) per day, in memory only; nothing is written anywhere.
 *
 *   ssh screenshotline 'docker exec deploy-caddy-1 sh -c "for f in /data/access*; do case \$f in *.gz) zcat \$f;; *) cat \$f;; esac; done"' | node tools/traffic.js
 *
 * Only screenshotline.com is logged. api.screenshotline.com deliberately is
 * not: its URLs can carry access keys. API activity is in tools/report.js.
 */
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

// Screenshotline is our own renderer: screenshotting our own pages is not a visit.
// upptime is the status page's monitor, which also sends a bare
// "Mozilla/5.0 (compatible)" - no real browser sends a signature that empty,
// and left in, it adds ~288 fake home-page views a day.
const BOT = /bot|crawl|spider|slurp|curl|wget|python|go-http|java\/|headless|monitor|uptime|upptime|preview|fetch|scan|http-client|okhttp|axios|node|screenshotline|^Mozilla\/5\.0 \(compatible\)$/i;
const NOT_PAGES = /^\/(take|demo|extract|v1\/|mcp|healthz|metrics|favicon|robots\.txt|sitemap\.xml)/;
const OWN = /(^|\.)screenshotline\.com$/;

const days = new Map();
const pages = new Map();
const referrers = new Map();
const refParams = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const r = e.request;
  if (!r || r.method !== 'GET' || e.status >= 400) continue;
  const ua = r.headers?.['User-Agent']?.[0] || '';
  if (!ua || BOT.test(ua)) continue;
  const day = new Date(e.ts * 1000).toISOString().slice(0, 10);
  const d = days.get(day) || { day, views: 0, visitors: new Set(), demo: 0 };
  days.set(day, d);
  const url = new URL(r.uri, 'https://screenshotline.com');

  if (url.pathname === '/demo') {
    if (e.status === 200) d.demo += 1;
    continue;
  }
  const type = e.resp_headers?.['Content-Type']?.[0] || '';
  if (NOT_PAGES.test(url.pathname) || !type.startsWith('text/html')) continue;

  d.views += 1;
  d.visitors.add(createHash('sha256').update(`${r.client_ip || r.remote_ip}|${ua}`).digest('hex').slice(0, 12));
  bump(pages, url.pathname);
  const ref = r.headers?.Referer?.[0];
  if (ref) {
    try {
      const host = new URL(ref).hostname.replace(/^www\./, '');
      if (!OWN.test(host)) bump(referrers, host);
    } catch {
      /* malformed referrer */
    }
  }
  const tag = url.searchParams.get('ref') || url.searchParams.get('utm_source');
  if (tag) bump(refParams, tag.slice(0, 40));
}

const sorted = (m, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const pad = (s, w) => String(s).padEnd(w);
let out = 'WEBSITE (from the Caddy access log, bots excluded)\n\n  day         views  visitors  demo_captures\n';
for (const d of [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1))) {
  out += `  ${d.day}  ${pad(d.views, 5)}  ${pad(d.visitors.size, 8)}  ${d.demo}\n`;
}
out += '\nTOP PAGES\n' + sorted(pages).map(([k, v]) => `  ${pad(v, 6)} ${k}`).join('\n') + '\n';
out += '\nTOP REFERRERS\n' + (sorted(referrers).map(([k, v]) => `  ${pad(v, 6)} ${k}`).join('\n') || '  (none)') + '\n';
out += '\nTAGGED LINKS (?ref= / ?utm_source=)\n' + (sorted(refParams).map(([k, v]) => `  ${pad(v, 6)} ${k}`).join('\n') || '  (none)') + '\n';
process.stdout.write(out);
