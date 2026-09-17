#!/usr/bin/env node
/**
 * The operator's report: who signed up, from where, whether they rendered
 * anything, through which door, what broke, and who pays.
 *
 * Reads the events, accounts and usage tables. Nothing here writes.
 *
 *   ssh screenshotline 'docker exec deploy-app-1 node tools/report.js'
 *   ssh screenshotline 'docker exec deploy-app-1 node tools/report.js --days 3'
 *   ssh screenshotline 'docker exec deploy-app-1 node tools/report.js --account someone@example.com'
 *
 * Website visits are not in the database - they are in Caddy's access log.
 * See tools/traffic.js for those.
 */
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;

function table(rows, cols) {
  if (!rows.length) return '  (none)\n';
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => '  ' + vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n') + '\n';
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
function quantile(values, q) {
  if (!values.length) return '-';
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

export function buildReport(db, { days = 14, now = Date.now() } = {}) {
  const since = new Date(now - days * DAY).toISOString();
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  let out = `Screenshotline report - last ${days} days (since ${since.slice(0, 16)}Z)\n\n`;

  // 0. First, because each row may be a customer who paid and was not
  // upgraded. Printed only when there is something to say.
  const notApplied = all(
    `SELECT substr(ts, 1, 16) AS time, outcome AS event, substr(code, 13) AS problem,
       COALESCE(account_id, '(none)') AS account
     FROM events WHERE endpoint = 'billing' AND code LIKE 'not_applied:%' AND ts >= ?
     ORDER BY ts DESC LIMIT 20`,
    since,
  );
  if (notApplied.length) {
    out += '!!! BILLING EVENTS NOT APPLIED - check each in the Polar dashboard; a customer may have paid without being upgraded\n';
    out += table(notApplied, ['time', 'event', 'problem', 'account']) + '\n';
  }

  // 1. The funnel, day by day.
  const funnel = all(
    `SELECT substr(ts, 1, 10) AS day,
       SUM(endpoint = 'demo' AND outcome IN ('render', 'blank_unbilled', 'cached')) AS demo,
       COUNT(DISTINCT CASE WHEN endpoint = 'demo' THEN visitor END) AS demo_people,
       SUM(endpoint = 'signup' AND outcome = 'created') AS signups,
       SUM(endpoint IN ('take', 'extract') AND outcome = 'render' AND via IS NULL) AS api_renders,
       SUM(endpoint IN ('take', 'extract') AND outcome = 'render' AND via IS NOT NULL) AS mcp_renders,
       SUM(outcome = 'failed') AS failed,
       SUM(endpoint = 'billing' AND outcome = 'subscription.created') AS new_paid,
       SUM(endpoint = 'billing' AND outcome IN ('subscription.canceled', 'subscription.revoked')) AS churned
     FROM events WHERE ts >= ? GROUP BY day ORDER BY day DESC`,
    since,
  );
  out += 'FUNNEL BY DAY\n' + table(funnel, ['day', 'demo', 'demo_people', 'signups', 'api_renders', 'mcp_renders', 'failed', 'new_paid', 'churned']) + '\n';

  // 2. Where signups came from (self-reported, optional).
  const sources = all(
    `SELECT COALESCE(code, '(not said)') AS source, COUNT(*) AS signups
     FROM events WHERE endpoint = 'signup' AND outcome = 'created' AND ts >= ?
     GROUP BY source ORDER BY signups DESC`,
    since,
  );
  out += 'SIGNUPS BY SOURCE\n' + table(sources, ['source', 'signups']);
  const refused = all(
    `SELECT COALESCE(code, '?') AS reason, COUNT(*) AS n FROM events
     WHERE endpoint = 'signup' AND outcome = 'rejected' AND ts >= ? GROUP BY reason ORDER BY n DESC`,
    since,
  );
  if (refused.length) out += '  refused signups:\n' + table(refused, ['reason', 'n']);
  out += '\n';

  // 3. Activation: did new accounts actually render anything?
  const newAccounts = all(`SELECT id, created_at FROM accounts WHERE created_at >= ?`, since);
  const firsts = newAccounts.map((a) => {
    const f = one(
      `SELECT MIN(ts) AS first FROM events WHERE account_id = ? AND outcome = 'render'`,
      a.id,
    );
    return f?.first ? (Date.parse(f.first) - Date.parse(a.created_at)) / 60_000 : null;
  });
  const activated = firsts.filter((m) => m !== null);
  out += `ACTIVATION\n  ${newAccounts.length} new accounts, ${activated.length} rendered at least once (${pct(activated.length, newAccounts.length)}).`;
  out += activated.length ? ` Median time to first render: ${Math.round(quantile(activated, 0.5))} min.\n\n` : '\n\n';

  // 4. Every door, every outcome.
  const doors = all(
    `SELECT endpoint || COALESCE('/' || via, '') AS door, outcome, COUNT(*) AS n
     FROM events WHERE ts >= ? AND endpoint IN ('take', 'extract', 'demo')
     GROUP BY door, outcome ORDER BY door, n DESC`,
    since,
  );
  out += 'REQUESTS BY DOOR AND OUTCOME\n' + table(doors, ['door', 'outcome', 'n']) + '\n';

  // 5. What went wrong, by error code.
  const errors = all(
    `SELECT code, outcome, COUNT(*) AS n, COUNT(DISTINCT account_id) AS accounts
     FROM events WHERE ts >= ? AND outcome IN ('failed', 'rejected') AND code IS NOT NULL
       AND endpoint IN ('take', 'extract', 'demo')
     GROUP BY code, outcome ORDER BY n DESC LIMIT 15`,
    since,
  );
  out += 'ERRORS\n' + table(errors, ['code', 'outcome', 'n', 'accounts']) + '\n';

  // 6. Render time.
  const speed = ['take', 'extract', 'demo'].map((endpoint) => {
    const ms = all(
      `SELECT ms FROM events WHERE ts >= ? AND endpoint = ? AND outcome = 'render' AND ms IS NOT NULL`,
      since, endpoint,
    ).map((r) => r.ms);
    return { endpoint, renders: ms.length, p50_ms: quantile(ms, 0.5), p90_ms: quantile(ms, 0.9) };
  });
  out += 'RENDER TIME\n' + table(speed, ['endpoint', 'renders', 'p50_ms', 'p90_ms']) + '\n';

  // 7. The busiest accounts.
  const top = all(
    `SELECT a.email, a.plan, SUM(e.outcome = 'render') AS renders,
       SUM(e.outcome = 'cached') AS cached, SUM(e.outcome = 'blank_unbilled') AS blank_free,
       SUM(e.outcome = 'failed') AS failed, MAX(e.ts) AS last_seen
     FROM events e JOIN accounts a ON a.id = e.account_id
     WHERE e.ts >= ? GROUP BY a.id ORDER BY renders DESC LIMIT 15`,
    since,
  ).map((r) => ({ ...r, last_seen: String(r.last_seen).slice(0, 16) }));
  out += 'TOP ACCOUNTS\n' + table(top, ['email', 'plan', 'renders', 'cached', 'blank_free', 'failed', 'last_seen']) + '\n';

  // 8. What people point it at (domains only - never full URLs).
  const domains = all(
    `SELECT domain, COUNT(*) AS renders, COUNT(DISTINCT account_id) AS accounts
     FROM events WHERE ts >= ? AND outcome = 'render' AND domain IS NOT NULL
     GROUP BY domain ORDER BY renders DESC LIMIT 15`,
    since,
  );
  out += 'TOP TARGET DOMAINS\n' + table(domains, ['domain', 'renders', 'accounts']) + '\n';

  // 9. MCP.
  const mcp = all(
    `SELECT outcome AS method, COALESCE(code, '') AS tool, COUNT(*) AS n, COUNT(DISTINCT account_id) AS accounts
     FROM events WHERE ts >= ? AND endpoint = 'mcp' AND outcome NOT LIKE 'notifications/%'
     GROUP BY method, tool ORDER BY n DESC`,
    since,
  );
  out += 'MCP\n' + table(mcp, ['method', 'tool', 'n', 'accounts']) + '\n';

  // 10. Who pays, right now.
  const plans = all(`SELECT plan, status, COUNT(*) AS accounts FROM accounts GROUP BY plan, status ORDER BY accounts DESC`);
  out += 'ACCOUNTS BY PLAN (all time)\n' + table(plans, ['plan', 'status', 'accounts']);
  return out;
}

export function buildAccountReport(db, who) {
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ? OR email = ?').get(who, String(who).toLowerCase());
  if (!acct) return `No account matches "${who}".\n`;
  let out = `${acct.email}  ${acct.id}\n  plan ${acct.plan}, ${acct.status}, created ${acct.created_at.slice(0, 16)}\n\n`;
  const usage = db.prepare('SELECT period, renders, cached, failed FROM usage WHERE account_id = ? ORDER BY period DESC').all(acct.id);
  out += 'USAGE BY PERIOD\n' + table(usage, ['period', 'renders', 'cached', 'failed']) + '\n';
  const keys = db.prepare('SELECT prefix, name, created_at, last_used_at, revoked_at FROM api_keys WHERE account_id = ?').all(acct.id);
  out += 'KEYS\n' + table(keys, ['prefix', 'name', 'created_at', 'last_used_at', 'revoked_at']) + '\n';
  const events = db
    .prepare(`SELECT ts, endpoint, via, outcome, status, code, ms, domain FROM events WHERE account_id = ? ORDER BY ts DESC LIMIT 50`)
    .all(acct.id)
    .map((e) => ({ ...e, ts: e.ts.slice(0, 19) }));
  out += 'LAST 50 EVENTS\n' + table(events, ['ts', 'endpoint', 'via', 'outcome', 'status', 'code', 'ms', 'domain']);
  return out;
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const file = process.env.DB_FILE || '.data/screenshotline.db';
  const db = new DatabaseSync(file, { readOnly: true });
  const who = flag('--account');
  process.stdout.write(who ? buildAccountReport(db, who) : buildReport(db, { days: Number(flag('--days') || 14) }));
  db.close();
}
