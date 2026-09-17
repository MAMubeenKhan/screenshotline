import dns from 'node:dns/promises';
import net from 'node:net';
import config from './config.js';

/**
 * SSRF protection.
 *
 * An endpoint that fetches arbitrary URLs from your infrastructure is a
 * server-side request forgery engine by default. This module is the thing that
 * stops a customer pointing /take at your metadata service or your database.
 *
 * Checked here:
 *   - scheme is http or https
 *   - no embedded credentials
 *   - every resolved address is publicly routable
 *
 * Also enforced in render.js on every navigation request, so a 302 to
 * 169.254.169.254 is rejected mid-flight rather than only at submit time.
 *
 * Known limitation: this resolves and then Chrome resolves again, so a DNS
 * entry that changes between the two calls (DNS rebinding) is not fully
 * closed off. Closing it properly means pinning the resolved IP and forcing
 * Chrome to connect to it via --host-resolver-rules. Worth doing before you
 * take enterprise money; documented rather than silently ignored.
 */

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local: cloud metadata lives here
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const v4ToInt = (ip) =>
  ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;

function isPrivateV4(ip) {
  const addr = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (v4ToInt(base) & mask);
  });
}

function isPrivateV6(ip) {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === '::' || a === '::1') return true;
  if (a.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(a)) return true; // unique local fc00::/7
  if (a.startsWith('ff')) return true; // multicast
  // IPv4-mapped, in both spellings. ::ffff:10.0.0.1 is what a human writes,
  // but the WHATWG URL parser rewrites it to ::ffff:a00:1 - so
  // http://[::ffff:10.0.0.1]/ arrives here already in hex, and matching only
  // the dotted form let a route to 10.0.0.1 through.
  const dotted = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateV4(dotted[1]);
  const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

export function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return true; // not an IP we understand - refuse rather than guess
}

/**
 * Is this request URL aimed at a literal private or reserved address?
 *
 * Synchronous on purpose: no DNS, so it can sit on the request-interception
 * path without adding a lookup to every subresource a page pulls. It catches
 * the case that actually matters - a hard-coded 169.254.169.254 or 127.0.0.1 -
 * and deliberately does not catch a hostname that resolves into a private
 * range. Anything other than http and https is refused outright; a page has
 * no business fetching file:// through us.
 */
export function isPrivateRequestHost(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return false; // data: and blob: parse but carry no host; nothing to fetch
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Strip the brackets IPv6 authorities carry in a URL.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) return false;   // a name, not a literal - not our case
  return isPrivateAddress(host);
}
export class UrlRejected extends Error {
  constructor(message, code = 'url_rejected') {
    super(message);
    this.name = 'UrlRejected';
    this.code = code;
    this.status = 400;
  }
}

// Short-lived cache so a redirect chain does not trigger a lookup per hop.
const lookupCache = new Map();
const LOOKUP_TTL_MS = 30_000;

async function resolveAll(hostname) {
  const hit = lookupCache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.addresses;

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((r) => r.address);
  lookupCache.set(hostname, { addresses, expires: Date.now() + LOOKUP_TTL_MS });
  if (lookupCache.size > 5000) lookupCache.clear();
  return addresses;
}

/**
 * Validate a URL is safe to fetch. Returns the parsed URL or throws UrlRejected.
 */
export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlRejected('The url parameter is not a valid absolute URL.', 'invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejected(
      `Unsupported scheme "${url.protocol.replace(':', '')}". Use http or https.`,
      'unsupported_scheme',
    );
  }

  if (url.username || url.password) {
    throw new UrlRejected('URLs with embedded credentials are not accepted.', 'credentials_in_url');
  }

  if (config.allowPrivateHosts) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // Literal IP in the URL - check it directly, no DNS involved.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UrlRejected(
        `Refusing to fetch a private or reserved address (${host}).`,
        'private_address',
      );
    }
    return url;
  }

  if (/^localhost$/i.test(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UrlRejected(`Refusing to fetch internal hostname "${host}".`, 'private_address');
  }

  let addresses;
  try {
    addresses = await resolveAll(host);
  } catch {
    throw new UrlRejected(`Could not resolve host "${host}".`, 'dns_failure');
  }

  if (!addresses.length) {
    throw new UrlRejected(`Host "${host}" resolved to no addresses.`, 'dns_failure');
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new UrlRejected(
        `Host "${host}" resolves to a private or reserved address.`,
        'private_address',
      );
    }
  }

  return url;
}

/** Non-throwing variant for the in-flight redirect check. */
export async function isPublicUrl(rawUrl) {
  try {
    await assertPublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
