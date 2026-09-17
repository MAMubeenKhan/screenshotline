# Security

## Reporting

Please do not open a public issue for a vulnerability. Email
security@YOURDOMAIN with the details and give us a reasonable window to fix it.

## The main risk in this codebase

A screenshot API fetches arbitrary URLs from your infrastructure. Without
guards that is a server-side request forgery engine — a customer could point it
at your cloud metadata endpoint, your database, or anything else reachable from
the render tier.

What `src/security.js` enforces:

- http/https only
- no embedded credentials
- every resolved address checked against private and reserved ranges
  (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, and IPv6 equivalents)
- **re-validation on every redirect hop**, not just the submitted URL

## Known limitation: DNS rebinding

This resolves the hostname and Chrome resolves it again. A DNS record that
changes between the two lookups is not fully closed off. Closing it properly
means pinning the resolved address and forcing Chrome to use it via
`--host-resolver-rules`. Documented here rather than quietly ignored; worth
doing before you take enterprise money.

## Deployment guidance

- Never set `ALLOW_PRIVATE_HOSTS=true` on anything internet-reachable.
- Run the render tier in a network namespace with no route to your metadata
  service, database, or internal services.
- Keep the container non-root. The image already does this.
- Sign URLs that appear in public HTML.
