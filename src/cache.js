import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';
import { NON_CACHEABLE_PARAMS } from './options.js';

/**
 * Second-level cache.
 *
 * In production the first level is the CDN edge and this is the origin-side
 * store behind it (swap the fs calls for S3/R2 and the shape is unchanged).
 * Both exist because rendering is the only expensive step in the request
 * lifecycle: a cache hit costs approximately nothing and is faster than any
 * competitor's cold render, which makes the cache simultaneously the margin
 * and the latency benchmark.
 *
 * The cache key deliberately excludes access_key and signature. Two customers
 * asking for the same page with the same options share a hit. Getting this
 * wrong is how a hit rate silently collapses to zero.
 */

export function cacheKey(rawParams) {
  const canonical = Object.keys(rawParams)
    .filter((k) => !NON_CACHEABLE_PARAMS.has(k))
    .sort()
    .map((k) => `${k}=${String(rawParams[k])}`)
    .join('&');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function pathsFor(key, format = 'bin') {
  const dir = path.join(config.cacheDir, key.slice(0, 2), key.slice(2, 4));
  return {
    dir,
    body: path.join(dir, `${key}.${format}`),
    meta: path.join(dir, `${key}.json`),
  };
}

export async function get(key) {
  const { meta } = pathsFor(key);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(meta, 'utf8'));
  } catch {
    return null;
  }

  if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
    // Lazy eviction. A sweeper is only worth adding once disk is a real cost.
    const { body } = pathsFor(key, parsed.format);
    await Promise.all([
      fs.rm(meta, { force: true }),
      fs.rm(body, { force: true }),
    ]).catch(() => {});
    return null;
  }

  try {
    const { body } = pathsFor(key, parsed.format);
    const buffer = await fs.readFile(body);
    return { buffer, contentType: parsed.contentType, storedAt: parsed.storedAt };
  } catch {
    return null;
  }
}

export async function set(key, buffer, { contentType, format, ttlSeconds }) {
  if (!ttlSeconds) return;
  const { dir, body, meta } = pathsFor(key, format);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(body, buffer);
    await fs.writeFile(
      meta,
      JSON.stringify({
        contentType,
        format,
        storedAt: Date.now(),
        expiresAt: Date.now() + ttlSeconds * 1000,
        bytes: buffer.length,
      }),
    );
  } catch {
    // A cache write failure must never fail the request - we already have the
    // image the customer asked for.
  }
}

export async function stats() {
  try {
    let files = 0;
    let bytes = 0;
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith('.json')) {
          files += 1;
          bytes += (await fs.stat(full)).size;
        }
      }
    };
    await walk(config.cacheDir);
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

export default { cacheKey, get, set, stats };
