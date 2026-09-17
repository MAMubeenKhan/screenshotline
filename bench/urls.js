/**
 * The 20 hard pages.
 *
 * These are not a smoke test. They are the decision gate in Phase 1 of the
 * 90-day plan: if your output is not competitive on these, no amount of launch
 * sequencing or SEO fixes it, and you should find out in week two rather than
 * month six.
 *
 * Each entry says what specifically it is meant to break, so that when a
 * capture comes back wrong you know which failure you are looking at rather
 * than squinting at a bad PNG.
 *
 * Replace freely. The list matters less than the discipline of having one.
 */
export const HARD_PAGES = [
  {
    id: 'baseline',
    url: 'https://example.com',
    breaks: 'Nothing. Control case - if this fails, the harness is broken.',
  },
  {
    id: 'cookie-wall-eu-news',
    url: 'https://www.theguardian.com/international',
    breaks: 'Consent overlay + sticky nav + heavy lazy imagery.',
  },
  {
    id: 'cookie-wall-cmp',
    url: 'https://www.bbc.com/news',
    breaks: 'CMP interstitial that blocks paint until dismissed.',
  },
  {
    id: 'lazy-images',
    url: 'https://unsplash.com/t/wallpapers',
    breaks: 'Aggressive lazy loading - below-fold images stay blank without scroll.',
  },
  {
    id: 'infinite-scroll',
    url: 'https://news.ycombinator.com/',
    breaks: 'Dense text, tiny fonts. Checks text rasterisation quality.',
  },
  {
    id: 'spa-late-render',
    url: 'https://react.dev/',
    breaks: 'Client-rendered content that arrives after load fires.',
  },
  {
    id: 'spa-heavy',
    url: 'https://app.slack.com/',
    breaks: 'Redirects to login. Checks redirect handling, not visual output.',
  },
  {
    id: 'custom-fonts',
    url: 'https://fonts.google.com/',
    breaks: 'Webfont loading - captures too early show fallback faces.',
  },
  {
    id: 'sticky-header-fullpage',
    url: 'https://stripe.com/',
    breaks: 'Sticky header that repeats down a naive full-page capture.',
  },
  {
    id: 'ecommerce-grid',
    url: 'https://www.etsy.com/',
    breaks: 'Product grid, lazy images, consent banner, geo interstitials.',
  },
  {
    id: 'scroll-animation',
    url: 'https://linear.app/',
    breaks: 'Scroll-triggered animations parked at opacity 0 until observed.',
  },
  {
    id: 'video-hero',
    url: 'https://vercel.com/',
    breaks: 'Autoplaying video hero - frame timing varies per capture.',
  },
  {
    id: 'long-article',
    url: 'https://en.wikipedia.org/wiki/Portable_Network_Graphics',
    breaks: 'Very tall full-page capture. Memory and stitching limits.',
  },
  {
    id: 'canvas-webgl',
    url: 'https://threejs.org/',
    breaks: 'WebGL canvas - blank without GPU or with the wrong flags.',
  },
  {
    id: 'iframe-embeds',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe',
    breaks: 'Nested iframes and live embedded examples.',
  },
  {
    id: 'paywall',
    url: 'https://www.nytimes.com/',
    breaks: 'Paywall modal + consent + scroll lock on body.',
  },
  {
    id: 'dark-mode',
    url: 'https://github.com/',
    breaks: 'prefers-color-scheme handling.',
    options: { color_scheme: 'dark' },
  },
  {
    id: 'redirect-chain',
    url: 'https://bit.ly/3xYz',
    breaks: 'Shortener redirect chain. Every hop must be re-validated for SSRF.',
  },
  {
    id: 'slow-resource',
    url: 'https://httpbin.org/delay/8',
    breaks: 'Slow response - must hit the timeout cleanly, not hang a slot.',
  },
  {
    id: 'http-error',
    url: 'https://httpbin.org/status/500',
    breaks: 'Upstream 500 - should still capture, and report the status header.',
  },
];

export default HARD_PAGES;
