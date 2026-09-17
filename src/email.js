/**
 * Email validation, to the standard our payment provider actually applies.
 *
 * Signup used to accept anything containing an '@'. Polar does not: it checks
 * that the domain publishes MX records and refuses the whole checkout if it
 * does not. The result was the worst possible ordering - a customer could sign
 * up with a typo, integrate against a working key for weeks, and only discover
 * the problem at the moment they tried to pay us.
 *
 * So the check moves to signup, where it is a two-second correction instead of
 * a lost sale.
 *
 * The MX lookup is injectable so the offline test suite can exercise every
 * branch without a network or a DNS server.
 */
import dnsPromises from 'node:dns/promises';

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Shape only. Deliberately not an RFC 5322 regex - those are famously
 * unreadable, reject valid addresses, and the deliverability check below is
 * the one that actually decides.
 */
export function hasValidShape(email) {
  const value = normalizeEmail(email);
  if (value.length < 3 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  return true;
}

export const domainOf = (email) => normalizeEmail(email).split('@')[1] || '';

/**
 * Does this domain accept mail?
 *
 * Matches what Polar enforces: MX records must exist. Note this is stricter
 * than RFC 5321, which allows an implicit MX via the domain's A record -
 * example.com has an A record and no MX, and Polar rejects it, so we do too.
 * Agreeing with the payment provider matters more here than agreeing with the
 * RFC, because the provider is the one who will refuse the money.
 *
 * A DNS failure that is not "this domain has no MX" is OUR problem, not the
 * customer's. Never turn a resolver timeout into a rejected signup.
 */
export async function isDeliverable(email, { resolveMx = dnsPromises.resolveMx } = {}) {
  const domain = domainOf(email);
  if (!domain) return false;
  try {
    const records = await resolveMx(domain);
    if (!Array.isArray(records) || records.length === 0) return false;
    // RFC 7505 "null MX": a single record with an empty exchange (or ".") is
    // an explicit declaration that the domain accepts NO mail. It is not the
    // absence of a record, it is a record saying no - so a naive length check
    // passes it. example.com publishes exactly this, which is why it looked
    // deliverable here while Polar refused it.
    return records.some((r) => {
      const host = String(r?.exchange ?? '').trim();
      return host !== '' && host !== '.';
    });
  } catch (err) {
    const code = err?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return false;
    // SERVFAIL, ETIMEOUT, EAI_AGAIN, offline - fail open.
    return true;
  }
}

/**
 * Full check. Returns null when fine, or an error object ready to throw.
 */
export async function checkEmail(email, opts) {
  const value = normalizeEmail(email);
  if (!hasValidShape(value)) {
    return Object.assign(new Error('That does not look like an email address.'), {
      code: 'invalid_email',
      status: 400,
    });
  }
  if (!(await isDeliverable(value, opts))) {
    return Object.assign(
      new Error(
        `${domainOf(value)} does not accept email, so we could never send you a receipt and our payment provider would refuse the charge. Check the address for a typo.`,
      ),
      { code: 'undeliverable_email', status: 400 },
    );
  }
  return null;
}

export default { normalizeEmail, hasValidShape, domainOf, isDeliverable, checkEmail };
