# Self-hosting Screenshotline

A complete, open-source screenshot API you can run yourself. No feature is held
back for the hosted version — the renderer here is the same one that serves
[screenshotline.com](https://screenshotline.com/?ref=github).

This guide is honest about what running it costs, because the failure modes
below are real and you will meet them.

---

## The short version

```bash
git clone https://github.com/MAMubeenKhan/screenshotline.git
cd screenshotline
docker compose up -d

curl -o out.png "http://localhost:3000/take?url=https://example.com"
```

That is the whole setup. If it does not work on a clean machine, that is a bug
worth reporting.

---

## What you actually need

| | |
| --- | --- |
| RAM | **2 GB minimum.** Each Chromium instance peaks near 1 GB before recycling; a 202-page benchmark measured 1,344–1,619 MB at `POOL_SIZE=4` |
| CPU | 1 core runs `POOL_SIZE=1` fine. 2 cores for `POOL_SIZE=2` |
| Disk | 2 GB for the image and Chromium, plus whatever cache you keep |
| Docker | The compose file handles the rest |

A 2 GB VPS costs $3–6/month. **Below roughly 2,000 renders a month that is more
than the hosted Starter plan**, once you count the server — so self-host because
you want control or air-gapping, not to save money.

---

## Configuration

Everything is environment variables. Copy `.env.example` and edit.

```bash
POOL_SIZE=2                  # concurrent renders. One browser each.
MAX_RENDERS_PER_BROWSER=50   # recycle before Chrome's memory climbs
RENDER_TIMEOUT_MS=30000      # wall clock ceiling, then SIGKILL
RATE_LIMIT_PER_MINUTE=60
ACCESS_KEYS=                 # comma separated. Empty = open mode
SIGNING_SECRET=              # required for signed URLs
ALLOW_PRIVATE_HOSTS=false    # never turn this on
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Two you should set before exposing it

**`ACCESS_KEYS`** — with it empty the API is open to anyone who can reach it.
Fine on localhost, never on a public address.

**`SIGNING_SECRET`** plus `REQUIRE_SIGNATURE=true`, if the URLs will appear in
public HTML. The headline use case is `<img src>`, and a raw key in a page
anyone can view-source is a bill waiting to happen.

---

## The six things that break, and how this handles them

These are not hypothetical. Each was found by a benchmark of 202 real pages and
each will bite you if you write your own.

**1. Zombie Chrome processes.** When Chrome crashes mid-render its children are
orphaned. With no init process to reap them they sit as `<defunct>` forever
while your pool believes those slots are free. Throughput collapses and RSS
climbs with no obvious cause. The Dockerfile runs `tini` as PID 1; `docker run
--init` does the same.

**2. Memory that never comes back.** Chrome does not release memory cleanly
across navigations. An instance that starts near 200 MB can pass 1 GB. Browsers
are recycled after `MAX_RENDERS_PER_BROWSER` renders and after
`MAX_BROWSER_AGE_MS`, whichever comes first.

**3. Pages that never go network-idle.** Plenty of real sites hold a socket open
forever — long-polling, analytics beacons, ad refresh — and never satisfy
`networkidle2` even though they painted seconds ago. Waiting for that caused 18
hard timeouts across the benchmark. The default is `domcontentloaded` plus one
bounded settle budget. **This is deliberate; changing it back will cost you
timeouts.**

**4. Pages that wedge their own main thread.** A page can stop answering
entirely. Then `page.evaluate`, `page.screenshot` *and* `page.close` all hang,
with no timeout of their own — one stuck page burns the whole render budget and
takes a browser with it. Every wait here has a ceiling.

**5. Blank captures.** The worst failure is not an error, it is a 200 with a
blank image: your pipeline records success and nobody notices for a month. Two
independent signals — DOM emptiness and encoded bytes-per-pixel — must agree
before a capture is flagged, surfaced as `X-Blank-Suspected`. `fail_on_blank=true`
turns it into a 502.

**6. Consent banners injected after load.** A one-shot sweep loses that race —
the Fides banner on nytimes.com appears after `networkidle` every time. An
observer is installed before any page script runs.

---

## Reverse proxy and HTTPS

Do not expose the renderer directly. Put Caddy in front and it handles
certificates by itself:

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

The long timeouts matter: a render can legitimately take 30 seconds, and a
proxy's default would cut it off before the app's own timeout, turning a clean
`render_timeout` into a confusing 502.

> `transport` must be **nested inside** `reverse_proxy`. As a sibling directive
> Caddy refuses to start, which under `restart: unless-stopped` is a silent
> restart loop. Run `caddy validate` before restarting.

---

## Security

This service renders untrusted pages on your infrastructure. Treat it that way.

- **Private and reserved addresses are refused**, and re-checked after every
  redirect — so it cannot be pointed at `169.254.169.254` or your RFC1918 range.
  `ALLOW_PRIVATE_HOSTS=true` disables that. Only ever for local development.
- **Run it isolated.** Give it no network route to anything you care about. On a
  home network that means a separate VLAN.
- **Chrome does not run as root** in the image.
- Report vulnerabilities per [SECURITY.md](SECURITY.md).

---

## Persistence

If you enable accounts and billing with `BILLING_ENABLED=true`, the SQLite
database at `DB_FILE` holds accounts, API key hashes and usage counters. **Mount
it on a volume.** The image cache can be thrown away and refilled; this cannot,
and a redeploy without a volume deletes it silently while the app comes back up
looking healthy and empty.

```yaml
volumes:
  - data:/app/.data     # accounts, keys, usage — irreplaceable
  - cache:/app/.cache   # regenerable
```

---

## Verifying your install

The quickest check is the one from the top of this file: if `curl` gives you a
PNG, it works.

```bash
curl -o out.png "http://localhost:3000/take?url=https://example.com"
file out.png     # PNG image data, 1280 x 800
```

The suites run **from your clone, on the host** — not inside the container.
`bench/` is deliberately not copied into the image, because a benchmark corpus
is not something a production container should carry. So they need Node and a
one-time `npm install` on the host, and they talk to the container over HTTP:

```bash
npm install                                     # once, on the host
npm test                                        # billing, blocking, options, smoke
npm run smoke                                   # 30 checks against the real render path, ~2 min
npm run bench                                   # 20 deliberately hard pages
node bench/run.js --suite 200 --concurrency 2   # 202 pages, ~10 min
```

The benchmark writes images to `bench/out/`. Look at them — a suite that reports
a successful capture of a blank page is the exact failure this project exists to
catch.

---

## When to use the hosted version instead

Honestly: when you would rather not own the list above. The hosted API at
[screenshotline.com](https://screenshotline.com/?ref=github) is the same renderer with a
warm pool, a cache, and someone else's pager. There is a free tier with no card.

Self-host when you need the data to stay on your infrastructure, when you want
to read the code before trusting it, or when you enjoy this sort of thing.

---

## Licence

AGPL-3.0-or-later. Run it, modify it, self-host it freely. If you offer a
modified version to others over a network, you must publish your changes.
