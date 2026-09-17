import {
  shouldBlockRequest,
  COOKIE_SWEEP_SCRIPT,
  COOKIE_OBSERVER_SCRIPT,
  AD_SLOT_COLLAPSE_SCRIPT,
  CHAT_SWEEP_SCRIPT,
  CHAT_OBSERVER_SCRIPT,
  PROMO_SWEEP_SCRIPT,
  PROMO_OBSERVER_SCRIPT,
} from './blocking.js';
import { extractScript } from './extract.js';
import { isPublicUrl, assertPublicUrl, isPrivateRequestHost } from './security.js';
import { contentTypeFor } from './options.js';
import config from './config.js';

export class RenderError extends Error {
  constructor(message, code = 'render_failed', status = 502) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Scroll the document to trigger lazy loading, then return to the top.
 *
 * Full-page captures miss below-fold images because nothing ever scrolled and
 * IntersectionObserver never fired. This is the imperfect, universally
 * necessary fix. Bounded by maxFullPageScrolls so an infinite-scroll feed
 * cannot hold the slot forever.
 */
async function scrollThroughPage(page, maxScrolls) {
  await atMost(
    page.evaluate(async (limit) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const step = window.innerHeight * 0.85;
      let previousHeight = 0;
      for (let i = 0; i < limit; i += 1) {
        window.scrollBy(0, step);
        await sleep(120);
        const height = document.body.scrollHeight;
        const atBottom = window.scrollY + window.innerHeight >= height - 2;
        // Stop when we reach the bottom and the page stopped growing.
        if (atBottom && height === previousHeight) break;
        previousHeight = height;
      }
      window.scrollTo(0, 0);
      await sleep(180);
    }, maxScrolls),
    // A wedged main thread must not hold the slot open. maxScrolls steps of
    // ~120ms each, plus room for the layout they trigger.
    maxScrolls * 300 + 2000,
  );
}

