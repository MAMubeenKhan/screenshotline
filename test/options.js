/**
 * Option parsing: the parameters customers actually type.
 *
 * No browser, no network.
 *
 *   node test/options.js
 */
import assert from 'node:assert';
import { parseOptions } from '../src/options.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}

const opts = (extra) => parseOptions({ url: 'https://example.com/', ...extra });

check('cookies parse from one header-style string', () => {
  const c = opts({ cookies: 'session=abc123; token=xyz' }).cookies;
  assert.deepEqual(c.map((x) => [x.name, x.value]), [['session', 'abc123'], ['token', 'xyz']]);
});

check('cookies parse from a repeated parameter', () => {
  const c = opts({ cookies: ['a=1', 'b=2'] }).cookies;
  assert.deepEqual(c.map((x) => x.name), ['a', 'b']);
});

check('attributes modify the cookie before them, they are not cookies', () => {
  const c = opts({ cookies: 'session=abc; Domain=.example.com; Path=/app; Secure; HttpOnly' }).cookies;
  assert.equal(c.length, 1, `expected one cookie, got ${c.length}`);
  assert.equal(c[0].domain, '.example.com');
  assert.equal(c[0].path, '/app');
});

check('a value containing = survives', () => {
  const c = opts({ cookies: 'jwt=aa.bb==' }).cookies;
  assert.equal(c[0].value, 'aa.bb==');
});

check('malformed pieces are dropped, not thrown', () => {
  // A bad cookie should cost you a login, not a 400 on a capture that would
  // otherwise have worked.
  const c = opts({ cookies: 'good=1; nonsense; =novalue; also=2' }).cookies;
  assert.deepEqual(c.map((x) => x.name), ['good', 'also']);
});

check('no cookies parameter means null, not an empty array', () => {
  assert.equal(opts({}).cookies, null);
  assert.equal(opts({ cookies: '' }).cookies, null);
  assert.equal(opts({ cookies: ';;;' }).cookies, null);
});

check('injection parameters default to null and are capped', () => {
  const none = opts({});
  assert.equal(none.injectCss, null);
  assert.equal(none.injectJs, null);
  assert.equal(none.hideSelector, null);

  const big = opts({ inject_css: 'a'.repeat(200_000), hide_selector: 'b'.repeat(9_000) });
  assert.equal(big.injectCss.length, 100_000, 'inject_css is capped');
  assert.equal(big.hideSelector.length, 4_000, 'hide_selector is capped');
});

check('the new blockers default to off', () => {
  const o = opts({});
  assert.equal(o.blockChats, false);
  assert.equal(o.blockPopups, false);
  assert.equal(opts({ block_chats: 'true', block_popups: 'true' }).blockChats, true);
  assert.equal(opts({ block_chats: 'true', block_popups: 'true' }).blockPopups, true);
});

// People type spendpedia.com, not https://www.spendpedia.com.
check('a bare hostname gets https', () => {
  const u = (x) => parseOptions({ url: x }).url;
  assert.equal(u('spendpedia.com'), 'https://spendpedia.com');
  assert.equal(u('www.spendpedia.com'), 'https://www.spendpedia.com');
  assert.equal(u('spendpedia.com/pricing'), 'https://spendpedia.com/pricing');
  assert.equal(u('sub.domain.co.uk/a?b=1#c'), 'https://sub.domain.co.uk/a?b=1#c');
  assert.equal(u('  spendpedia.com  '), 'https://spendpedia.com', 'whitespace is trimmed');
});

check('a host with a port is still a bare host', () => {
  assert.equal(parseOptions({ url: 'example.com:8080/x' }).url, 'https://example.com:8080/x');
  assert.equal(parseOptions({ url: 'localhost:3000' }).url, 'https://localhost:3000');
});

check('an existing scheme is never touched', () => {
  for (const u of ['https://example.com/', 'http://example.com/', 'HTTPS://Example.com/']) {
    assert.equal(parseOptions({ url: u }).url, u);
  }
});

check('a scheme we do not support is left for the validator to name', () => {
  // Rewriting javascript:alert(1) to https://javascript:alert(1) would get it
  // rejected for a bad port, and the caller would be told the wrong thing.
  for (const u of ['javascript:alert(1)', 'mailto:a@b.com', 'data:text/html,hi', 'file:///etc/passwd']) {
    assert.equal(parseOptions({ url: u }).url, u);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
