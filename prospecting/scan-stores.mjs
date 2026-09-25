// Read-only prospect scanner: given a list of domains, answer the three
// questions that decide whether a store is worth a cold email.
//
//   1. Is it Shopify at all?
//   2. What do things cost? (median catalog price is our AOV proxy, and AOV is
//      the whole thesis: one recovered order at $1k pays for years of Resparq)
//   3. Do they already run an email-capture / exit-intent vendor, and is that
//      vendor even capable of exit intent?
//
//   node prospecting/scan-stores.mjs prospecting/domains.txt
//   node prospecting/scan-stores.mjs allbirds.com gymshark.com
//
// Writes prospecting/out/scan-<date>.json and .csv. Fetches only public pages
// (homepage HTML + /products.json). No API keys, no paid data, no writes to
// anyone else's systems.
//
// What this CANNOT tell you: whether an exit-intent popup actually FIRES. A
// vendor script on the page means capability, not usage. Confirming the popup
// needs a real browser, which is a later step. Treat VENDOR_CAPABLE as
// "worth a look", not as "they already do this".

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MONTHLY_PRICE = 50; // Resparq $/mo, for the payback math in the email
const CONCURRENCY = 8;
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Vendors that ship an exit-intent trigger. Presence means they COULD be
// running one, not that they are. Keys are what we report.
const VENDORS = [
  { name: 'Klaviyo',    exitIntent: true,  sigs: ['static.klaviyo.com', 'static-tracking.klaviyo.com', 'klaviyo.js', 'a.klaviyo.com'] },
  { name: 'Privy',      exitIntent: true,  sigs: ['widget.privy.com', 'privy.com/api', 'privymktg'] },
  { name: 'OptiMonk',   exitIntent: true,  sigs: ['optimonk.com', 'onsite.optimonk'] },
  { name: 'Justuno',    exitIntent: true,  sigs: ['justuno.com', 'jst.ai'] },
  { name: 'Wisepops',   exitIntent: true,  sigs: ['wisepops.com', 'wisepops.net'] },
  { name: 'Sleeknote',  exitIntent: true,  sigs: ['sleeknote.com'] },
  { name: 'Attentive',  exitIntent: true,  sigs: ['attentivemobile.com', 'cdn.attn.tv'] },
  { name: 'Omnisend',   exitIntent: true,  sigs: ['omnisend.com', 'omnisrc.com'] },
  { name: 'Wheelio',    exitIntent: true,  sigs: ['wheelio'] },
  { name: 'Sumo',       exitIntent: true,  sigs: ['sumo.com/api', 'sumome.com'] },
  { name: 'Popupsmart', exitIntent: true,  sigs: ['popupsmart.com'] },
  { name: 'Postscript', exitIntent: false, sigs: ['sdk.postscript.io', 'postscript.io'] },
  { name: 'Mailchimp',  exitIntent: false, sigs: ['chimpstatic.com', 'mailchimp.com/mcjs'] },
  { name: 'ShopifyForms', exitIntent: false, sigs: ['shopify-forms', 'forms/preview'] },
];

// Rough read on what they're already giving away. Cheap regex over the
// homepage, so it is a hint for the email draft, not a measurement.
const DISCOUNT_PATTERNS = [
  /\b(\d{1,2})\s?% off\b/gi,
  /\bsave\s+(\d{1,2})\s?%/gi,
  /\$\s?(\d{1,3})\s+off\b/gi,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: json ? 'application/json' : 'text/html,*/*' },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, headers: res.headers, body };
  } finally {
    clearTimeout(timer);
  }
}

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function detectShopify(html, headers, finalUrl) {
  const hints = [];
  if (headers.get('x-shopid') || headers.get('x-shopify-stage')) hints.push('shopify-header');
  if (/cdn\.shopify\.com/i.test(html)) hints.push('cdn.shopify.com');
  if (/Shopify\.theme|Shopify\.shop|shopify-features/i.test(html)) hints.push('Shopify.theme');
  if (/myshopify\.com/i.test(finalUrl + html)) hints.push('myshopify.com');
  return hints;
}

// /products.json reports prices in the SHOP's currency with no currency field
// on the payload, so a store priced in COP or JPY looks like it sells $75,000
// t-shirts. Pull the active currency off the homepage so the payback math can
// refuse to run rather than quote a nonsense number into an email.
function detectCurrency(html) {
  const patterns = [
    /Shopify\.currency\s*=\s*\{[^}]*?"active"\s*:\s*"([A-Z]{3})"/,
    /"currency"\s*:\s*"([A-Z]{3})"/,
    /itemprop="priceCurrency"[^>]*content="([A-Z]{3})"/,
    /property="product:price:currency"[^>]*content="([A-Z]{3})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function detectVendors(html) {
  const lower = html.toLowerCase();
  return VENDORS.filter((v) => v.sigs.some((s) => lower.includes(s.toLowerCase())));
}

function detectDiscounts(html) {
  // Strip tags first so we match copy, not attribute soup.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const found = new Set();
  for (const re of DISCOUNT_PATTERNS) {
    for (const m of text.matchAll(re)) found.add(m[0].trim().replace(/\s+/g, ' '));
  }
  return [...found].slice(0, 6);
}

async function fetchCatalog(origin) {
  // Some stores disable the root endpoint but still serve it under
  // /collections/all. Try both before calling the catalog unreadable.
  for (const base of ['', '/collections/all']) {
    const result = await fetchCatalogFrom(`${origin}${base}`);
    if (result.available) return result;
    if (base === '/collections/all') return result;
  }
}

async function fetchCatalogFrom(base) {
  // /products.json is public on most Shopify stores. Two pages of 250 is
  // plenty to characterise pricing without hammering anyone.
  const prices = [];
  let productCount = 0;
  let newestPublished = null;
  for (let page = 1; page <= 2; page++) {
    let res;
    try {
      res = await get(`${base}/products.json?limit=250&page=${page}`, { json: true });
    } catch {
      return { available: false, reason: 'fetch-failed' };
    }
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      return { available: false, reason: 'not-json' };
    }
    const products = data.products || [];
    if (!products.length) break;
    productCount += products.length;
    for (const p of products) {
      if (p.published_at && (!newestPublished || p.published_at > newestPublished)) newestPublished = p.published_at;
      const variantPrices = (p.variants || [])
        .map((v) => parseFloat(v.price))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (variantPrices.length) prices.push(Math.min(...variantPrices));
    }
    if (products.length < 250) break;
  }
  if (!prices.length) return { available: false, reason: 'no-priced-products' };
  return {
    available: true,
    productCount,
    medianPrice: Math.round(median(prices) * 100) / 100,
    maxPrice: Math.round(Math.max(...prices) * 100) / 100,
    newestPublished,
  };
}

