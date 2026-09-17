---
title: Self-hosting a screenshot API with Docker, and what it will cost you
description: Running Screenshotline on your own server - the compose file line by line, sizing the browser pool, locking it down with keys and signed URLs, HTTPS with Caddy, and when the hosted version is the better deal.
date: 2026-09-17T13:00:00Z
---

[Screenshotline](https://screenshotline.com/?ref=blog) is a screenshot API, and
it is open source. The renderer behind the hosted API is the same code that's
in the [repo](https://github.com/MAMubeenKhan/screenshotline), with nothing
held back. So you can run the whole thing yourself.

The repo already has a short [self-hosting guide](https://github.com/MAMubeenKhan/screenshotline/blob/main/SELF-HOSTING.md).
This is the longer version, with the reasons. Most lines in the compose file
are there because something went wrong without them, and knowing what went
wrong is how you tell which ones you can change.

## Should you self-host at all?

First, a plain answer to the question most people are really asking.

**Self-host when** your screenshots have to stay on your own infrastructure,
when you want to read the code before you trust it, or when you need to capture
pages that only exist on your internal network.

**Don't self-host just to save money at low volume.** The hosted free tier is
500 renders a month with no card. Above that, a small VPS costs less per month
than a paid plan, but the server isn't the real cost. Your time is: keeping
Chrome up to date, noticing when renders start failing, and debugging a page
that wedged the browser at 2am. If you'd rather not own that, the hosted API
is the same renderer run by someone else.

If you're still here, let's run it.

## Step 1: run it

```bash
git clone https://github.com/MAMubeenKhan/screenshotline.git
cd screenshotline
docker compose up -d

curl -o out.png "http://localhost:3000/take?url=https://example.com"
```

That's the whole setup. `/take` returns the image bytes directly, with no JSON
wrapper, so the same URL also works inside an `<img src>`.

Then **open `out.png`**. Don't settle for checking that curl exited cleanly or
that the file isn't empty. The failure this project spends most of its code on
is a `200 OK` with the wrong picture in it, and a file size can't tell you
that. Only looking can.

## Step 2: understand the compose file

Here are the parts that matter, and why each one is there.

```yaml
init: true
```

**Reaps zombie Chrome processes.** When Chrome crashes mid-render, its child
processes are orphaned. Inside a container, PID 1 is supposed to reap orphans,
and if PID 1 is your Node process, nothing does. They sit there as `<defunct>`
while the pool believes those slots are free. Throughput slowly collapses with
no obvious cause. The Dockerfile already runs `tini` as PID 1, so `init: true`
is redundant. It's harmless, and it makes the requirement explicit in the
file people actually read.

```yaml
shm_size: "1gb"
```

**Chrome uses `/dev/shm` for shared memory, and Docker's default is 64 MB.**
That's not enough for image-heavy pages. The renderer also passes
`--disable-dev-shm-usage`. Either fix works on its own, and having both does
no harm.

```yaml
volumes:
  - cache:/app/.cache
  - data:/app/.data
```

**Two volumes, and only one of them matters.** The cache can be thrown away and
refilled. `/app/.data` holds the SQLite database with accounts, API key hashes
and usage counters, and it's only used if you turn on `BILLING_ENABLED`. If
that volume is missing, a redeploy silently deletes everything. The app then
comes back up healthy and empty, which is the worst way for it to fail.

```yaml
security_opt:
  - no-new-privileges:true
deploy:
  resources:
    limits:
      memory: 3g
```

**The renderer runs untrusted pages, so treat it that way.** Chrome runs as a
non-root user inside the image. The memory limit means a runaway browser gets
killed inside the container, not somewhere on the rest of your machine.

## Step 3: size the pool

Everything is configured with environment variables. These four decide how
the server behaves under load:

```bash
POOL_SIZE=2                  # concurrent renders, one browser each
MAX_RENDERS_PER_BROWSER=50   # recycle a browser after this many renders
MAX_BROWSER_AGE_MS=1800000   # ...or after 30 minutes, whichever comes first
RENDER_TIMEOUT_MS=30000      # wall-clock ceiling; then the browser is killed
```

**`POOL_SIZE`** is the number of Chrome instances, and each one renders a single
page at a time. One CPU core handles a pool of 1 comfortably. Give it 2 cores
for a pool of 2. Past that, you're mostly buying memory.

**The recycling settings exist because Chrome doesn't give memory back across
navigations.** A browser that has rendered a few hundred pages is much bigger
than a fresh one. In an early five-minute load test with four browsers
recycling every 25 renders, memory rose from 1,344 MB to a peak of 1,619 MB and
ended at 1,150 MB. That was 817 renders with zero failures. The graph was a
sawtooth, not a slope, and the sawtooth is what you want to see. If you raise
`MAX_RENDERS_PER_BROWSER` a long way, expect the slope instead.

**`RENDER_TIMEOUT_MS` is enforced by killing the browser, not by asking it to
stop.** A page that blocks its own main thread also blocks `page.close()`, so
the polite way out hangs as well. Pages that do this are uncommon but real,
and without a hard ceiling one of them takes a pool slot with it.

A good starting point is 2 GB of RAM and a pool of 2. After that, change one
number at a time and watch memory while you do.

## Step 4: lock it down

With no configuration, the API runs in **open mode**: anyone who can reach port
3000 can render anything. That's fine on your laptop, and a bad idea anywhere
else.

**Set access keys.** They're comma-separated, and clients send one as an
`X-Access-Key` header or as `?access_key=`:

```bash
ACCESS_KEYS=key-for-app-one,key-for-app-two
```

**Sign URLs that appear in public HTML.** The main reason to return raw image
bytes is so you can write `<img src="https://screenshots.example.com/take?url=...">`.
But a key in that URL can be read by anyone who views the page source, and
then they can use your server. Signed URLs solve this: set `SIGNING_SECRET`,
and the server accepts a request carrying an HMAC-SHA256 of its own sorted
query parameters. Changing any parameter, including the target URL, breaks the
signature.

```js
import crypto from 'node:crypto';

function signedUrl(base, params, secret) {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  return `${base}?${query}&signature=${signature}`;
}

signedUrl('https://screenshots.example.com/take',
  { url: 'https://example.com', full_page: 'true' }, process.env.SIGNING_SECRET);
```

The repo also has a command-line version: `node tools/sign.js "https://example.com" full_page=true`.
Once every URL you publish is signed, set `REQUIRE_SIGNATURE=true` so unsigned
requests are refused outright.

**Leave `ALLOW_PRIVATE_HOSTS` off, unless you have a reason and have
isolated the server.** By default the renderer refuses private and reserved
addresses: localhost, the RFC 1918 ranges, and the cloud metadata address
`169.254.169.254`. It checks again after every redirect, so a public URL that
redirects inward is refused too. Without that check, a screenshot API is a very
convenient way to read your cloud credentials.

If internal dashboards are your whole reason for self-hosting, that flag is
what you need. But turning it on lets the renderer reach everything on its
network. So it must not also be reachable from the internet, and it should sit
on a network segment where "everything" means very little.

**A known gap: DNS rebinding.** The renderer resolves the hostname to check it,
and then Chrome resolves it again on its own. A DNS record that changes between
those two lookups can get past the check. Literal private IPs are refused for
every subresource, but a hostname that resolves to one is only checked at
navigation. It's documented in
[SECURITY.md](https://github.com/MAMubeenKhan/screenshotline/blob/main/SECURITY.md)
rather than ignored. It's also another reason to run the renderer where there's
nothing worth reaching.

## Step 5: HTTPS with Caddy

Don't expose the Node process directly. Put Caddy in front of it and it gets
and renews certificates on its own:

```
screenshots.example.com {
	reverse_proxy app:3000 {
		transport http {
			read_timeout 120s
			write_timeout 120s
		}
	}
}
```

Two details here matter more than they look.

**The long timeouts.** A slow page can legitimately take 30 seconds to render.
If the proxy gives up first, the client sees a vague `502` instead of the
app's own clear `render_timeout` error. The proxy's timeout should always be
longer than the app's.

**`transport` has to be nested inside `reverse_proxy`.** Written as a sibling
directive, Caddy refuses to start. Under `restart: unless-stopped`, that becomes
a restart loop with nothing on screen to tell you. Run `caddy validate` before
every restart.

Caddy also needs your DNS records pointing at the server *before* it first
starts, because Let's Encrypt checks domain ownership by connecting back to the
machine.

## Step 6: know when it breaks

There are two health endpoints, and they answer different questions.

- **`/healthz`** says the process is answering. It stays green while Chrome is
  broken, so on its own it will tell you everything is fine during an outage.
- **`/healthz/render`** actually renders a page and returns 503 if that fails.
  So it doesn't become a free renderer, it does at most one real render a
  minute, and every other call gets the last result.

Point your uptime monitor at `/healthz/render`. And run the monitor somewhere
other than the server itself. A status check on the same box goes down with
the box, and you only find out once the box is back.

Every capture also carries response headers worth logging. `X-Render-Ms` gives
the render time. `X-Upstream-Status` is the status code the target page
returned. `X-Blank-Suspected` is set when the capture looks blank, judged from both the
page's DOM and how little the encoded image weighs per pixel. Pass
`fail_on_blank=true` to turn that into an error instead of an image.

The 202-site benchmark I use for every change is in the repo under `bench/`,
along with the smoke tests. Run them after upgrading, then look at the images
they write. A suite that counts a captcha as a successful capture is exactly
the kind of failure it exists to catch.

## What you don't get by self-hosting

To be clear about what the repo is: it's the renderer, the API, the cache, and
the optional accounts and billing code. What the hosted version adds is
operational: a warm pool, a shared cache, updates, and someone else watching
it. It doesn't have extra rendering features.

Things neither version does, on purpose: video capture, proxy rotation, getting
past captchas, and async jobs with webhooks. If a site shows a bot wall, you
get a picture of the bot wall. If it's blank, the header tells you.

It's licensed AGPL-3.0. You can run it, modify it, and self-host it freely. If
you offer a modified version to other people over a network, you have to
publish your changes. Calling the API from your own application doesn't make
that application AGPL.

If you run it and something doesn't work on a clean machine, please
[open an issue](https://github.com/MAMubeenKhan/screenshotline/issues). The
compose file working the first time is a promise, and a broken promise is a bug.
If you'd rather not run it at all, the
[hosted version](https://screenshotline.com/?ref=blog) has 500 free renders a
month and doesn't need a card.
