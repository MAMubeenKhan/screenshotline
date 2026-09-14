import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { pageShell } from './landing-pages.js';

/**
 * The blog: Markdown files in content/blog/, one per post, rendered with the
 * same frame as the keyword and comparison pages.
 *
 * Why it lives on screenshotline.com rather than only on Dev.to: an article
 * published elsewhere earns rankings for that site's domain. Published here
 * and cross-posted with a canonical link back (Dev.to imports the RSS feed as
 * drafts and can mark this URL as the original), the article's search value
 * accrues here for years.
 *
 * A post is a file with front matter:
 *
 *   ---
 *   title: Six things that break when you run headless Chrome at scale
 *   description: One sentence for search results and link previews.
 *   date: 2026-09-14T12:00:00Z
 *   ---
 *   Markdown...
 *
 * `date` is also the publish time. A post dated in the future is invisible -
 * not listed, not in the sitemap or feed, 404 at its URL - until that moment,
 * so a post can be deployed ahead and go live without anyone deploying on the
 * day. Add ?preview=1 to read a scheduled post; that view is noindex.
 *
 * Posts are written by us, so raw HTML in them is allowed. Files are read once
 * at boot: a new post needs a deploy, which is the review step anyway.
 */

const DIR =
  process.env.BLOG_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'blog');
const SITE = process.env.PUBLIC_BASE_URL || 'https://screenshotline.com';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const longDate = (d) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One post from its file contents. Pure, so the tests can feed it text. */
export function parsePost(text, file) {
  // Git on this machine checks files out with CRLF; a \r left in a code
  // block would ship to every reader.
  const raw = String(text).replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`blog: ${file} has no front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  for (const key of ['title', 'description', 'date']) {
    if (!meta[key]) throw new Error(`blog: ${file} front matter needs "${key}"`);
  }
  const date = new Date(meta.date);
  if (Number.isNaN(date.getTime())) throw new Error(`blog: ${file} has an unreadable date`);
  const words = m[2].split(/\s+/).filter(Boolean).length;
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.title,
    description: meta.description,
    date,
    minutes: Math.max(1, Math.round(words / 230)),
    html: marked.parse(m[2]),
  };
}

let loaded = null;
function allPosts() {
  if (!loaded) {
    loaded = fs.existsSync(DIR)
      ? fs
          .readdirSync(DIR)
          .filter((f) => f.endsWith('.md'))
          .map((f) => parsePost(fs.readFileSync(path.join(DIR, f), 'utf8'), f))
          .sort((a, b) => b.date - a.date)
      : [];
  }
  return loaded;
}

export function publishedPosts(now = Date.now()) {
  return allPosts().filter((p) => p.date.getTime() <= now);
}

const EXTRA_CSS = `  .post-meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--ink-3);margin:26px 0 0}
  .post-meta a{color:var(--ink-3)}
  .post-body h2{margin:40px 0 10px}
  .post-body h3{font-size:17px;margin:28px 0 8px}
  .post-body img{max-width:100%;height:auto;border-radius:6px;border:1px solid var(--rule)}
  .post-body blockquote{margin:18px 0;padding:2px 16px;border-left:2px solid var(--accent);color:var(--ink-2)}
  .post-body pre code{background:none;border:0;padding:0;white-space:pre;font-size:13px}
  .post-body table{display:block;overflow-x:auto}
  .scheduled{background:var(--accent-soft);border:1px solid var(--accent);border-radius:6px;padding:10px 14px;margin:18px 0 0;font-size:14px}
  .post-list{list-style:none;padding:0}
  .post-list li{margin:0 0 26px}
  .post-list a.t{font-size:19px;font-weight:600;text-decoration:none}
  .post-list p{margin:4px 0 0;color:var(--ink-2)}
