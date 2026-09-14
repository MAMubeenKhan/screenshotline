/**
 * The mark, in one place.
 *
 * Deliberately a single tiny SVG rather than a set of PNG files: it is inlined
 * as a data URI, so there is no extra request, no binary asset in the repo, no
 * favicon.ico route to remember, and it stays sharp at every size. The whole
 * thing is under 300 bytes.
 *
 * Drawn to read at 16px, which is the only size that really matters for a
 * favicon. A rounded window with a title bar and a content block - legible as
 * "a captured screen" when it is the width of a full stop.
 */

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\
<rect width="32" height="32" rx="7" fill="#0c6b75"/>\
<rect x="7" y="9" width="18" height="3" rx="1.5" fill="#fff" opacity=".92"/>\
<rect x="7" y="15.5" width="18" height="8" rx="2" fill="#fff" opacity=".62"/>\
</svg>`;

/** Same mark, sized for inline use next to the wordmark. */
export const logoMark = (size = 20) =>
  MARK.replace('<svg ', `<svg width="${size}" height="${size}" aria-hidden="true" `);

/**
 * The <head> tags. SVG favicons are supported everywhere current; the
 * theme-color is what tints the browser chrome on mobile.
 */
export const faviconTags = () => {
  const href = `data:image/svg+xml,${encodeURIComponent(MARK)}`;
  return `<link rel="icon" type="image/svg+xml" href="${href}">
<link rel="apple-touch-icon" href="${href}">
<meta name="theme-color" content="#0c6b75">`;
};

export default { faviconTags, logoMark };

/**
 * Polar's hosted customer portal.
 *
 * Where a customer manages or CANCELS their subscription. The terms promise
 * they can cancel any time, and until now the only route to it was a link
 * buried in an old receipt email - which is the shape of a dark pattern even
 * when it is only an oversight, and the shape of a chargeback either way.
 *
 * They authenticate with the email they subscribed with; Polar sends a
 * one-time code. Nothing here needs a token, so it is a plain link.
 */
export const CUSTOMER_PORTAL =
  process.env.POLAR_PORTAL_URL || 'https://polar.sh/screenshotline/portal';
