/**
 * Ad and cookie-banner blocking.
 *
 * Deliberately dependency-free: a hostname blocklist for network requests and
 * a selector/heuristic sweep for consent overlays. A filter-list engine
 * (@ghostery/adblocker) is strictly better and is the natural upgrade, but it
 * adds a runtime download and this needs to work on a plane.
 *
 * Be honest with yourself about this one: cookie-banner blocking is never
 * finished. ScreenshotOne's founder describes the "sophisticated algorithm"
 * behind theirs as years of work. Ship the 80%, keep the pages that beat you
 * in bench/urls.js, and treat that list as the roadmap.
 */

const AD_HOST_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googletagservices.com',
  'adservice.google.',
  'adnxs.com',
  'adsrvr.org',
  'amazon-adsystem.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'zedo.com',
  'sharethrough.com',
  'teads.tv',
  'smartadserver.com',
  'yieldmo.com',
  'indexww.com',
  '33across.com',
];

// Deliberately NOT blocked, despite every ad-blocker list carrying them:
// googletagmanager, google-analytics, hotjar, mixpanel, segment,
// fullstory, mouseflow, clarity.ms, facebook.net.
//
// Those are analytics and tag managers. They render nothing visible, so
// blocking them improves no screenshot - but many sites bootstrap their
// lazy-loading and image pipelines through a tag manager, and blocking
// one silently strips every image from the page.
//
// Measured: timesofindia.indiatimes.com returned 23KB with these blocked
// and 1219KB without, with identical DOM text. A 50x content loss in
// exchange for hiding nothing.

// Consent-management platforms. Blocking the script is more reliable than
// removing the banner it injects, because the banner never gets built.
const CONSENT_HOST_PATTERNS = [
  'cookiebot.com',
  'cookielaw.org',
  'onetrust.com',
  'trustarc.com',
  'quantcast.com',
  'cookieyes.com',
  'iubenda.com',
  'usercentrics.eu',
  'privacy-mgmt.com',
  'consentmanager.net',
  'consensu.org',
  'termly.io',
  'osano.com',
  'didomi.io',
  'ethyca.com',
  'fides-cdn.ethyca.com',
  'funding-choices.com',
  'fundingchoicesmessages.google.com',
];

// Live-chat and support widgets. Same reasoning as the consent list: killing
// the script means the widget is never built, which is more reliable than
// removing an iframe that reinstalls itself.
const CHAT_HOST_PATTERNS = [
  'intercom.io', 'intercomcdn.com', 'intercomassets.com',
  'driftt.com', 'drift.com',
  'crisp.chat',
  'zdassets.com', 'zopim.com',
  'tawk.to',
  'hs-scripts.com', 'usemessages.com',
  'livechatinc.com',
  'tidio.co', 'tidiochat.com',
  'freshchat.com',
  'olark.com',
  'helpscout.net',
  'gorgias.chat',
  'kustomerapp.com',
  'smooch.io',
  'chatra.io',
  'jivosite.com', 'jivochat.com',
  'purechat.com',
];
const hostMatches = (hostname, patterns) =>
  patterns.some((p) => hostname === p || hostname.endsWith(`.${p}`) || hostname.includes(p));

/**
 * Should this subresource be aborted?
 *
 * `pageUrl` matters as much as the lists do. Blocking by host punishes the
 * vendor's own site: crisp.chat serves its marketing page's CSS and images
 * from crisp.chat, so blocking that host rendered their homepage unstyled -
 * 530KB down to 113KB - while a customer site embedding the same widget from
 * client.crisp.chat is still blocked correctly. A page's own domain is never
 * a third-party widget, and the same holds for doubleclick.net under
 * block_ads or onetrust.com under block_cookie_banners.
 */
/** Is this host the page's own site? Suffix either way, so www.example.com
 *  and example.com are the same site, and cdn.example.com is too. */
