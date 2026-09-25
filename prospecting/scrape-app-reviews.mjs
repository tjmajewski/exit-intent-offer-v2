// Discovery feeder: find stores that are ALREADY annoyed with a popup app.
//
// Taking the happy reviewers of a competitor is a bad list — they left five
// stars because the thing is working for them. The useful signal is inverted:
// 1-3 star reviews mean the store bought into the category, pays for it, and
// is unhappy right now. That is a warm-ish cold lead.
//
//   node prospecting/scrape-app-reviews.mjs
//   node prospecting/scrape-app-reviews.mjs --apps privy,justuno --pages 5
//   node prospecting/scrape-app-reviews.mjs --no-resolve
//
// Writes prospecting/out/reviews-<stamp>.json plus a plain domain list you can
// hand straight to scan-stores.mjs.
//
// The Shopify App Store gives a store NAME, never a URL. Resolution guesses
// <name>.com / .co / .shop and then checks the brand actually appears in the
// page, so every resolved row carries a confidence you should filter on rather
// than trust. Unresolved rows are still worth keeping: the name plus country
// is usually enough to find the store by hand in a few seconds.
//
// Public review pages only, one request at a time, with a delay.

import { writeFileSync, mkdirSync } from 'node:fs';

// Verified handles. The App Store 404s unknown ones, and the handle is often
// not the brand name ('justuno' and 'wheelio' both 404), so check any new one
// by opening https://apps.shopify.com/<handle> before adding it here. Passing
// a full app URL works too.
const DEFAULT_APPS = ['privy', 'optimonk', 'popupsmart', 'adoric-popups', 'klaviyo-email-marketing'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const TLDS = ['com', 'co', 'shop', 'store'];

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);

