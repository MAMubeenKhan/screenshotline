#!/usr/bin/env node
/**
 * Build a signed capture URL.
 *
 *   export SIGNING_SECRET=your-secret
 *   node tools/sign.js "https://example.com" full_page=true format=webp
 *   node tools/sign.js --base https://api.screenshotline.com "https://example.com"
 */
import { sign, canonicalQuery } from '../src/auth.js';

const args = process.argv.slice(2);
const secret = process.env.SIGNING_SECRET;

if (!secret) {
  console.error('SIGNING_SECRET is not set.\n');
  console.error('  export SIGNING_SECRET=your-secret');
  console.error('  node tools/sign.js "https://example.com" full_page=true\n');
  process.exit(1);
}

let base = 'http://localhost:3000/take';
const baseIndex = args.indexOf('--base');
if (baseIndex !== -1) {
  base = args[baseIndex + 1].replace(/\/+$/, '');
  if (!base.endsWith('/take')) base += '/take';
  args.splice(baseIndex, 2);
}

const [url, ...rest] = args;
if (!url) {
  console.error('Usage: node tools/sign.js <url> [key=value ...]');
  process.exit(1);
}

const params = { url };
for (const pair of rest) {
  const eq = pair.indexOf('=');
  if (eq === -1) {
    console.error(`Ignoring "${pair}" - expected key=value.`);
    continue;
  }
  params[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const signature = sign(params, secret);
console.log(`${base}?${canonicalQuery(params)}&signature=${signature}`);
