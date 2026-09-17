/**
 * Blog tests. No browser, no network.
 *
 * Scheduling is tested with an explicit `now` on both sides of each post's
 * date, never against the real clock - a test that passes on Friday and fails
 * the minute a post goes live on Monday would be worse than none.
 *
 *   node test/blog.js
 */
const blog = await import('../src/blog.js');

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

const FOREVER = Date.parse('2100-01-01T00:00:00Z');
const all = blog.publishedPosts(FOREVER);

console.log('\nblog:\n');

await check('every post in content/blog parses and renders', () => {
  assert(all.length >= 1, 'no posts found');
  for (const p of all) {
    assert(p.title && p.description && p.html.length > 500, `${p.slug} is missing content`);
    assert(!Number.isNaN(p.date.getTime()), `${p.slug} has a bad date`);
  }
  assert(all.some((p) => p.slug === 'headless-chrome-at-scale'), 'the launch article is missing');
});

await check('a scheduled post is invisible until its date, then everywhere at once', () => {
  const post = all.find((p) => p.slug === 'headless-chrome-at-scale');
  const before = post.date.getTime() - 1;
  const after = post.date.getTime() + 1;

  assert(blog.blogPost(post.slug, { now: before }) === null, 'readable before its date');
  assert(!blog.publishedPosts(before).some((p) => p.slug === post.slug), 'listed before its date');
  assert(!blog.blogSitemapPaths(before).includes(`/blog/${post.slug}`), 'in the sitemap before its date');
  assert(!blog.blogFeed(before).includes(post.slug), 'in the feed before its date');
  assert(!blog.blogIndex(before).includes(post.slug), 'on the index before its date');

  assert(blog.blogPost(post.slug, { now: after }), 'not readable after its date');
  assert(blog.blogSitemapPaths(after).includes(`/blog/${post.slug}`), 'missing from the sitemap after its date');
  assert(blog.blogFeed(after).includes(`<link>https://screenshotline.com/blog/${post.slug}</link>`), 'missing from the feed');
  assert(blog.blogIndex(after).includes(`/blog/${post.slug}`), 'missing from the index');
});

await check('a preview of a scheduled post says so and is not indexed; the live post is', () => {
  const post = all.find((p) => p.slug === 'headless-chrome-at-scale');
  const preview = blog.blogPost(post.slug, { preview: true, now: post.date.getTime() - 1 });
  assert(preview.includes('Scheduled, not yet public'), 'no scheduled banner');
  assert(preview.includes('<meta name="robots" content="noindex">'), 'a preview must be noindex');
  const live = blog.blogPost(post.slug, { now: post.date.getTime() + 1 });
  assert(!live.includes('noindex'), 'the live post must be indexable');
  assert(live.includes('"@type":"BlogPosting"'), 'missing structured data');
  assert(live.includes('rel="canonical" href="https://screenshotline.com/blog/headless-chrome-at-scale"'), 'wrong canonical');
});

await check('CRLF from a Windows checkout never reaches a reader', () => {
  const p = blog.parsePost('---\r\ntitle: T\r\ndescription: D\r\ndate: 2026-01-01\r\n---\r\n```js\r\nconst a = 1;\r\n```\r\n', 'crlf.md');
  assert(p.title === 'T', 'front matter not read through CRLF');
  assert(!p.html.includes('\r'), 'a carriage return leaked into the HTML');
});

await check('backslashes in code survive exactly - the article is about losing one', () => {
  const bs = String.fromCharCode(92);
  const code = `const ACTIONS = /${bs}${bs}b(ok)${bs}${bs}b/i;`;
  const p = blog.parsePost(`---\ntitle: T\ndescription: D\ndate: 2026-01-01\n---\nInline \`/${bs}b(ok)${bs}b/\`\n\n\`\`\`js\n${code}\n\`\`\`\n`, 'bs.md');
  assert(p.html.includes(code), 'a doubled backslash in a code block was changed');
  assert(p.html.includes(`/${bs}b(ok)${bs}b/`), 'a single backslash in inline code was changed');
});

await check('no rendered post contains a control character', () => {
  const collapsed = new RegExp(`[${String.fromCharCode(0, 8, 11, 12)}]`);
  for (const p of all) assert(!collapsed.test(p.html), `${p.slug} contains a control character`);
});

await check('a post without front matter fails loudly at boot, not silently', () => {
  let err = null;
  try {
    blog.parsePost('# Just markdown', 'nofront.md');
  } catch (e) {
    err = e;
  }
  assert(err && /front matter/.test(err.message), 'expected a front-matter error');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
