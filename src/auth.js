import crypto from 'node:crypto';
import config from './config.js';

/**
 * Access keys and HMAC signed URLs.
 *
 * The headline use case for this API is embedding a capture directly in a
 * public page as an <img src>. A plain access key in browser-visible HTML is
 * a billing incident waiting to happen: anyone who views source can drain the
 * customer's quota. Signed URLs are therefore a v1 feature, not a v2 one.
 *
 * Signature covers every query parameter except `signature` itself, sorted by
 * key, so a caller cannot tamper with the url or the options while keeping a
 * valid signature.
 */

export class AuthError extends Error {
  constructor(message, code = 'unauthorized', status = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export function canonicalQuery(params) {
  return Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

export function sign(params, secret = config.signingSecret) {
  if (!secret) throw new Error('SIGNING_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(canonicalQuery(params)).digest('hex');
}

export function signedUrl(baseUrl, params, secret = config.signingSecret) {
  const signature = sign(params, secret);
  const qs = canonicalQuery(params);
  return `${baseUrl}?${qs}&signature=${signature}`;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate a request. Returns { mode: 'open' | 'key' | 'signature' }.
 */
export function authenticate(params, headers = {}) {
  const provided = params.access_key || headers['x-access-key'];
  const hasKeys = config.accessKeys.length > 0;

  // Signature path. Checked first because it is the strongest.
  if (params.signature) {
    if (!config.signingSecret) {
      throw new AuthError(
        'This deployment has no SIGNING_SECRET configured, so signed URLs cannot be verified.',
        'signing_not_configured',
        500,
      );
    }
    const expected = sign(params);
    if (!timingSafeEqual(expected, params.signature)) {
      throw new AuthError(
        'Signature does not match the request parameters.',
        'invalid_signature',
        403,
      );
    }
    return { mode: 'signature' };
  }

  if (config.requireSignature) {
    throw new AuthError(
      'This deployment requires signed URLs. Add a "signature" parameter.',
      'signature_required',
      403,
    );
  }

  if (!hasKeys) {
    // No keys configured: open mode. Fine for local development, never for a
    // deployment reachable from the internet.
    return { mode: 'open' };
  }

  if (!provided) {
    throw new AuthError(
      'Missing access key. Pass ?access_key=... or an X-Access-Key header.',
      'missing_access_key',
    );
  }

  const match = config.accessKeys.some((key) => timingSafeEqual(key, provided));
  if (!match) throw new AuthError('Unknown access key.', 'invalid_access_key', 403);

  return { mode: 'key', key: provided };
}

export default { authenticate, sign, signedUrl, canonicalQuery };