const apps = arg('--apps', DEFAULT_APPS.join(','))
  .split(',')
  .map((s) => s.trim().replace(/^https?:\/\/apps\.shopify\.com\//, '').replace(/[/?].*$/, ''))
  .filter(Boolean);
const pages = parseInt(arg('--pages', '3'), 10);
const ratings = arg('--ratings', '1,2,3').split(',').map((s) => s.trim());
const resolve = !has('--no-resolve');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA } });
    return { ok: res.ok, status: res.status, url: res.url, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();

function parseReviews(html, app) {
  const clean = html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const out = [];
  for (const block of clean.split('data-merchant-review').slice(1)) {
    const chunk = block.slice(0, 6000);
    const lines = chunk.replace(/<[^>]+>/g, '\n').split('\n').map((l) => decode(l)).filter(Boolean);
    const durIdx = lines.findIndex((l) => /using the app$/.test(l));
    if (durIdx < 2) continue;
    const ratingMatch = chunk.match(/aria-label="(\d) out of 5 stars"/);
    // Layout is: ...date, body, "Show more"?, name, country, duration.
    const storeName = lines[durIdx - 2];
    const country = lines[durIdx - 1];
    const body = lines
      .slice(0, durIdx - 2)
      // The split boundary leaves a tail of raw attributes on the first line.
      .filter((l) => l !== 'Show more' && !/^\w+ \d{1,2}, \d{4}$/.test(l) && !/="|^data-|^class=/.test(l))
      .join(' ')
      .slice(0, 1200);
    const date = lines.find((l) => /^\w+ \d{1,2}, \d{4}$/.test(l)) || null;
    if (!storeName || storeName.length > 90) continue;
    out.push({
      app,
      storeName,
      country,
      tenure: lines[durIdx],
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      date,
      review: body,
    });
  }
  return out;
}

// "Forage & Soothe" -> "foragesoothe". Crude, but the verification step below
// is what actually decides whether a guess counts.
const slug = (name) => name
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/\b(llc|inc|ltd|co|company|the|shop|store|official)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

function brandTokens(name) {
  return name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter((t) => t.length >= 4 && !['shop', 'store', 'official', 'wholesale', 'clothing'].includes(t));
}

async function resolveDomain(storeName) {
  const base = slug(storeName);
  if (base.length < 3) return { resolved: null, confidence: 'none', reason: 'name-too-short' };
  const tokens = brandTokens(storeName);
  for (const tld of TLDS) {
    const domain = `${base}.${tld}`;
    let res;
    try {
      res = await get(`https://${domain}/`);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const html = res.body;
    const isShopify = /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].toLowerCase();
    const nameInTitle = tokens.length ? tokens.some((t) => title.includes(t)) : title.includes(base);
    const nameInBody = html.toLowerCase().includes(storeName.toLowerCase());
    let confidence = 'low';
    if (isShopify && nameInTitle) confidence = 'high';
    else if (isShopify && nameInBody) confidence = 'medium';
    else if (!isShopify) confidence = 'not-shopify';
    return { resolved: domain, confidence, isShopify, title: decode(title).slice(0, 120) };
  }
  return { resolved: null, confidence: 'none', reason: 'no-candidate-responded' };
}

const ratingQuery = ratings.map((r) => `ratings%5B%5D=${encodeURIComponent(r)}`).join('&');
const all = [];

for (const app of apps) {
  for (let page = 1; page <= pages; page++) {
    const url = `https://apps.shopify.com/${app}/reviews?${ratingQuery}&page=${page}`;
    let res;
    try {
      res = await get(url);
    } catch (err) {
      console.error(`  ${app} p${page}: ${err.message}`);
      break;
    }
    if (!res.ok) {
      const hint = res.status === 404 && page === 1 ? ' (no such app handle — check apps.shopify.com/<handle>)' : '';
      console.error(`  ${app} p${page}: http-${res.status}${hint}`);
      break;
    }
    const reviews = parseReviews(res.body, app);
    console.error(`  ${app} p${page}: ${reviews.length} reviews`);
    if (!reviews.length) break;
    all.push(...reviews);
    await sleep(700);
  }
}

// One store may hate several popup apps. That store is the best lead on the
// list, so collapse by name and keep every app it complained about.
const byStore = new Map();
for (const r of all) {
  const key = r.storeName.toLowerCase();
  if (!byStore.has(key)) {
    byStore.set(key, { storeName: r.storeName, country: r.country, apps: [], reviews: [] });
  }
  const entry = byStore.get(key);
  if (!entry.apps.includes(r.app)) entry.apps.push(r.app);
  entry.reviews.push({ app: r.app, rating: r.rating, date: r.date, tenure: r.tenure, review: r.review });
}
const stores = [...byStore.values()];

if (resolve) {
  console.error(`\nResolving ${stores.length} store names to domains...`);
  let done = 0;
  for (const s of stores) {
    Object.assign(s, await resolveDomain(s.storeName));
    if (++done % 10 === 0) console.error(`  ${done}/${stores.length}`);
    await sleep(200);
  }
}

mkdirSync('prospecting/out', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
stores.sort((a, b) => b.apps.length - a.apps.length || b.reviews.length - a.reviews.length);
writeFileSync(`prospecting/out/reviews-${stamp}.json`, JSON.stringify(stores, null, 2));

const confident = stores.filter((s) => s.confidence === 'high' || s.confidence === 'medium');
if (resolve) {
  const list = [
    '# Resolved from Shopify App Store 1-3 star reviews of popup apps.',
    '# high = brand in <title> + Shopify. medium = Shopify, brand in body only.',
    '',
    ...confident.map((s) => `${s.resolved}  # ${s.confidence} | ${s.storeName} | hates: ${s.apps.join(',')}`),
  ].join('\n');
  writeFileSync(`prospecting/out/reviews-${stamp}-domains.txt`, list + '\n');
}

console.error('');
console.error(`reviews:        ${all.length}`);
console.error(`unique stores:  ${stores.length}`);
console.error(`multi-app:      ${stores.filter((s) => s.apps.length > 1).length}`);
if (resolve) {
  const tally = {};
  for (const s of stores) tally[s.confidence] = (tally[s.confidence] || 0) + 1;
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.error(`  ${String(k).padEnd(14)} ${v}`);
  console.error('');
  console.error(`wrote reviews-${stamp}.json and reviews-${stamp}-domains.txt (${confident.length} usable)`);
} else {
  console.error(`wrote reviews-${stamp}.json`);
}
