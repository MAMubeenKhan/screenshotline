# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# tini as PID 1.
#
# This is the one-line fix for the failure that looks like a capacity problem.
# When Chrome crashes mid-render its children are orphaned; without an init
# process to reap them they sit as <defunct> entries forever while the pool
# believes those slots are free. Symptom: throughput collapses and RSS climbs
# with no obvious cause. `docker run --init` does the same thing if you would
# rather not bake it in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
      # puppeteer 25 dropped the extract-zip dependency - that is how the
      # symlink path-traversal advisory was fixed - and it now shells out to
      # the system unzip to unpack the Chromium download. Without this the
      # image does not build at all.
      unzip \
      fonts-liberation \
      fonts-noto-color-emoji \
      fonts-noto-cjk \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libwayland-client0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PUPPETEER_SKIP_DOWNLOAD: npm ci would otherwise download Chromium in
# puppeteer's postinstall. It is fetched explicitly below instead, so it
# happens exactly once and in a step whose failure is legible.
ENV PUPPETEER_CACHE_DIR=/app/.puppeteer \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Fetch the matching Chromium build into the image.
#
# This used to call trimCache() first, to drop stale builds. Under puppeteer
# 25 that removes the executable but leaves the version folder behind, and
# the installer then refuses to touch what it reads as an unfinished install
# - so the image stopped building at all. A fresh image has no stale builds
# to trim, so that call was only ever load-bearing for damage.
RUN npx puppeteer browsers install chrome

COPY src ./src
COPY mcp ./mcp
# Blog posts (Markdown). Without this line the image serves an empty blog -
# every directory the app reads has to be copied explicitly.
COPY content ./content
COPY tools ./tools
# Ships the smoke suite so a self-hoster can verify their own install with
#   docker compose exec app npm run smoke
COPY test ./test

# Chrome must not run as root.
RUN groupadd -r screenshotline && useradd -r -g screenshotline -G audio,video screenshotline \
    && mkdir -p /app/.cache /app/.data /home/screenshotline \
    && chown -R screenshotline:screenshotline /app /home/screenshotline
USER screenshotline

EXPOSE 3000

ENV PORT=3000 \
    HOST=0.0.0.0 \
    POOL_SIZE=2 \
    MAX_RENDERS_PER_BROWSER=50 \
    RENDER_TIMEOUT_MS=30000 \
    CACHE_DIR=/app/.cache \
    DB_FILE=/app/.data/screenshotline.db

# /app/.data MUST be a mounted volume when BILLING_ENABLED is on. It holds
# accounts, API key hashes and usage counters - the only state in this image
# that cannot be regenerated. The cache can be thrown away and refilled; this
# cannot. A redeploy without a volume here silently deletes every customer.
VOLUME ["/app/.data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