function isSameSite(hostname, pageUrl) {
  if (!pageUrl) return false;
  let pageHost;
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch (e) {
    return false;
  }
  // Drop a leading www. so a page served from www.tawk.to still counts
  // embed.tawk.to as its own. This is an approximation of the registrable
  // domain, not the real thing - a full public-suffix list would be a
  // dependency and a monthly update for a rule whose worst failure is
  // that we block one request we could have allowed.
  const a = hostname.replace(/^www[.]/, '');
  const b = pageHost.replace(/^www[.]/, '');
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
export function shouldBlockRequest(url, { blockAds, blockCookieBanners, blockChats, url: pageUrl }) {
  if (!blockAds && !blockCookieBanners && !blockChats) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (isSameSite(hostname, pageUrl)) return false;

  if (blockAds && hostMatches(hostname, AD_HOST_PATTERNS)) return true;
  if (blockCookieBanners && hostMatches(hostname, CONSENT_HOST_PATTERNS)) return true;
  if (blockChats && hostMatches(hostname, CHAT_HOST_PATTERNS)) return true;
  return false;
}

/**
 * The sweep itself, as source. Shared between the one-shot call and the
 * persistent observer so the two can never drift apart.
 */
const SWEEP_BODY = `
  const SELECTORS = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
    '#cmpbox', '#cmpwrapper', '.cmpbox',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '#usercentrics-root', '#uc-banner-modal',
    '#cookiescript_injected', '#cookie-law-info-bar',
    '#iubenda-cs-banner', '.iubenda-cs-container',
    '#didomi-host', '#didomi-popup', '.didomi-popup-backdrop',
    '#qc-cmp2-container', '.qc-cmp2-container', '#qc-cmp2-ui',
    '#sp_message_container_1', '[id^="sp_message_container"]',
    '.termly-consent-banner', '#termly-code-snippet-support',
    '.osano-cm-window', '.osano-cm-dialog',
    // Ethyca Fides - used by the New York Times among others. Found by the
    // benchmark, not by reading a list; that is what bench/ is for.
    '#fides-banner-container', '#fides-banner', '.fides-banner',
    '#fides-overlay', '.fides-modal-overlay', '.fides-modal-container',
    '.cc-window', '.cookie-consent', '.cookie-banner', '.cookie-notice',
    '#cookie-banner', '#cookie-notice', '#cookieConsent', '#cookie-consent',
    '.gdpr-banner', '.gdpr-consent', '.consent-banner', '.consent-modal',
    '[aria-label*="cookie" i][role="dialog"]',
    '[class*="CookieBanner"]', '[class*="cookie-banner"]',
    '[id*="gdpr" i][class*="banner" i]',
  ];

  const KEYWORDS = /(cookies?|consent|gdpr|ccpa|privacy preferences|privacy choices|we value your privacy|your privacy|tracking technolog|vendors? use)/i;
  // Word boundaries are load-bearing. Without them 'ok' matches inside
  // 'cookies', so the single word 'cookies' in a headline satisfied both
  // this test and KEYWORDS - which is how apnews.com lost its site header
  // to the trending story 'Girl Scout cookies'.
  const ACTIONS = /\\b(accept|agree|reject|allow|manage|continue|got it|ok|okay)\\b/i;

  // Text that can only be a consent notice. Used to accept a NARROWER
  // element than the general size floor allows: scmp.com's bar is 611px on
  // a 1280 viewport, just under the 50% floor, and sat over the page in
  // every capture. Widening the floor for everything would start eating
  // real UI, so the floor moves only for text this unambiguous.
  const STRONG = /(we use cookies|uses cookies|cookie policy|accept (all )?cookies|by clicking .?accept|consent to (the use of )?cookies)/i;

  // Every root worth searching: the document plus every open shadow root,
  // recursively.
  //
  // querySelectorAll does not cross a shadow boundary, and modern consent
  // platforms live inside one - dw.com's dialog is #cmpbox from
  // consentmanager.net, rendered in a shadow root, so the sweep looked
  // straight past it. That was the whole of dw's content gap: not a lazy
  // image and not a blocked request, a full-page modal we could not see.
  function allRoots() {
    const roots = [document];
    const seen = new Set();
    const visit = (root) => {
      let els;
      try { els = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) {
        const sr = el.shadowRoot;
        if (sr && !seen.has(sr)) {
          seen.add(sr);
          roots.push(sr);
          visit(sr);
        }
      }
    };
    visit(document);
    return roots;
  }

  function sweep() {
    if (!document.body) return 0;
    const roots = allRoots();
    let removed = 0;

    for (const root of roots) {
      for (const sel of SELECTORS) {
        let nodes;
        try { nodes = root.querySelectorAll(sel); } catch (e) { continue; }
        for (const el of nodes) { el.remove(); removed++; }
      }
    }

    // Heuristic pass: overlays anchored to a viewport edge whose text reads
    // like a consent notice.
    //
    // Do NOT gate this on a high z-index. First-party banners routinely
    // compute to z-index:auto or 1 - the Fides banner above is z-index 1 - and
    // an earlier version of this that required z >= 100 let them all through.
    // Anchoring plus keywords plus a size floor is the signal; stacking order
    // is not.
    const vh = window.innerHeight || 800;
    const vw = window.innerWidth || 1280;

    const candidates = roots.flatMap((root) => {
      try {
        return [...(root === document
          ? document.querySelectorAll('body *')
          : root.querySelectorAll('*'))];
      } catch (e) {
        return [];
      }
    });

    for (const el of candidates) {
      if (removed > 40) break;

      let style;
      try { style = getComputedStyle(el); } catch { continue; }
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Absolute floor. Below this it is a button, not a banner.
      if (rect.width < vw * 0.25 || rect.height < 24) continue;
      const wideEnough = rect.width >= vw * 0.5 && rect.height >= 40;

      const nearTop = rect.top <= 8;
      const nearBottom = rect.bottom >= vh - 8;
      const isModal = rect.top > 8 && rect.bottom < vh - 8;
      if (!nearTop && !nearBottom && !isModal) continue;

      // A consent banner is not the site navigation. This is the strongest
      // signal available and it costs one query: the AP header the
      // heuristic used to eat holds 1,022 links and two <nav> elements,
      // where a consent dialog has a handful of links and no nav at all.
      // Checked before the text tests because it is cheaper to be sure
      // about structure than to reason about words.
      if (el.querySelector('nav, [role="navigation"]')) continue;
      if (el.querySelectorAll('a').length > 12) continue;

      const fullText = el.innerText || '';
      // A consent banner is short. Anything carrying real page content is
      // not one, however many times it says "cookies" - france24.com lost
      // 1,200 characters of article text to an earlier version of this.
      if (fullText.length > 1500) continue;
      const text = fullText.replace(/\\s+/g, ' ').slice(0, 1200);
      if (!KEYWORDS.test(text)) continue;
      // A narrow element has to earn it: unambiguous consent wording,
      // and a short notice rather than a paragraph of page content.
      if (!wideEnough && !(STRONG.test(text) && text.length < 400)) continue;
      // An informational footer mentioning cookies is not a consent wall; a
      // consent wall always offers you a button.
      if (!ACTIONS.test(text)) continue;
      // Never eat the whole page.
      if (rect.height >= vh * 0.97 && rect.width >= vw * 0.97 && text.length > 1100) continue;

      el.remove();
      removed++;
    }

    // Banners commonly lock scrolling. Full-page capture needs it back.
    for (const node of [document.documentElement, document.body]) {
      if (!node) continue;
      node.style.setProperty('overflow', 'auto', 'important');
      node.style.setProperty('position', 'static', 'important');
      node.classList.remove('modal-open', 'no-scroll', 'noscroll', 'overflow-hidden');
    }

    return removed;
  }
`;

/** One-shot sweep, for an explicit call at a known point. */
export const COOKIE_SWEEP_SCRIPT = `(() => {${SWEEP_BODY}
  return sweep();
})()`;

/**
 * Persistent sweep, installed before any page script runs.
 *
 * Consent banners are frequently injected *after* networkidle fires - the
 * Fides banner on nytimes.com is a good example, and it beat a one-shot sweep
 * every time. A MutationObserver wins that race without adding a fixed delay
 * to every request, which is the alternative and costs latency on every
 * capture to fix a problem only some pages have.
 */
export const COOKIE_OBSERVER_SCRIPT = `(() => {${SWEEP_BODY}
  let scheduled = null;
  const run = () => { scheduled = null; try { sweep(); } catch (e) {} };
  const schedule = () => {
    if (scheduled) return;
    scheduled = setTimeout(run, 50);
  };

  const start = () => {
    if (!document.documentElement) return requestAnimationFrame(start);
    try {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
    run();
  };

  start();
  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
  // Exposed so the renderer can force a final pass immediately before capture.
  window.__screenshotlineSweep = run;
})()`;

/**
 * Collapse ad slots we emptied ourselves.
 *
 * Aborting an ad request does not reclaim its space. The slot is a real
 * element with a reserved height, so the page keeps a grey hole exactly where
 * the ad would have been and pushes the actual content below the fold.
 *
 * Measured on a 1280x800 viewport with block_ads=true:
 *   france24  div.o-ad-container--banner-top          1280x296, 0 chars
 *   bbc/news  div.AdSlot-styles__AdSlotContainerStyled 1280x278, 0 chars
 * Both sit directly under the nav. ScreenshotOne's capture of the same pages
 * has no gap, which is most of why its frames carried more visible content
 * than ours on the head-to-head.
 *
 * This is deliberately narrow, because over-removal is the recurring bug in
 * this file. Every one of these must hold before anything is hidden:
 *   - block_ads is on, so the hole is one we made
 *   - the element names itself an ad slot, by class, id or attribute
 *   - it holds no text at all
 *   - nothing inside it actually painted (no decoded image, no sized frame)
 *   - it is big enough to matter and small enough not to be the page
 * Hidden with display:none rather than removed: same visual result, but it
 * cannot disturb sibling indexes or :nth-child rules.
 */
const AD_SLOT_BODY = `
  // Whole-token matches. Substring matching on "ad" is how you eat "header",
  // "shadow", "download" and "gradient", so tokens are compared exactly.
  const AD_TOKENS = new Set([
    'ad', 'ads', 'advert', 'adverts', 'advertisement', 'advertising',
    'adsense', 'adslot', 'adunit', 'adbox', 'adcontainer', 'adwrapper',
    'adspace', 'adregion', 'adzone', 'dfp', 'gpt', 'googlead', 'googleads',
    'sponsored', 'leaderboard', 'skyscraper', 'mpu', 'billboard',
  ]);
  // Hashed class names run the words together - BBC ships
  // "AdSlotContainerStyled-sc-4b576bed-0" - so allow a known prefix too.
  const AD_PREFIXES = [
    'adslot', 'adunit', 'adcontainer', 'adwrapper', 'adbox', 'adspace',
    'advert', 'googlead', 'dfpad',
  ];

  function namesItselfAnAd(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    const raw = (cls + ' ' + (el.id || '')).toLowerCase();
    if (!raw.trim()) {
      return el.hasAttribute('data-ad-slot') || el.hasAttribute('data-google-query-id');
    }
    for (const token of raw.split(/[^a-z0-9]+/)) {
      if (!token) continue;
      if (AD_TOKENS.has(token)) return true;
      for (const p of AD_PREFIXES) if (token.startsWith(p)) return true;
    }
    return el.hasAttribute('data-ad-slot') || el.hasAttribute('data-google-query-id');
  }

  // "Painted" means a decoded image or a frame with real dimensions. An
  // <img> whose request we aborted has naturalWidth 0 and does not count.
  function somethingPainted(el) {
    for (const img of el.querySelectorAll('img')) {
      if (img.naturalWidth > 8 && img.naturalHeight > 8) return true;
    }
    for (const f of el.querySelectorAll('iframe, video, canvas, object, embed')) {
      const r = f.getBoundingClientRect();
      if (r.width > 32 && r.height > 32) return true;
    }
    return false;
  }

  function collapseAdSlots() {
    if (!document.body) return 0;
    const docHeight = Math.max(document.documentElement.scrollHeight || 0, 1);
    let collapsed = 0;

    for (const el of document.querySelectorAll('div, section, aside, ins, figure')) {
      if (collapsed >= 30) break;
      if (!namesItselfAnAd(el)) continue;
      if ((el.innerText || '').trim().length > 0) continue;

      let style;
      try { style = getComputedStyle(el); } catch (e) { continue; }
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rect = el.getBoundingClientRect();
      if (rect.height < 40 || rect.width < 120) continue;
      // Never collapse something large enough to be the page itself.
      if (rect.height > docHeight * 0.6) continue;
      if (somethingPainted(el)) continue;

      // Hide the outermost empty ad box, not each nested child of one.
      let inner = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.dataset && p.dataset.screenshotlineAdCollapsed === '1') { inner = true; break; }
      }
      if (inner) continue;

      el.dataset.screenshotlineAdCollapsed = '1';
      el.style.setProperty('display', 'none', 'important');
      collapsed++;
    }

    return collapsed;
  }
`;

/**
 * Chat and support widgets.
 *
 * Blocking the host handles most of these, but three cases need a DOM pass:
 * a self-hosted build, a widget already inlined into the page, and one whose
 * CDN we do not know. These are all identified by a stable container id -
 * unlike consent banners, chat vendors do not fight removal, so no heuristic
 * is needed and none is used. A wrong guess here would delete page content
 * to hide a button.
 */
const CHAT_SWEEP_BODY = `
  const SELECTORS = [
    '#intercom-container', '#intercom-frame', '.intercom-lightweight-app',
    '.intercom-namespace',
    '#drift-widget-container', '#drift-frame-controller', '#drift-frame-chat',
    '.drift-frame-controller', '.drift-frame-chat',
    '#crisp-chatbox', '.crisp-client',
    'iframe#launcher', '#webWidget', 'iframe[data-product="web_widget"]',
    '#tawkchat-container', '.tawk-min-container',
    '#hubspot-messages-iframe-container',
    '#chat-widget-container',
    '#tidio-chat',
    '#fc_frame', '#freshworks-container',
    '#olark-wrapper', '#olark-container',
    '#beacon-container', '.BeaconFabButtonFrame',
    '#gorgias-chat-container', '#gorgias-chat-messenger-iframe',
    '#web-messenger-container',
    '#chatra', '#podium-website-widget',
    'jdiv',
    'iframe[title*="chat" i]', 'iframe[title*="Messaging window" i]',
    '[class*="chat-widget"]', '[id*="chat-widget"]',
  ];

  function sweep() {
    if (!document.body) return 0;
    let removed = 0;
    for (const sel of SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) { el.remove(); removed++; }
    }
    return removed;
  }
`;

/** One-shot chat sweep, for the pass immediately before capture. */
export const CHAT_SWEEP_SCRIPT = `(() => {${CHAT_SWEEP_BODY}
  return sweep();
})()`;

/**
 * Persistent chat sweep. Chat widgets load late by design - most vendors
 * defer until after load so they do not slow the host page down - so a
 * one-shot pass at capture time would miss the common case.
 */
export const CHAT_OBSERVER_SCRIPT = `(() => {${CHAT_SWEEP_BODY}
  let scheduled = null;
  const run = () => { scheduled = null; try { sweep(); } catch (e) {} };
  const schedule = () => {
    if (scheduled) return;
    scheduled = setTimeout(run, 50);
  };
  const start = () => {
    if (!document.documentElement) return requestAnimationFrame(start);
    try {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
    run();
  };
  start();
  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
})()`;
/**
 * Promotional interstitials: donation appeals, newsletter sign-ups,
 * app-install prompts, subscription offers.
 *
 * This is the other half of the apnews problem. Its 'This is not a paywall /
 * DONATE NOW' bar is 280px of fixed overlay that appears on some loads and
 * not others, which is why that page swung between 123KB and 404KB run to
 * run. It contains no consent vocabulary at all, so the cookie sweep never
 * touched it, and nondeterministic output is worse than consistently
 * mediocre output - a customer cannot tell a bad capture from a bad page.
 *
 * Same shape as the consent heuristic and the same guards, because the same
 * mistake is available here: a promo bar is short, edge-anchored and offers
 * a button, and anything holding real page content or the site navigation is
 * not one however often it says 'subscribe'.
 */
const PROMO_SWEEP_BODY = `
  const SELECTORS = [
    // Brightspot's notification bar, used by AP and a good many other news
    // sites running the same CMS.
    '.bcpNotificationBar',
    // Wikipedia's fundraising overlay on the www.wikipedia.org portal: a
    // 500x640 fixed panel with 1,700 characters of appeal, plus a fixed strip
    // at the bottom edge, both inside #portalBanner_<campaign>. It fails
    // three of the heuristic's guards at once - too narrow, too tall, too
    // much text - and loosening any of them is how this sweep once ate a
    // news site's header. Named instead, like the AP bar. The campaign
    // suffix changes (portalBanner_en6C_2627_0907_1 on 2026-09-11), hence
    // the prefix match.
    '[id^="portalBanner_"]',
  ];

  const KEYWORDS = /(not a paywall|support (our|independent|local|quality) journalism|donate|donation|newsletter|subscribe|subscription|sign up for|get the app|install the app|open in (the )?app|free trial|special offer|limited time)/i;
  const ACTIONS = /\\b(donate|subscribe|sign up|join|get the app|no thanks|maybe later|not now|dismiss|close|continue reading)\\b/i;

  function sweep() {
    if (!document.body) return 0;
    let removed = 0;

    for (const sel of SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) { el.remove(); removed++; }
    }

    const vh = window.innerHeight || 800;
    const vw = window.innerWidth || 1280;

    for (const el of document.querySelectorAll('body *')) {
      if (removed > 20) break;

      let style;
      try { style = getComputedStyle(el); } catch (e) { continue; }
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < vw * 0.5 || rect.height < 40) continue;
      // A promo bar is a strip or a small modal, never most of the page.
      if (rect.height > vh * 0.75) continue;

      const nearTop = rect.top <= 8;
      const nearBottom = rect.bottom >= vh - 8;
      const isModal = rect.top > 8 && rect.bottom < vh - 8;
      if (!nearTop && !nearBottom && !isModal) continue;

      // Same structural guards as the consent sweep, for the same reason.
      if (el.querySelector('nav, [role="navigation"]')) continue;
      if (el.querySelectorAll('a').length > 12) continue;

      const fullText = el.innerText || '';
      // Tighter than the consent limit. These are a headline and a sentence.
      if (fullText.length > 800) continue;
      const text = fullText.replace(/\\s+/g, ' ');
      if (!KEYWORDS.test(text)) continue;
      if (!ACTIONS.test(text)) continue;

      el.remove();
      removed++;
    }

    return removed;
  }
`;

/** One-shot promo sweep, for the pass immediately before capture. */
export const PROMO_SWEEP_SCRIPT = `(() => {${PROMO_SWEEP_BODY}
  return sweep();
})()`;

/** Persistent promo sweep. These are injected on a timer far more often
 *  than consent banners are - the AP bar waits several seconds. */
export const PROMO_OBSERVER_SCRIPT = `(() => {${PROMO_SWEEP_BODY}
  let scheduled = null;
  const run = () => { scheduled = null; try { sweep(); } catch (e) {} };
  const schedule = () => {
    if (scheduled) return;
    scheduled = setTimeout(run, 50);
  };
  const start = () => {
    if (!document.documentElement) return requestAnimationFrame(start);
    try {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
    run();
  };
  start();
  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
})()`;
/** Run immediately before capture, only when block_ads is on. */
export const AD_SLOT_COLLAPSE_SCRIPT = `(() => {${AD_SLOT_BODY}
  return collapseAdSlots();
})()`;

export default {
  shouldBlockRequest,
  CHAT_SWEEP_SCRIPT,
  CHAT_OBSERVER_SCRIPT,
  PROMO_SWEEP_SCRIPT,
  PROMO_OBSERVER_SCRIPT,
  COOKIE_SWEEP_SCRIPT,
  COOKIE_OBSERVER_SCRIPT,
  AD_SLOT_COLLAPSE_SCRIPT,
};
