/**
 * Real-world suite: what people actually point a screenshot API at.
 *
 * bench/urls.js is 20 pages chosen to break the *renderer*. This file is
 * different: it is organised by the use cases customers buy this for, so a
 * failure here maps directly onto a customer who churns.
 *
 * `expect` records what we believe should happen. An entry marked
 * 'known-hard' failing is information, not a regression - but it must be a
 * documented decision, not a surprise on a Tuesday.
 */
export const REAL_WORLD = [
  // --- Link previews and social cards -------------------------------------
  // The single most common use case. Someone pastes a URL, you render a card.
  {
    id: 'preview-github-repo',
    category: 'link-preview',
    url: 'https://github.com/nodejs/node',
    expect: 'ok',
    breaks: 'Heavy SPA-ish app shell, deferred file list.',
  },
  {
    id: 'preview-hn-thread',
    category: 'link-preview',
    url: 'https://news.ycombinator.com/item?id=1',
    expect: 'ok',
    breaks: 'Trivial HTML. If this fails something is deeply wrong.',
  },
  {
    id: 'preview-wikipedia',
    category: 'link-preview',
    url: 'https://en.wikipedia.org/wiki/Screenshot',
    expect: 'ok',
    breaks: 'Long article, many images, infobox floats.',
  },
  {
    id: 'preview-reddit',
    category: 'link-preview',
    url: 'https://www.reddit.com/r/programming/',
    expect: 'known-hard',
    breaks: 'Aggressive bot detection on datacenter IPs.',
  },
  {
    id: 'preview-x-post',
    category: 'link-preview',
    url: 'https://x.com/jack/status/20',
    expect: 'known-hard',
    breaks: 'Login wall since 2023. Expect a login interstitial, not content.',
  },
  {
    id: 'preview-linkedin',
    category: 'link-preview',
    url: 'https://www.linkedin.com/company/microsoft/',
    expect: 'known-hard',
    breaks: 'Auth wall plus bot detection.',
  },

  // --- E-commerce monitoring ----------------------------------------------
  {
    id: 'shop-ebay-listing',
    category: 'ecommerce',
    url: 'https://www.ebay.com/b/Laptops-Netbooks/175672',
    expect: 'ok',
    breaks: 'Product grid, lazy images, geo interstitial.',
  },
  {
    id: 'shop-amazon',
    category: 'ecommerce',
    url: 'https://www.amazon.com/dp/B08N5WRWNW',
    expect: 'known-hard',
    breaks: 'CAPTCHA / "Robot Check" on datacenter IPs.',
  },
  {
    id: 'shop-shopify-store',
    category: 'ecommerce',
    url: 'https://www.allbirds.com/',
    expect: 'ok',
    breaks: 'Shopify storefront, video hero, lazy product grid.',
  },
  {
    id: 'shop-booking',
    category: 'ecommerce',
    url: 'https://www.booking.com/',
    expect: 'known-hard',
    breaks: 'Geo redirect, consent wall, bot detection.',
  },

  // --- International: fonts, scripts, direction ---------------------------
  // Missing fonts render as tofu boxes and the capture *succeeds*, so this
  // class of bug is invisible unless you look. Check these images by eye.
  {
    id: 'intl-japanese',
    category: 'international',
    url: 'https://www.yahoo.co.jp/',
    expect: 'ok',
    breaks: 'CJK glyphs. Tofu boxes if noto-cjk is missing from the image.',
  },
  {
    id: 'intl-korean',
    category: 'international',
    url: 'https://www.naver.com/',
    expect: 'ok',
    breaks: 'Hangul rendering, dense layout.',
  },
  {
    id: 'intl-chinese',
    category: 'international',
    url: 'https://www.baidu.com/',
    expect: 'ok',
    breaks: 'Simplified Chinese, may geo-vary.',
  },
  {
    id: 'intl-arabic-rtl',
    category: 'international',
    url: 'https://www.aljazeera.net/',
    expect: 'ok',
    breaks: 'RTL layout plus Arabic shaping. Mirrored layout must hold.',
  },
  {
    id: 'intl-cyrillic',
    category: 'international',
    url: 'https://lenta.ru/',
    expect: 'ok',
    breaks: 'Cyrillic glyph coverage.',
  },
  {
    id: 'intl-emoji',
    category: 'international',
    url: 'https://emojipedia.org/',
    expect: 'ok',
    breaks: 'Colour emoji. Monochrome or tofu if fonts-noto-color-emoji missing.',
  },

  // --- SaaS marketing pages (the typical paying customer's own site) ------
  {
    id: 'saas-notion',
    category: 'saas-marketing',
    url: 'https://www.notion.com/',
    expect: 'ok',
    breaks: 'Scroll-driven animation, late-mounting hero.',
  },
  {
    id: 'saas-figma',
    category: 'saas-marketing',
    url: 'https://www.figma.com/',
    expect: 'ok',
    breaks: 'Canvas-driven hero, heavy webfonts.',
  },
  {
    id: 'saas-tailwind',
    category: 'saas-marketing',
    url: 'https://tailwindcss.com/',
    expect: 'ok',
    breaks: 'Dark-mode aware, lots of inline SVG.',
  },

  // --- Docs and reference (SEO tooling captures these constantly) ---------
  {
    id: 'docs-python',
    category: 'docs',
    url: 'https://docs.python.org/3/library/asyncio.html',
    expect: 'ok',
    breaks: 'Very long page, monospace blocks, anchor sidebar.',
  },
  {
    id: 'docs-mdn',
    category: 'docs',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/position',
    expect: 'ok',
    breaks: 'Live interactive examples in nested iframes.',
  },

  // --- Dashboards and data viz -------------------------------------------
  {
    id: 'viz-observable',
    category: 'dataviz',
    url: 'https://observablehq.com/@d3/gallery',
    expect: 'ok',
    breaks: 'Many concurrent SVG/canvas renders, lazy notebooks.',
  },
  {
    id: 'viz-maps',
    category: 'dataviz',
    url: 'https://www.openstreetmap.org/#map=12/51.5074/-0.1278',
    expect: 'ok',
    breaks: 'Tile loading is async and never hits networkidle cleanly.',
  },
  {
    id: 'viz-codepen',
    category: 'dataviz',
    url: 'https://codepen.io/trending',
    expect: 'ok',
    breaks: 'Grid of live preview iframes.',
  },

  // --- TLS and transport edge cases ---------------------------------------
  // badssl.com exists precisely for this. A customer archiving a legacy
  // internal site WILL hit these, and "we refuse" needs to be a decision.
  {
    id: 'tls-expired-cert',
    category: 'tls',
    url: 'https://expired.badssl.com/',
    expect: 'known-hard',
    breaks: 'Expired certificate. Do we refuse, or offer an opt-in override?',
  },
  {
    id: 'tls-self-signed',
    category: 'tls',
    url: 'https://self-signed.badssl.com/',
    expect: 'known-hard',
    breaks: 'Self-signed certificate.',
  },
  {
    id: 'tls-wrong-host',
    category: 'tls',
    url: 'https://wrong.host.badssl.com/',
    expect: 'known-hard',
    breaks: 'Certificate/hostname mismatch.',
  },
  {
    id: 'transport-plain-http',
    category: 'tls',
    url: 'http://neverssl.com/',
    expect: 'ok',
    breaks: 'Plain HTTP must still work.',
  },

  // --- HTTP semantics -----------------------------------------------------
  {
    id: 'http-404',
    category: 'http',
    url: 'https://httpbin.org/status/404',
    expect: 'ok',
    breaks: 'Should capture the error page and report status in the header.',
  },
  {
    id: 'http-503',
    category: 'http',
    url: 'https://httpstat.us/503',
    expect: 'ok',
    breaks: 'Upstream unavailable - still a valid capture.',
  },
  {
    id: 'http-basic-auth',
    category: 'http',
    url: 'https://httpbin.org/basic-auth/user/passwd',
    expect: 'known-hard',
    breaks: 'Needs credentials. No way to pass them yet - missing feature?',
  },
  {
    id: 'http-redirect-chain',
    category: 'http',
    url: 'https://httpbin.org/redirect/5',
    expect: 'ok',
    breaks: 'Five hops, every one re-validated for SSRF.',
  },
  {
    id: 'http-slow-30s',
    category: 'http',
    url: 'https://httpbin.org/delay/30',
    expect: 'timeout',
    breaks: 'Must fail cleanly at the timeout and free the slot, not hang.',
  },
];

export default REAL_WORLD;
