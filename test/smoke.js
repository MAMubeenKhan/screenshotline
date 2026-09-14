/**
 * Smoke test. Boots the server in-process, exercises the real render path.
 * No framework: `npm run smoke` and read the output.
 */
import { setTimeout as sleep } from 'node:timers/promises';

process.env.PORT = process.env.PORT || '3199';
process.env.POOL_SIZE = process.env.POOL_SIZE || '1';
process.env.ACCESS_KEYS = '';

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function main() {
  console.log('booting server...');
  const { pool } = await import('../src/index.js');

  // Wait for the pool to finish warming.
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${BASE}/healthz`).catch(() => null);
    if (res?.ok) {
      const body = await res.json();
      if (body.pool.launched > 0) break;
    }
    await sleep(500);
  }

  console.log('\nrunning checks:\n');

  await check('healthz reports a warm pool', async () => {
    const res = await fetch(`${BASE}/healthz`);
    const body = await res.json();
    assert(res.ok, `status ${res.status}`);
    assert(body.pool.launched > 0, 'no browsers launched');
  });

  await check('every docs page says how to get a key and what is free', async () => {
    // /docs once never said it at all - only the language pages did, as a
    // literal that had to be hand-edited when the free tier changed.
    const { PLANS } = await import('../src/store.js');
    const want = `${PLANS.free.included.toLocaleString('en-US')} renders a month`;
    for (const p of ['/docs', '/docs/curl', '/docs/python', '/docs/extract']) {
      const html = await (await fetch(`${BASE}${p}`)).text();
      assert(html.includes(want), `${p} does not say "${want}"`);
      assert(html.includes('href="/account"'), `${p} has no link to create a key`);
    }
  });

  await check('hosted MCP endpoint: a real client lists tools and reads a page', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'smoke', version: '0.0.1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
    const tools = (await client.listTools()).tools.map((t) => t.name).sort().join(',');
    assert(tools === 'read_page,screenshot', `tools were ${tools}`);
    const read = await client.callTool({ name: 'read_page', arguments: { url: 'https://example.com' } });
    assert(!read.isError, `read_page errored: ${read.content?.[0]?.text}`);
    assert(read.content[0].text.includes('Example Domain'), 'no page text');
    await client.close();
    const get = await fetch(`${BASE}/mcp`);
    assert(get.status === 405, `GET /mcp should be 405, got ${get.status}`);
  });

  await check('comparison pages serve, cite their sources and are in the sitemap', async () => {
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    for (const [slug, source] of [
      ['screenshotone-alternative', 'https://screenshotone.com/pricing/'],
      ['urlbox-alternative', 'https://urlbox.com/pricing'],
      ['apiflash-alternative', 'https://apiflash.com/'],
    ]) {
      const res = await fetch(`${BASE}/${slug}`);
      const html = await res.text();
      assert(res.ok, `/${slug} status ${res.status}`);
      assert(html.includes('were checked on'), `/${slug} lost its checked-on date`);
      assert(html.includes(source), `/${slug} lost its source link`);
      assert(html.includes('does not do'), `/${slug} lost the section on what we do not do`);
      assert(sitemap.includes(`/${slug}<`), `/${slug} missing from the sitemap`);
    }
  });

  await check('deep health renders a real page, then serves the cached result', async () => {
    const first = await fetch(`${BASE}/healthz/render`);
    const body = await first.json();
    assert(first.status === 200 && body.ok === true, `deep health failed: ${JSON.stringify(body)}`);
    // Within a minute, nobody gets a second real render out of it.
    const t = Date.now();
    const again = await (await fetch(`${BASE}/healthz/render`)).json();
    assert(Date.now() - t < 500, 'a second call rendered again instead of using the cached result');
    assert(again.render_ms === body.render_ms, 'the cached result should be the same check');
  });

  await check('blog routes: index, feed, preview, and a 404 for nonsense', async () => {
    const index = await fetch(`${BASE}/blog`);
    assert(index.ok && (await index.text()).includes('<h1>Blog</h1>'), `/blog ${index.status}`);
    const feed = await fetch(`${BASE}/blog/feed.xml`);
    assert(feed.ok && (feed.headers.get('content-type') || '').includes('rss'), `feed ${feed.status} ${feed.headers.get('content-type')}`);
    assert((await feed.text()).startsWith('<?xml'), 'feed is not XML');
    // Preview works whatever the date, so this never flips on launch day.
    const post = await fetch(`${BASE}/blog/headless-chrome-at-scale?preview=1`);
    assert(post.ok && (await post.text()).includes('Six things that break'), `post preview ${post.status}`);
    const missing = await fetch(`${BASE}/blog/no-such-post`);
    assert(missing.status === 404, `unknown post should 404, got ${missing.status}`);
    const home = await (await fetch(`${BASE}/`)).text();
    assert(home.includes('href="/blog"'), 'no Blog link on the home page');
  });

  await check('landing page serves the demo', async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    assert(res.ok, `status ${res.status}`);
    assert(html.includes('<form id="f">'), 'demo form missing');
  });

  await check('a genuinely blank capture is still caught, calibrated or not', async () => {
    // Narrowing the pixel signal must not blind the detector: an empty page
    // is flagged at the default viewport AND at one where bytes mean nothing.
    const hide = 'inject_css=body%7Bvisibility%3Ahidden%7D&cache=false';
    for (const q of ['', '&viewport_width=3840&viewport_height=4320', '&format=jpeg']) {
      const res = await fetch(`${BASE}/take?url=https://example.com&${hide}${q}`);
      assert(res.ok, `status ${res.status}`);
      assert(res.headers.get('x-blank-suspected') === 'true', `blank page not flagged (${q || 'default'})`);
    }
    const real = await fetch(`${BASE}/take?url=https://example.com&selector=h1&cache=false`);
    assert(real.headers.get('x-blank-suspected') === 'false', 'a selector capture of a real heading was flagged blank');
  });

  await check('captures a PNG', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('https://example.com')}`);
    // Do not read the body here - a template literal in the assert message
    // would consume it before arrayBuffer() below can.
    assert(res.ok, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'image/png', 'wrong content-type');
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.subarray(0, 4).equals(PNG_MAGIC), 'body is not a PNG');
    assert(buf.length > 1000, `suspiciously small: ${buf.length} bytes`);
  });

  await check('captures WebP at a custom viewport', async () => {
    const url = `${BASE}/take?url=${encodeURIComponent('https://example.com')}&format=webp&viewport_width=800&viewport_height=600`;
    const res = await fetch(url);
    assert(res.ok, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'image/webp', 'wrong content-type');
  });

  await check('captures full page', async () => {
    const url = `${BASE}/take?url=${encodeURIComponent('https://example.com')}&full_page=true`;
    const res = await fetch(url);
    assert(res.ok, `status ${res.status}`);
  });

  await check('renders a PDF', async () => {
    const url = `${BASE}/take?url=${encodeURIComponent('https://example.com')}&format=pdf`;
    const res = await fetch(url);
    assert(res.ok, `status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.subarray(0, 4).toString() === '%PDF', 'body is not a PDF');
  });

  await check('selector capture works', async () => {
    const url = `${BASE}/take?url=${encodeURIComponent('https://example.com')}&selector=h1`;
    const res = await fetch(url);
    assert(res.ok, `status ${res.status}`);
  });

  await check('missing selector returns 422, not 500', async () => {
    const url = `${BASE}/take?url=${encodeURIComponent('https://example.com')}&selector=${encodeURIComponent('#nope-not-here')}`;
    const res = await fetch(url);
    assert(res.status === 422, `expected 422, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'selector_not_found', `got ${body.error.code}`);
  });

  await check('cache: MISS then HIT', async () => {
    // Unique URL per run so a cache populated by an earlier run cannot make
    // the first request a HIT. The cache is on disk and deliberately survives
    // restarts, so the test has to supply its own isolation.
    const fresh = `https://example.com/?smoke=${Date.now()}`;
    const target = `${BASE}/take?url=${encodeURIComponent(fresh)}&cache=true&cache_ttl=300`;
    const first = await fetch(target);
    assert(first.ok, `first status ${first.status}`);
    assert(first.headers.get('x-cache') === 'MISS', `first was ${first.headers.get('x-cache')}`);
    const second = await fetch(target);
    assert(second.headers.get('x-cache') === 'HIT', `second was ${second.headers.get('x-cache')}`);
  });

  await check('SSRF: localhost is refused', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('http://localhost:22')}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'private_address', `got ${body.error.code}`);
  });

  await check('SSRF: cloud metadata IP is refused', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'private_address', `got ${body.error.code}`);
  });

  await check('SSRF: RFC1918 is refused', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('http://192.168.1.1/')}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await check('non-http scheme is refused', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('file:///etc/passwd')}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'unsupported_scheme', `got ${body.error.code}`);
  });

  await check('missing url returns a helpful 400', async () => {
    const res = await fetch(`${BASE}/take`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'missing_url', `got ${body.error.code}`);
  });

  await check('bad format is rejected by name', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('https://example.com')}&format=tiff`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(/png, jpeg, webp, pdf/.test(body.error.message), 'message should list valid formats');
  });

  await check('selector + full_page conflict is caught', async () => {
    const res = await fetch(`${BASE}/take?url=${encodeURIComponent('https://example.com')}&selector=h1&full_page=true`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    assert(body.error.code === 'conflicting_options', `got ${body.error.code}`);
  });

  await check('POST with a JSON body works', async () => {
    const res = await fetch(`${BASE}/take`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', format: 'jpeg', quality: 60 }),
    });
    assert(res.ok, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'image/jpeg', 'wrong content-type');
  });

  await check('unknown route explains the real one', async () => {
    const res = await fetch(`${BASE}/screenshot`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    const body = await res.json();
    assert(/GET or POST \/take/.test(body.error.message), 'unhelpful 404');
  });

  await check('signed URLs verify and reject tampering', async () => {
    const { sign } = await import('../src/auth.js');
    const secret = 'test-secret';
    process.env.SIGNING_SECRET = secret;
    const params = { url: 'https://example.com', format: 'png' };
    const sig = sign(params, secret);
    assert(sig.length === 64, 'signature should be 64 hex chars');
    const tampered = sign({ ...params, url: 'https://evil.com' }, secret);
    assert(sig !== tampered, 'signature must cover the url');
  });

  // The extraction script is a string that is only ever parsed inside the
  // browser, so a bad escape in it is invisible to node --check and surfaces
  // as a mysterious timeout at request time. That cost two debugging rounds.
  // Parse it here instead.
  await check('extract script is syntactically valid', async () => {
    const { extractScript } = await import('../src/extract.js');
    for (const opts of [{}, { stripChrome: false }, { maxChars: 500 }]) {
      // eslint-disable-next-line no-new-func
      new Function(extractScript(opts));
    }
  });

  await check('extracts a page as markdown', async () => {
    const res = await fetch(`${BASE}/extract?url=https://example.com&cache=false`);
    assert(res.ok, `expected 200, got ${res.status}`);
    assert(
      res.headers.get('content-type').includes('text/markdown'),
      `expected markdown, got ${res.headers.get('content-type')}`,
    );
    const md = await res.text();
    assert(/^# /m.test(md), 'expected at least one markdown heading');
    assert(md.includes('](https://'), 'expected an absolute markdown link');
    assert(!md.includes('<p'), 'markdown should not carry raw html tags');
  });

  await check('extract returns json when asked', async () => {
    const res = await fetch(`${BASE}/extract?url=https://example.com&response=json&cache=false`);
    assert(res.ok, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.title === 'Example Domain', `unexpected title: ${body.title}`);
    assert(body.chars > 50, 'expected some extracted content');
    assert(typeof body.markdown === 'string', 'expected markdown in the payload');
  });

  await check('max_chars truncates extraction', async () => {
    const res = await fetch(`${BASE}/extract?url=https://example.com&max_chars=40&cache=false`);
    const md = await res.text();
    assert(md.includes('[truncated]'), 'expected a truncation marker');
    assert(md.length < 200, `expected a short result, got ${md.length} chars`);
  });

  await check('extract refuses private hosts too', async () => {
    const res = await fetch(`${BASE}/extract?url=http://127.0.0.1:9/&cache=false`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke run crashed:', err);
  process.exit(1);
});