/** Race any promise against a deadline. Resolves either way, never throws. */
function atMost(promise, ms) {
  return Promise.race([
    promise.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * page.evaluate, with a ceiling.
 *
 * evaluate runs on the page's main thread. If a page wedges that thread it
 * never returns and never rejects, and every later evaluate inherits the
 * hang, so one stuck page burns the whole render budget and 504s. vercel.com
 * does this: readyState complete at 3.6s, then four Next.js turbopack chunks
 * stay in flight forever and the thread stops answering. Anything we ask the
 * page for after that point is optional - a sweep, a measurement - so time it
 * out and carry on with what is already on screen.
 *
 * A page that misses one deadline has almost always stopped answering for
 * good, so callers track that in a `wedged` flag and stop asking. Every
 * further timed-out call is dead time inside the render budget - on
 * vercel.com the remaining sweeps cost 8.4 more seconds and changed nothing.
 */
function evaluateAtMost(page, script, ms, fallback = null) {
  return atMost(page.evaluate(script), ms).then((v) => (v === null ? fallback : v));
}

async function waitForFonts(page) {
  // document.fonts.ready is a promise that on some pages never resolves - a
  // page still fetching a webfont when we arrive will hang this forever. It
  // was quietly eating the render budget on font-heavy marketing sites and
  // turning them into timeouts. Never await it unbounded.
  await atMost(
    page.evaluate(() => document.fonts?.ready).then(() => null),
    config.fontsTimeoutMs,
  );
}

async function createContext(browser) {
  // Fresh context per request so cookies, storage and service workers from one
  // customer's capture never leak into the next.
  if (typeof browser.createBrowserContext === 'function') {
    return browser.createBrowserContext();
  }
  return browser.createIncognitoBrowserContext();
}

async function doRender(slot, options, startedAt = Date.now()) {
  const context = await createContext(slot.browser);
  let page;

  try {
    page = await context.newPage();

    await page.setUserAgent(options.userAgent);
    await page.setViewport({
      width: options.viewportWidth,
      height: options.viewportHeight,
      deviceScaleFactor: options.deviceScaleFactor,
    });
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: options.colorScheme },
    ]);
    page.setDefaultNavigationTimeout(
      Math.min(config.navigationTimeoutMs, options.timeout - 2000),
    );

    // Certificate override, per page rather than per browser, so one request
    // opting in never loosens TLS validation for anyone sharing the pool.
    if (options.ignoreTlsErrors) {
      const client = await page.createCDPSession();
      await client.send('Security.setIgnoreCertificateErrors', { ignore: true });
    }

    // Session cookies, set before navigation so the very first request
    // carries them - a login wall redirects on the document request, so a
    // cookie set after navigation is already too late. Domain defaults to
    // the target host, which is what a caller pasting a session cookie out
    // of their browser means.
    if (options.cookies) {
      const host = new URL(options.url).hostname;
      await context.setCookie(
        ...options.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || host,
          path: c.path || "/",
        })),
      );
    }

    if (options.basicAuth) {
      const idx = options.basicAuth.indexOf(':');
      await page.authenticate({
        username: options.basicAuth.slice(0, idx),
        password: options.basicAuth.slice(idx + 1),
      });
    }

    if (options.headers) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    // Install the consent sweep before any page script runs. Banners injected
    // after networkidle beat a one-shot sweep; an observer does not.
    if (options.blockCookieBanners) {
      await page.evaluateOnNewDocument(COOKIE_OBSERVER_SCRIPT);
    }

    // Chat widgets and promo bars both arrive late - most chat vendors
    // defer until after load, and the AP donation bar waits several
    // seconds - so these are observers, not a pass at capture time.
    if (options.blockChats) {
      await page.evaluateOnNewDocument(CHAT_OBSERVER_SCRIPT);
    }
    if (options.blockPopups) {
      await page.evaluateOnNewDocument(PROMO_OBSERVER_SCRIPT);
    }

    const blocked = { ads: 0, redirects: 0 };

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();

      // The page the customer asked for is never blocked, whatever list its
      // host is on. Screenshotting crisp.chat with block_chats on used to
      // abort the main document and return a 119-byte error, and block_ads
      // would do the same to doubleclick.net. A blocklist is for the things a
      // page pulls in, not for the page.
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()
          && request.redirectChain().length === 0) {
        request.continue().catch(() => {});
        return;
      }

      // Re-check every navigation hop. A 302 to 169.254.169.254 must not be
      // followed just because the URL the customer submitted was clean.
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        const redirects = request.redirectChain();
        if (redirects.length > 0) {
          isPublicUrl(url).then((ok) => {
            if (ok) {
              request.continue().catch(() => {});
            } else {
              blocked.redirects += 1;
              request.abort('blockedbyclient').catch(() => {});
            }
          });
          return;
        }
      }

      // Subresources to a literal private address, refused without a DNS
      // lookup so this costs nothing on the hot path. A rendered page could
      // always fetch 169.254.169.254 itself, but inject_js turns that from
      // "attacker controls a page" into "attacker has our API", and the
      // result can be painted into the DOM and read straight off the
      // screenshot. Named hosts that resolve into a private range are not
      // covered here - that needs a lookup per request - which is why
      // SELF-HOSTING.md says to give this service no route to anything.
      if (!config.allowPrivateHosts && isPrivateRequestHost(url)) {
        request.abort("blockedbyclient").catch(() => {});
        return;
      }

      if (shouldBlockRequest(url, options)) {
        blocked.ads += 1;
        request.abort('blockedbyclient').catch(() => {});
        return;
      }

      request.continue().catch(() => {});
    });

    // Navigate, but do not treat "never went idle" as a failure.
    //
    // networkidle2 is the right default and the wrong hill to die on: plenty
    // of real sites keep a socket open forever (long-polling, analytics
    // beacons, ad refresh) and never satisfy it even though the page painted
    // seconds ago. Returning a usable capture beats returning a 504 for a page
    // the customer can see perfectly well in their own browser.
    let response = null;
    let waitFallback = false;
    // Set once the page stops answering evaluate. See evaluateAtMost.
    let wedged = false;
    try {
      response = await page.goto(options.url, { waitUntil: options.waitUntil });
    } catch (err) {
      const isTimeout = /timeout/i.test(String(err?.message));
      if (!isTimeout) throw err;

      // A page can still be PARSING and already show everything a visitor
      // would read. ynet.co.il at default options, from the one-core box:
      // synchronous ad scripts hold readyState at 'loading' past the 25s
      // navigation timeout, with the article on screen. Requiring 'loading'
      // to be over turned that into a 504. So a still-loading page qualifies
      // on substantial text alone. Bounded: this is the page's main thread
      // at its busiest, and an unbounded evaluate here could hang the render.
      const painted = await evaluateAtMost(
        page,
        () => {
          const len = document.body ? document.body.innerText.trim().length : 0;
          return document.readyState === 'loading' ? len >= 500 : len > 0;
        },
        config.pageEvalTimeoutMs,
        false,
      );

      if (!painted) throw err;
      waitFallback = true;
    }

    // One shared settle budget, spent in priority order. None of these can
    // fail the request: if the budget runs out we capture what is on screen,
    // which is what the customer would see in their own browser anyway.
    if (options.settle > 0) {
      // Capped by the render budget, exactly like growthDeadline below. It
      // was not, so a page that took 24s to navigate still settled for the
      // full 5s and ran into the 30s ceiling: ndtv.com at default options
      // 504'd at 30.07s where capturing at ~25s would have returned a page.
      const deadline = Math.min(
        Date.now() + options.settle,
        startedAt + options.timeout - 6000,
      );
      let networkQuiet = false;
      const left = () => Math.max(0, deadline - Date.now());

      // 1. Wait for load, if it is going to happen soon.
      const complete = await atMost(
        page.waitForFunction(() => document.readyState === 'complete').then(() => true),
        left(),
      );
      if (!complete) waitFallback = true;

      // 2. Let the network go quiet.
      if (left() > 300) {
        networkQuiet = await atMost(
          page.waitForNetworkIdle({ idleTime: 400, timeout: left() }).then(() => true),
          left(),
        );
        if (!networkQuiet) waitFallback = true;
      }

      // 3. Let in-viewport media finish decoding.
      //
      //    Capturing mid-decode is what produces a technically-successful but
      //    visibly empty screenshot - the worst failure mode, because it
      //    returns 200.
      //
      //    VIDEO COUNTS, and missing that cost a real capture. deccan.ai's
      //    hero is a 1280x784 <video>, not an image, and a video with no
      //    buffered frame paints a black rectangle - indistinguishable from a
      //    broken capture. readyState >= 2 (HAVE_CURRENT_DATA) means there is
      //    a frame to paint. Videos that never load are not waited on past the
      //    settle budget, like everything else here.
      if (left() > 200) {
        await atMost(
          page.waitForFunction(() => {
            const vh = window.innerHeight;
            const inView = (el) => {
              const r = el.getBoundingClientRect();
              return r.top < vh && r.bottom > 0 && r.width > 1 && r.height > 1;
            };
            const imagesReady = [...document.images]
              .filter(inView)
              .every((img) => img.complete);
            const videosReady = [...document.querySelectorAll('video')]
              .filter(inView)
              .every((v) => v.readyState >= 2);
            return imagesReady && videosReady;
          }).then(() => true),
          left(),
        );
      }

      // 4. Let entrance animations finish.
      //
      // A page can be fully loaded and still be visually mid-flight: nav bars
      // fading in, headings un-blurring, hero images sliding up. Capturing
      // then produces a blurred, half-drawn frame that no amount of waiting
      // for the NETWORK would have prevented, because nothing is loading.
      //
      // deccan.ai is the case that forced this: it is quiet at 5s, then runs
      // four entrance animations at about 8s. The default settle exited in
      // the gap, so the capture varied run to run and often had a blurred
      // nav and no hero.
      //
      // INFINITE ANIMATIONS ARE EXCLUDED, and that is the whole trick. That
      // same page rotates a word in its headline forever; waiting for every
      // animation to end would never return. We wait only for the ones that
      // have an end.
      if (left() > 200) {
        await atMost(
          page.waitForFunction(
            () => {
              const pending = document.getAnimations().filter((a) => {
                if (a.playState !== 'running') return false;
                try {
                  return a.effect?.getComputedTiming?.().iterations !== Infinity;
                } catch {
                  // Cannot tell - assume finite, since the wait is bounded
                  // anyway and guessing the other way skips the check.
                  return true;
                }
              });
              return pending.length === 0;
            },
            { polling: 150 },
          ).then(() => true),
          left(),
        );
      }

      // Adaptive tail: keep waiting while the page is still filling in.
      //
      // A fixed budget cannot serve both a static page and a news homepage.
      // timesofindia.indiatimes.com returns 446 characters at settle=5000 and
      // 48,755 at settle=15000 - and the short version came back as a clean
      // 200, which is exactly the silent failure this codebase is trying to
      // eliminate. So rather than raise the default for everyone and ruin p50,
      // watch whether content is still arriving and extend only for the pages
      // that are actually still working.
      const growthDeadline = Math.min(
        Date.now() + config.maxSettleMs,
        // Always leave room for the capture itself inside the render budget.
        startedAt + options.timeout - 6000,
      );
      // Media may only hold the capture for part of the budget.
      //
      // A hero video that is still buffering is worth a short wait. One
      // that will NEVER buffer is not, and news sites are full of them -
      // large autoplay players that headless Chrome never starts. Letting
      // those block the whole settle took news p50 from 6.9s to 10.9s.
      const mediaDeadline = Date.now() + config.mediaWaitMs;
      let lastLength = 0;
      let stableRounds = 0;
      while (Date.now() < growthDeadline) {
        // Bounded, like every other wait on the page in this file.
        //
        // Reading innerText forces a layout, so it runs on the page's main
        // thread - and if that thread is wedged the evaluate never returns
        // and never rejects. vercel.com does exactly this: it reaches
        // readyState complete in 3.6s, then leaves four Next.js turbopack
        // chunks in flight forever and stops answering. This was the one
        // unbounded await left in the settle path, so the whole render hung
        // until the wall-clock ceiling SIGKILLed the browser - a 504 on a
        // page curl fetches in 240ms. Same lesson as document.fonts.ready:
        // never await the page without a ceiling.
        // Ask for media readiness in the SAME poll as the text length.
        //
        // Steps 3 and 4 above check media once, and an element that has not
        // been injected yet reads as ready - querySelectorAll returns nothing
        // and .every() on an empty list is true. deccan.ai builds its hero
        // <video> from script, so on a slow machine that check passed before
        // the video existed and we captured a black rectangle. Re-checking
        // every round closes that window.
        const probe = await evaluateAtMost(
          page,
          () => {
            const vh = window.innerHeight;
            // Only BIG media blocks the capture.
            //
            // The failure this guards against is a large black rectangle
            // where the hero should be. A 16px tracking pixel or a lazy
            // thumbnail that never loads is invisible in the result but, if
            // it counted, would hold every capture to the full settle budget.
            // Re-checked every round because a script-injected <video>
            // does not exist on the first pass. Images are NOT re-checked:
            // they are already covered by the one-shot pass above, and
            // re-testing them each round took news p50 from 6.9s to 12.3s
            // because one lazy thumbnail that never loads holds the whole
            // capture to the settle deadline.
            const big = (el) => {
              const r = el.getBoundingClientRect();
              return r.top < vh && r.bottom > 0 && r.width >= 200 && r.height >= 200;
            };
            const videos = [...document.querySelectorAll('video')].filter(big);
            return {
              len: (document.body?.innerText || '').length,
              mediaReady:
                videos.every((v) => v.readyState >= 2),
            };
          },
          Math.max(250, Math.min(1500, growthDeadline - Date.now())),
          null,
        );
        const len = probe === null ? -1 : probe.len;
        const mediaReady =
          probe === null || Date.now() > mediaDeadline ? true : probe.mediaReady;
        // null is a timeout or a failed evaluate. Either way the page has
        // stopped telling us anything, so stop asking and capture it.
        if (len < 0) {
          wedged = true;
          break;
        }
        // Treat under 5% growth as settled; two consecutive quiet rounds wins.
        // Stability alone is not enough to stop. A page can sit flat for
        // seconds before its content lands - timesofindia holds at 446
        // characters and then jumps to 48,755 - so an early exit needs a
        // second opinion: either the network actually went quiet, or we
        // already have a plausible amount of text.
        // Once there is plainly substantial content, stop watching. The tail
        // exists to rescue under-rendered pages, not to add seconds to pages
        // that are already complete - that trade cost 5 extra timeouts and
        // 2s of p50 across the 202-page sweep on its first outing.
        if (mediaReady && lastLength >= 5000 && len <= lastLength * 1.05) break;
        // Never call it settled while a visible image or video still has
        // no frame to paint - that is the black-hero case.
        const trustworthy = mediaReady && (networkQuiet || lastLength >= 1000);
        if (trustworthy && len > 0 && len <= lastLength * 1.05) {
          stableRounds += 1;
          if (stableRounds >= 2) break;
        } else {
          stableRounds = 0;
          waitFallback = true;
        }
        lastLength = Math.max(lastLength, len);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    if (options.blockCookieBanners && !wedged) {
      await evaluateAtMost(page, COOKIE_SWEEP_SCRIPT, config.pageEvalTimeoutMs);
    }

    if (options.fullPage && !wedged) {
      await scrollThroughPage(page, config.maxFullPageScrolls);
      // Overlays are often re-inserted after scroll handlers fire.
      if (options.blockCookieBanners && !wedged) {
        await evaluateAtMost(page, COOKIE_SWEEP_SCRIPT, config.pageEvalTimeoutMs);
      }
    }

    if (!wedged) await waitForFonts(page);
    if (options.delay) {
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    // Collapse the ad slots we emptied. This runs here, after the settle and
    // any full-page scroll, so a slot that did fill with a house ad or a
    // first-party promo is left alone - only the ones still empty at capture
    // time are hidden.
    if (options.blockAds && !wedged) {
      await evaluateAtMost(page, AD_SLOT_COLLAPSE_SCRIPT, config.pageEvalTimeoutMs);
    }
    // Final sweep immediately before capture. Consent banners are frequently
    // injected late - after load, after first paint, sometimes on a timer - so
    // a single pass right after navigation misses them.
    if (options.blockCookieBanners && !wedged) {
      await evaluateAtMost(page, COOKIE_SWEEP_SCRIPT, config.pageEvalTimeoutMs);
    }
    if (options.blockChats && !wedged) {
      await evaluateAtMost(page, CHAT_SWEEP_SCRIPT, config.pageEvalTimeoutMs);
    }
    if (options.blockPopups && !wedged) {
      await evaluateAtMost(page, PROMO_SWEEP_SCRIPT, config.pageEvalTimeoutMs);
    }

    // Customer injection, applied after the page has settled and after any
    // full-page scroll, so a stylesheet that loads late cannot overwrite it.
    // hide_selector first: hiding is what people reach for, and doing it here
    // rather than in inject_css means the common case needs no CSS at all.
    if (options.hideSelector && !wedged) {
      await evaluateAtMost(
        page,
        `(() => {
          const sels = ${JSON.stringify(options.hideSelector)};
          let n = 0;
          for (const sel of sels.split(",")) {
            const s = sel.trim();
            if (!s) continue;
            let nodes;
            try { nodes = document.querySelectorAll(s); } catch (e) { continue; }
            // visibility, not display: removing an element reflows the page and
            // moves everything below it, which is rarely what someone hiding a
            // cookie bar or a byline actually wants.
            for (const el of nodes) { el.style.setProperty("visibility", "hidden", "important"); n++; }
          }
          return n;
        })()`,
        config.pageEvalTimeoutMs,
      );
    }

    if (options.injectCss && !wedged) {
      await evaluateAtMost(
        page,
        `(() => {
          const el = document.createElement("style");
          el.textContent = ${JSON.stringify(options.injectCss)};
          document.head.appendChild(el);
          return true;
        })()`,
        config.pageEvalTimeoutMs,
      );
    }

    // Bounded like every other evaluate. Customer script is exactly the kind
    // that loops forever, and it must not take the browser with it.
    if (options.injectJs && !wedged) {
      await evaluateAtMost(page, options.injectJs, config.pageEvalTimeoutMs);
    }


    // Extraction path. Same rendered page, read instead of photographed.
    //
    // Bounded like every other evaluate: a wedged page cannot be read any
    // more than it can be captured, and must not hang the request.
    if (options.extract) {
      const extracted = await evaluateAtMost(
        page,
        extractScript({ stripChrome: options.stripChrome, maxChars: options.maxChars }),
        config.extractTimeoutMs,
      );
      if (extracted === null) {
        throw new RenderError(
          'The page stopped responding before its content could be read. Its main thread is blocked. Try settle=0.',
          'extract_timeout',
          504,
        );
      }
      const status = response?.status() ?? 0;
      return {
        extracted,
        contentType: 'text/markdown; charset=utf-8',
        buffer: Buffer.from(extracted.markdown, 'utf8'),
        status,
        upstreamContentType: response?.headers?.()['content-type'] || '',
        blocked,
        waitFallback,
        content: { textLength: extracted.text.length, elements: 0, images: 0 },
        blankSuspected: extracted.chars < 20,
      };
    }

    // The capture itself needs a ceiling too, and it is the one wait we
    // cannot skip.
    //
    // Page.captureScreenshot needs a frame from the compositor. A page that
    // has wedged its main thread never produces one, so the call hangs with
    // no timeout of its own - which is what actually held vercel.com open
    // until the wall-clock ceiling SIGKILLed the browser and dropped it from
    // the pool. Bounded, one stuck page costs a fast, explainable error
    // instead of a dead browser and 45 seconds of a customer's time.
    // Capped, not just bounded by whatever is left of the render budget.
    // A healthy capture takes well under a second; a full-page one, a few.
    // Handing a wedged page the remaining 33 seconds only delays a failure
    // that was certain, and makes it look like a plain render timeout.
    const captureBudget = Math.max(
      3000,
      Math.min(config.captureTimeoutMs, startedAt + options.timeout - Date.now() - 1500),
    );

    let capture;
    if (options.format === 'pdf') {
      capture = page.pdf({
        printBackground: !options.omitBackground,
        width: `${options.viewportWidth}px`,
        height: options.fullPage ? undefined : `${options.viewportHeight}px`,
        preferCSSPageSize: false,
      });
    } else if (options.selector) {
      const element = await page.$(options.selector);
      if (!element) {
        throw new RenderError(
          `No element matched selector "${options.selector}".`,
          'selector_not_found',
          422,
        );
      }
      capture = element.screenshot({
        type: options.format,
        quality: options.quality,
        omitBackground: options.omitBackground,
      });
    } else {
      capture = page.screenshot({
        type: options.format,
        quality: options.quality,
        fullPage: options.fullPage,
        omitBackground: options.omitBackground,
      });
    }

    const buffer = await atMost(capture, captureBudget);
    if (buffer === null) {
      throw new RenderError(
        'The page stopped responding before it could be captured - its main thread is blocked, so the browser never produced a frame. Try settle=0 to capture immediately after load.',
        'capture_timeout',
        504,
      );
    }

    // The upstream content type decides whether the blank detector even
    // applies - see below. Puppeteer lowercases header names.
    const status = response?.status() ?? 0;
    const upstreamContentType = response?.headers?.()['content-type'] || '';

    // Did we actually capture anything?
    //
    // The worst failure mode in this product is not an error, it is a 200 with
    // a blank white image: the customer's pipeline records a success and nobody
    // notices for a month. Bot walls, blocked challenge scripts and pages that
    // render nothing without JS all produce exactly that. Measure it and say so.
    // Bounded too: a wedged page must not turn the blank check into a hang.
    const content = wedged
      ? { textLength: 0, elements: 0, images: 0 }
      : await evaluateAtMost(
      page,
      () => ({
        textLength: (document.body?.innerText || '').trim().length,
        elements: document.body ? document.body.querySelectorAll('*').length : 0,
        images: document.images.length,
      }),
      config.pageEvalTimeoutMs,
      { textLength: 0, elements: 0, images: 0 },
    );

    // Two independent signals, because either alone misses cases.
    //
    // DOM emptiness catches "nothing rendered at all". But a bot wall can put
    // 265 characters of text in the DOM and still paint a blank white frame,
    // which the DOM check happily passes. So also look at how much the encoder
    // had to work: a genuinely blank 1280x800 PNG lands near 0.005 bytes per
    // pixel, while a real screenshot is an order of magnitude denser.
    const pixels =
      options.viewportWidth *
      options.viewportHeight *
      options.deviceScaleFactor *
      options.deviceScaleFactor;
    const bytesPerPixel = pixels > 0 ? buffer.length / pixels : 1;

    // Neither signal is trusted alone. Some real pages are legitimately almost
    // empty - badssl.com is one heading on a coloured background, and DOM
    // emptiness flagged its perfectly good 119KB capture as blank. So an empty
    // DOM only counts when the pixels agree that little was drawn.
    //
    // The detector is calibrated on HTML documents. A 2xx that is not HTML is
    // Chrome's built-in viewer - a JSON body, an XML tree, a bare image - and
    // those are legitimately sparse. httpbin's /cookies and /basic-auth JSON
    // replies (~7KB, 0.0066 bytes/px, 35-46 chars) tripped every signal while
    // being exactly what the customer asked for. A non-2xx still gets checked,
    // because an error page IS a capture failure worth reporting.
    const upstreamOk = status >= 200 && status < 300;
    const isHtmlDocument =
      !upstreamContentType || /^(?:text\/html|application\/xhtml)/i.test(upstreamContentType);
    const detectorApplies = isHtmlDocument || !upstreamOk;

    // The pixel signal is only meaningful in the configuration its thresholds
    // were calibrated on: a PNG of a plain viewport at scale 1, no bigger than
    // the default. Everywhere else, bytes per pixel measures the encoding and
    // the canvas size, not the page - and that was exploitable. On example.com
    // (129 chars, a complete capture), a 3840x4320 viewport, JPEG or WebP at
    // quality=1, and selector=h1 each flagged the capture blank, so it was
    // delivered unbilled. A genuinely blank 3840x4320 PNG is 58.7KB against
    // 64.9KB for the real one: at that size no byte threshold separates them.
    // Outside the calibrated case, only an empty DOM counts.
    const calibrated =
      options.format === 'png' &&
      !options.selector &&
      !options.fullPage &&
      options.deviceScaleFactor === 1 &&
      options.viewportWidth * options.viewportHeight <= 1280 * 800;
    const domBlank = content.textLength < 20 && content.images === 0 && content.elements < 15;
    const visuallyBlank = calibrated && bytesPerPixel < 0.008 && content.textLength < 400;
    const blankSuspected =
      detectorApplies &&
      options.format !== 'pdf' &&
      (visuallyBlank || (domBlank && (!calibrated || bytesPerPixel < 0.03)));
    content.bytesPerPixel = Number(bytesPerPixel.toFixed(5));

    return {
      buffer: Buffer.from(buffer),
      contentType: contentTypeFor(options.format),
      status,
      upstreamContentType,
      blocked,
      waitFallback,
      content,
      blankSuspected,
    };
  } finally {
    // Close the context, not the browser. The browser is pooled and reused.
    //
    // Bounded, because closing is not safe either. page.close() waits on the
    // renderer, and a page that wedged its main thread never acknowledges it -
    // which is what actually swallowed the capture_timeout above: the error
    // was thrown on time, then sat in this finally block until the wall-clock
    // ceiling fired and reported a plain render_timeout instead. If cleanup
    // does not finish promptly the context is left to the browser recycler,
    // which SIGKILLs rather than waiting on whatever hung.
    if (page) await atMost(page.close(), config.closeTimeoutMs);
    await atMost(context.close(), config.closeTimeoutMs);
  }
}

/**
 * Render with a hard wall-clock ceiling.
 *
 * On expiry the browser is SIGKILLed and dropped from the pool. Calling
 * page.close() here would wait on the very thing that hung, which is how a
 * single slow page turns into a p99 of thirty seconds and then into an outage.
 */
async function renderOnce(pool, options) {
  await assertPublicUrl(options.url);

  const slot = await pool.acquire({ low: Boolean(options.lowPriority) });
  const startedAt = Date.now();
  let timer;
  let timedOut = false;

  try {
    const result = await Promise.race([
      doRender(slot, options, startedAt),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new RenderError(
              `Render exceeded ${options.timeout}ms. Heavy ad and tracking scripts are the usual cause - try block_ads=true, or a longer timeout (up to ${config.maxRenderTimeoutMs}).`,
              'render_timeout',
              504,
            ),
          );
        }, options.timeout);
      }),
    ]);

    clearTimeout(timer);
    pool.release(slot);

    if (options.failOnHttpError && result.status >= 400) {
      throw new RenderError(
        `The target returned HTTP ${result.status}. The capture succeeded; pass fail_on_http_error=false to receive it anyway.`,
        'upstream_http_error',
        502,
      );
    }
    if (options.failOnBlank && result.blankSuspected) {
      throw new RenderError(
        'The page rendered no visible content - it is most likely a bot wall or requires JavaScript we blocked. Try block_ads=false, or pass fail_on_blank=false to receive the image anyway.',
        'blank_capture',
        502,
      );
    }

    return { ...result, renderMs: Date.now() - startedAt };
  } catch (err) {
    clearTimeout(timer);

    // A capture_timeout means the renderer wedged. The context close was
    // bounded and may not have finished, so the browser can still be holding
    // a stuck page - do not hand it to the next customer.
    const browserSuspect =
      timedOut || !slot.browser?.connected || err?.code === 'capture_timeout';
    if (browserSuspect) {
      await pool.discard(slot);
    } else {
      pool.release(slot);
    }

    if (err instanceof RenderError) throw err;

    const message = String(err?.message || err);
    if (/net::ERR_NAME_NOT_RESOLVED/.test(message)) {
      throw new RenderError('Could not resolve the target host.', 'dns_failure', 400);
    }
    if (/net::ERR_CONNECTION_REFUSED/.test(message)) {
      throw new RenderError('The target host refused the connection.', 'connection_refused', 502);
    }
    if (/net::ERR_CERT/.test(message)) {
      throw new RenderError('The target host has an invalid TLS certificate.', 'tls_error', 502);
    }
    if (/Navigation timeout|TimeoutError/i.test(message)) {
      throw new RenderError(
        `The page did not start rendering in time. Heavy ad and tracking scripts are the usual cause - try block_ads=true, or a longer timeout (up to ${config.maxRenderTimeoutMs}).`,
        'navigation_timeout',
        504,
      );
    }
    throw new RenderError(message, 'render_failed', 502);
  }
}

/**
 * Render, with one retry for the wedged-page case.
 *
 * A page that blocks its main thread mid-settle cannot be captured, but the
 * same page captures fine the moment it loads: vercel.com returns a 62KB
 * frame at settle=0 in 865ms, and nothing at all once the turbopack chunks
 * hang. So on capture_timeout - and only then - try once more without the
 * settle. Healthy pages never reach this path, so it costs them nothing.
 *
 * The retry is deliberately not recursive: one failure to capture is a
 * diagnosis, two is a page we cannot serve.
 */
export async function render(pool, options) {
  const startedAt = Date.now();
  try {
    return await renderOnce(pool, options);
  } catch (err) {
    // Extraction wedges for exactly the same reason capture does, so it
    // gets the same second chance.
    const wedgeFailure = err?.code === 'capture_timeout' || err?.code === 'extract_timeout';
    if (!wedgeFailure || options.settle === 0) throw err;
    const result = await renderOnce(pool, { ...options, settle: 0 });
    // Say so in the response. A capture taken before the page finished is
    // still a judgement call the customer deserves to know about.
    // renderMs must cover both attempts, not just the one that worked.
    return { ...result, captureFallback: true, renderMs: Date.now() - startedAt };
  }
}

export default render;
