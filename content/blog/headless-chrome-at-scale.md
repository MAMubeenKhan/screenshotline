---
title: Six things that break when you run headless Chrome at scale
description: Almost every failure was a 200 with the wrong picture in it. What 202 real websites taught me about consent banners, network idle, wedged pages, ad holes, blank captures and zombie Chrome - with the code.
date: 2026-09-14T13:00:00Z
---

Taking one screenshot with Puppeteer is twenty minutes of work. Taking a few
million is a different job entirely.

I found that out building [Screenshotline](https://screenshotline.com), a
screenshot API. What surprised me was not how much broke. It was how little of
it looked broken. Almost nothing crashed. The failures were a `200 OK` with the
wrong picture in it — a cookie wall, a half-loaded page, a grey hole, a blank
white frame — which a pipeline records as a success and nobody notices for a
month.

So I built a benchmark of 202 real websites — news sites, shops, SaaS sites,
docs, government pages, sites in other languages and scripts — and ran every
change against it. The failures were consistent enough to be worth writing
down. Here are the six that cost the most, each with the fix and the actual
code, and then the bug that was worse than all of them.

## 1. Consent banners arrive after the page settles

**The symptom.** Your screenshot is a cookie wall, even though you remove
cookie banners.

**Why it happens.** The obvious approach is a sweep at capture time: find the
consent dialog, remove it, take the picture. But many sites inject the banner
*late* — after the page has loaded, sometimes after the network has gone quiet.
nytimes.com is one. A sweep that runs at capture time is simply too early, and
it loses that race every time.

**The fix.** Don't sweep once. Install a watcher before any of the page's own
scripts run, and keep sweeping every time the DOM changes:

```js
await page.evaluateOnNewDocument(COOKIE_OBSERVER_SCRIPT);
```

where the script is, in part:

```js
const schedule = () => {
  if (scheduled) return;
  scheduled = setTimeout(run, 50);
};

const start = () => {
  if (!document.documentElement) return requestAnimationFrame(start);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  run();
};
```

The 50ms debounce matters: a busy page mutates its DOM thousands of times, and
sweeping on every mutation would be pure waste.

One more thing that took a while to find: some consent managers render inside a
**shadow root**, and `querySelectorAll` does not cross a shadow boundary. On
dw.com the sweep was looking straight past a full-page modal. The sweep now
walks open shadow roots too.

## 2. Pages that never go network-idle

**The symptom.** Timeouts on pages that load perfectly well in your browser.

**Why it happens.** `networkidle2` — wait until there are no more than two
network connections for half a second — is the obvious default, and it is
wrong for the real web. Plenty of sites hold a connection open forever for
analytics beacons, long-polling or ad refresh. They painted seconds ago; they
will never be "idle". Across the benchmark, waiting for it caused **18 hard
timeouts**. Waiting for `load` instead gave a median of 23 seconds, because 16
of the 20 SaaS pages in the suite never fire it.

**The fix.** Navigate to `domcontentloaded`, then spend one bounded settle
budget on the things that actually affect the picture — load if it comes soon,
the network going quiet, images and video in view decoding — and capture when
the budget runs out:

```js
response = await page.goto(options.url, { waitUntil: options.waitUntil });
// ...
const deadline = Math.min(
  Date.now() + options.settle,
  startedAt + options.timeout - 6000,
);
```

The second line of that `Math.min` is a lesson on its own: the settle budget has
to leave room for the capture inside the overall timeout, or a page that takes
24 seconds to navigate settles its way straight past a 30-second ceiling.

A fixed budget still can't serve both a static page and a heavy news homepage.
timesofindia.indiatimes.com returned **446 characters** of text with a 5-second settle and
**48,755** with 15 seconds — and the short version came back as a clean 200. So
the settle has an adaptive tail: it keeps waiting while the page's text is still
growing, and stops early once there is plainly enough of it.

## 3. Pages that wedge their own main thread

**The symptom.** A single page times out, and takes a browser down with it.

**Why it happens.** When a page blocks its main thread, everything you ask of it
hangs: `page.evaluate`, `page.screenshot`, and even `page.close()`. None of them
has a timeout of its own. vercel.com did this in the benchmark: the document was
complete at 3.6 seconds, then four JavaScript chunks stayed in flight forever and
the page stopped answering anything. One stuck page burns the whole render
budget.

I blamed this on concurrency for longer than I'd like to admit. Then I ran the
page on its own, with nothing else happening, and watched it hang there too.

**The fix.** Every wait gets its own ceiling. Anything you ask the page for is
optional — a measurement, a sweep — so time it out and carry on with what is
already on screen:

```js
function atMost(promise, ms) {
  return Promise.race([
    promise.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function evaluateAtMost(page, script, ms, fallback = null) {
  return atMost(page.evaluate(script), ms).then((v) => (v === null ? fallback : v));
}
```

And a page that misses one deadline has almost always stopped answering for
good, so after the first miss, stop asking — every further timed-out call is
dead time. The render as a whole has a wall-clock ceiling, and when it fires the
browser process is killed, not politely closed: `close()` waits on the very
thing that hung.

## 4. Blocked ads leave a hole

**The symptom.** You block ads, and the screenshot has a big grey rectangle
pushing the real content below the fold.

**Why it happens.** Blocking the ad request stops the ad. It does not give back
the space: the page reserved that slot's height before the ad arrived, and the
layout keeps it.

**The fix.** After the page has settled, find ad containers that are still
empty and collapse them. The part that matters is not collapsing anything real,
so the matching is strict — whole class-name tokens, never substrings, because
a substring match on "ad" eats `header`, `shadow`, `download` and `gradient`:

```js
for (const token of raw.split(/[^a-z0-9]+/)) {
  if (!token) continue;
  if (AD_TOKENS.has(token)) return true;
  for (const p of AD_PREFIXES) if (token.startsWith(p)) return true;
}
```

and a slot is only collapsed if it has no text, nothing painted inside it, and
is not large enough to be the page itself. It runs *after* the settle, so a slot
that did fill with a house ad is left alone. On france24.com this took the
capture from 122KB to 234KB of actual content.

(A caution about that number: file size is a bad proxy for quality in both
directions. Removing a consent modal makes a capture *smaller*, and one
competitor's larger france24 capture was blurry because it was taken mid-paint.
Open the image. Always open the image.)

## 5. The blank capture

**The symptom.** None, which is the problem. A bot wall or a page that needs
JavaScript you blocked renders a blank white frame, the API returns 200, and your
pipeline files it as a success.

**The fix.** Detect it, and say so in a response header. Neither signal is
trustworthy alone. An empty DOM flags legitimately sparse pages (badssl.com is
one heading on a coloured background), and low bytes-per-pixel flags anything
simple. So both have to agree:

```js
const domBlank = content.textLength < 20 && content.images === 0 && content.elements < 15;
const visuallyBlank = calibrated && bytesPerPixel < 0.008 && content.textLength < 400;
const blankSuspected =
  detectorApplies &&
  options.format !== 'pdf' &&
  (visuallyBlank || (domBlank && (!calibrated || bytesPerPixel < 0.03)));
```

Two details in there each came from a real mistake. `detectorApplies` is false
for a successful response that isn't HTML: Chrome's own JSON or image viewer is
legitimately sparse, and a JSON endpoint was being flagged as a blank capture.
And `calibrated` restricts the pixel signal to the configuration its thresholds
were measured on — a PNG of a normal viewport — because bytes-per-pixel
measures the *encoding* as much as the page. A 3840×4320 capture of a small
page is mostly white whether or not anything went wrong, and a quality-1 JPEG is
tiny whatever it shows.

Honest reporting also meant going through every "hard" page that *passed* by
hand. Of the 20 pages the suite marks as known-hard, 14 returned something. I
opened all 14: 11 were genuinely the real page, 2 were captchas that a naive
count would have scored as wins, and 1 was a dead URL in my own test suite.

## 6. Zombie Chrome

**The symptom.** Throughput slowly collapses and memory climbs, with no obvious
cause.

**Why it happens.** When Chrome crashes mid-render, its child processes are
orphaned. Inside a container, whatever is PID 1 is supposed to reap orphans —
and if PID 1 is your Node process, nothing does. They sit as `<defunct>`
entries forever, while your pool believes those slots are free.

**The fix** is one line, and it cost me an afternoon to find:

```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--"]
```

(`docker run --init`, or `init: true` in Compose, does the same.) Pair it with
recycling each browser after a fixed number of renders, because Chrome does not
give memory back across navigations.

## The bug that had no symptom

Two things I got wrong are worth more than the list above.

The consent-banner heuristic ate apnews.com's entire site header one day. Its
trending strip carried the headline "Girl Scout cookies". The keyword test
matched *cookies*. The action-word test — looking for buttons like "OK" and
"Accept" — matched **ok** inside c-o-**ok**-i-e-s, because I had not put word
boundaries in the regex. One word in a news headline passed both tests, and the
sweep removed a header containing 1,022 links and two `<nav>` elements. The fix
that actually holds is structural rather than lexical: a consent banner is never
the site's navigation.

Then, fixing that, I introduced something worse.

The scripts that run inside the page are built as JavaScript template literals —
backtick strings — so they can be injected with `evaluateOnNewDocument`. Inside a
template literal, a lone `\b` is not a word boundary. It is an escape sequence,
and it collapses into a single **backspace character**, U+0008. So my new,
correct-looking regex:

```js
const SWEEP_BODY = `
  const ACTIONS = /\b(accept|agree|reject|allow|ok)\b/i;
`;
```

compiled, inside the page, into a regex that matched a backspace, which never
appears on a web page. It matched nothing. The whole consent heuristic was
silently dead for two commits. Every test passed. Every page still rendered.
The apnews header "survived" my new guard only because the heuristic had
stopped removing anything at all.

Inside a template literal, every backslash has to be doubled:

```js
const ACTIONS = /\\b(accept|agree|reject|allow|manage|continue|got it|ok|okay)\\b/i;
```

and `\b` is not the only one: `\f`, `\v` and `\0` collapse the same way, and
`\s` quietly becomes the letter `s`. There is now a test that scans every script
we inject for control characters — shown here with escapes, because the real
test file contains the characters themselves:

```js
const collapsed = /[\x00\x08\x0B\x0C]/;
for (const [name, src] of Object.entries(scripts)) {
  const at = src.search(collapsed);
  assert(at === -1, `${name} contains a control character at ${at}`);
}
```

That test is the only reason this class of bug is visible at all. Nothing else
in the system could have noticed: the code was valid, the pages rendered, and
the output was merely *wrong*.

## What I'd tell someone starting

Screenshotline's benchmark numbers today: of the 182 pages in the suite that
should work, all 182 capture correctly, with a median of 5.7 seconds on the
benchmark machine. The other
20 are named as hard, and the ones that return something are checked by eye.

If you need screenshots at volume, you can absolutely build this yourself — every
fix above is a few dozen lines. But you will own this list, and the list grows.
That is the whole case for an API.

Screenshotline is [open source](https://github.com/MAMubeenKhan/screenshotline)
(AGPL-3.0): the renderer that runs the hosted API is the same code, with nothing
held back. If you'd rather someone else's pager went off, the
[hosted version](https://screenshotline.com) has 500 free renders a month and no
card.