`;

const FEED_LINK = `<link rel="alternate" type="application/rss+xml" title="Screenshotline blog" href="${SITE}/blog/feed.xml">`;

export function blogIndex(now = Date.now()) {
  const posts = publishedPosts(now);
  const list = posts.length
    ? `<ul class="post-list">\n${posts
        .map(
          (p) => `  <li><a class="t" href="/blog/${p.slug}">${esc(p.title)}</a>
    <p class="post-meta" style="margin:4px 0 0"><time datetime="${p.date.toISOString()}">${longDate(p.date)}</time> &middot; ${p.minutes} min read</p>
    <p>${esc(p.description)}</p></li>`,
        )
        .join('\n')}\n</ul>`
    : '<p>The first post, on what actually breaks when you run headless Chrome at scale, is out Monday 14 September.</p>';
  return pageShell({
    title: 'Blog — Screenshotline',
    description: 'Measured, specific writing about screenshotting the real web: headless Chrome at scale, consent banners, blank captures, and what the benchmark found.',
    canonical: `${SITE}/blog`,
    extraCss: EXTRA_CSS,
    extraHead: FEED_LINK,
    body: `<h1>Blog</h1>
<p class="lede">What running headless Chrome against the real web actually involves. Every number measured; every bug one we shipped or nearly did. <a href="/blog/feed.xml">RSS</a></p>
${list}`,
  });
}

export function blogPost(slug, { preview = false, now = Date.now() } = {}) {
  const post = allPosts().find((p) => p.slug === slug);
  if (!post) return null;
  const scheduled = post.date.getTime() > now;
  if (scheduled && !preview) return null;
  const others = publishedPosts(now).filter((p) => p.slug !== slug).slice(0, 5);
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date.toISOString(),
    author: { '@type': 'Person', name: 'Mubeen Khan', url: 'https://mamubeenkhan.github.io/Personal-Website/' },
    publisher: { '@type': 'Organization', name: 'Screenshotline', url: SITE },
    mainEntityOfPage: `${SITE}/blog/${post.slug}`,
  }).replace(/</g, '\\u003c');
  return pageShell({
    title: `${post.title} — Screenshotline`,
    description: post.description,
    canonical: `${SITE}/blog/${post.slug}`,
    extraCss: EXTRA_CSS,
    extraHead:
      FEED_LINK +
      `\n<meta property="og:type" content="article">` +
      `\n<meta property="article:published_time" content="${post.date.toISOString()}">` +
      `\n<script type="application/ld+json">${ld}</script>` +
      (scheduled ? '\n<meta name="robots" content="noindex">' : ''),
    body: `<article>
<p class="post-meta"><a href="/blog">Blog</a> &middot; <time datetime="${post.date.toISOString()}">${longDate(post.date)}</time> &middot; ${post.minutes} min read</p>
${scheduled ? `<p class="scheduled"><strong>Scheduled, not yet public.</strong> Goes live ${post.date.toISOString().replace('T', ' ').slice(0, 16)} UTC. This preview is not indexed.</p>` : ''}
<h1>${esc(post.title)}</h1>
<p class="lede">${esc(post.description)}</p>
<div class="post-body">
${post.html}
</div>
</article>

<div class="ctarow">
  <a class="btn primary" href="/account">Get a free key &mdash; 500 renders a month</a>
  <a class="btn" href="/">Try it without signing up</a>
</div>
${others.length ? `\n<h2>More from the blog</h2>\n<ul>\n${others.map((o) => `  <li><a href="/blog/${o.slug}">${esc(o.title)}</a></li>`).join('\n')}\n</ul>` : ''}`,
  });
}

/** RSS 2.0, full content - what Dev.to's importer reads. */
export function blogFeed(now = Date.now()) {
  const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const items = publishedPosts(now)
    .map(
      (p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}/blog/${p.slug}</link>
    <guid isPermaLink="true">${SITE}/blog/${p.slug}</guid>
    <pubDate>${p.date.toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
    <content:encoded>${cdata(p.html)}</content:encoded>
  </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Screenshotline blog</title>
  <link>${SITE}/blog</link>
  <description>Screenshotting the real web: headless Chrome at scale, measured.</description>
  <language>en</language>
${items}
</channel>
</rss>
`;
}

/** Paths for the sitemap: the index, plus every post already live. */
export function blogSitemapPaths(now = Date.now()) {
  return ['/blog', ...publishedPosts(now).map((p) => `/blog/${p.slug}`)];
}