// The scenario drives which email template gets used. Deliberately coarse:
// the browser pass refines VENDOR_CAPABLE into "actually fires" vs "doesn't".
function classify(vendors, catalog, currency) {
  const aov = catalog.available ? catalog.medianPrice : null;
  // The $150 cut is a USD figure, so a non-USD store is never 'high AOV' here.
  const highAov = aov != null && aov >= 150 && currency === 'USD';
  if (!vendors.length) return highAov ? 'E_HIGH_AOV_GREENFIELD' : 'A_GREENFIELD';
  if (vendors.some((v) => v.exitIntent)) return 'C_VENDOR_EXIT_CAPABLE';
  return 'B_EMAIL_ONLY';
}

async function scanDomain(raw) {
  const domain = raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!domain) return null;
  const row = { domain, scannedAt: new Date().toISOString() };
  let home;
  try {
    home = await get(`https://${domain}/`);
  } catch (err) {
    return { ...row, error: `homepage: ${err.name === 'AbortError' ? 'timeout' : err.message}` };
  }
  if (!home.ok) return { ...row, error: `homepage http-${home.status}` };

  const origin = new URL(home.url).origin;
  const shopifyHints = detectShopify(home.body, home.headers, home.url);
  row.isShopify = shopifyHints.length > 0;
  row.shopifyHints = shopifyHints;

  // Password-protected / coming-soon stores can't be pitched yet.
  row.passwordProtected = /\/password/.test(new URL(home.url).pathname);

  if (!row.isShopify) return row;

  const vendors = detectVendors(home.body);
  row.vendors = vendors.map((v) => v.name);
  row.exitIntentCapable = vendors.some((v) => v.exitIntent);
  row.discountHints = detectDiscounts(home.body);
  row.currency = detectCurrency(home.body);

  const catalog = await fetchCatalog(origin);
  row.catalog = catalog;
  row.scenario = classify(vendors, catalog, row.currency);
  // Only safe in USD. Anything else needs an FX rate we deliberately don't fetch.
  if (catalog.available && row.currency === 'USD') {
    row.paybackMonths = Math.max(1, Math.round(catalog.medianPrice / MONTHLY_PRICE));
  } else if (catalog.available) {
    row.paybackMonths = null;
    row.paybackNote = row.currency ? `prices in ${row.currency}, not converted` : 'currency unknown';
  }
  return row;
}

async function pool(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        out[i] = { domain: items[i], error: String(err && err.message ? err.message : err) };
      }
      await sleep(150); // be a polite guest on someone else's storefront
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

function toCsv(rows) {
  const cols = [
    'domain', 'isShopify', 'scenario', 'currency', 'medianPrice', 'maxPrice', 'productCount',
    'paybackMonths', 'paybackNote', 'vendors', 'exitIntentCapable', 'discountHints', 'passwordProtected', 'error',
  ];
  const cell = (v) => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join(' | ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => cell(
      c === 'medianPrice' ? r.catalog?.medianPrice
        : c === 'maxPrice' ? r.catalog?.maxPrice
        : c === 'productCount' ? r.catalog?.productCount
        : r[c]
    )).join(','));
  }
  return lines.join('\n') + '\n';
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node prospecting/scan-stores.mjs <domains.txt | domain [domain...]>');
  process.exit(1);
}

let domains;
if (args.length === 1 && /\.(txt|csv)$/i.test(args[0])) {
  domains = readFileSync(args[0], 'utf8')
    .split('\n')
    .map((l) => l.split('#')[0].trim())
    .filter(Boolean);
} else {
  domains = args;
}

console.error(`Scanning ${domains.length} domain(s) at concurrency ${CONCURRENCY}...`);
const rows = await pool(domains, CONCURRENCY, scanDomain);

mkdirSync('prospecting/out', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(`prospecting/out/scan-${stamp}.json`, JSON.stringify(rows, null, 2));
writeFileSync(`prospecting/out/scan-${stamp}.csv`, toCsv(rows));

const shopify = rows.filter((r) => r.isShopify);
const byScenario = {};
for (const r of shopify) byScenario[r.scenario] = (byScenario[r.scenario] || 0) + 1;

console.error('');
console.error(`scanned:        ${rows.length}`);
console.error(`shopify:        ${shopify.length}`);
console.error(`errors:         ${rows.filter((r) => r.error).length}`);
console.error(`catalog read:   ${shopify.filter((r) => r.catalog?.available).length}`);
console.error('');
for (const [k, v] of Object.entries(byScenario).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${k.padEnd(28)} ${v}`);
}
console.error('');
console.error(`wrote prospecting/out/scan-${stamp}.json and .csv`);
