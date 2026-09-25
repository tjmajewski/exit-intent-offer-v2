// Contact finding, which is most of the work. Two phases, cheapest first.
//
//   node prospecting/find-contacts.mjs                  # free scrape only
//   node prospecting/find-contacts.mjs --lusha          # + Lusha search (no credits spent)
//   node prospecting/find-contacts.mjs --lusha --spend  # + reveal emails (SPENDS CREDITS)
//   node prospecting/find-contacts.mjs --domains a.com,b.com
//
// Merges findings into prospecting/contacts.csv without ever overwriting a row
// that already has an email, so hand-researched contacts survive a re-run.
//
// Why two phases: Lusha's contact endpoints cannot start from a bare domain.
// They need a name, an email, or a LinkedIn URL. Only the prospecting endpoint
// goes domain -> people, and it costs credits per reveal. So the free phase
// exists to find a name first, which makes the paid phase cheaper or
// unnecessary.
//
// Expect the free phase to resolve a minority of stores. Small DTC brands
// rarely name their founder on the site. The reliable free win is the
// eponymous brand, where the store is named after the person who runs it.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PAGES = ['/pages/about', '/pages/about-us', '/pages/our-story', '/pages/contact', '/pages/meet-the-team', '/'];

// An address at one of these is a shared mailbox, not the person you want.
const GENERIC = new Set(['info', 'hello', 'hi', 'contact', 'support', 'orders', 'order', 'sales',
  'admin', 'help', 'care', 'customercare', 'customerservice', 'service', 'shop', 'team', 'mail',
  'wholesale', 'press', 'returns', 'billing', 'noreply', 'no-reply', 'privacy', 'legal']);

// Words a person would not have in their name, trailing a brand built from one.
const CATEGORY_WORDS = new Set(['art', 'arts', 'fine', 'boutique', 'studio', 'studios', 'shop',
  'store', 'co', 'company', 'design', 'designs', 'jewelry', 'jewellery', 'collection', 'collections',
  'apparel', 'clothing', 'brand', 'beauty', 'skincare', 'cosmetics', 'goods', 'supply', 'home',
  'kitchen', 'bakery', 'coffee', 'photography', 'creative', 'llc', 'inc', 'ltd']);


// Two capitalised words is the shape of a brand as often as a person: "Thrift
// Goblin" and "Gospel Musicians" both pass that test. The only cheap way to
// tell them apart is to check the first token against actual given names.
// Missing a real founder is cheap; inventing one puts a wrong name in an email.
const FIRST_NAMES = new Set(`
james robert john michael david william richard joseph thomas christopher charles daniel matthew
anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald jason
edward jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin
samuel gregory alexander patrick frank raymond jack dennis jerry tyler aaron jose adam nathan henry
zachary douglas peter kyle noah ethan jeremy walter christian keith roger terry austin sean gerald
carl harold dylan nathaniel jordan bryan jesse bruce gabriel logan ross colt carver dean miles
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret
sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca
sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha
katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia
joyce virginia victoria kelly lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline
martha gloria teresa ann sara madison frances kathryn janice jean abigail alice julia judy sophia
grace denise amber marilyn danielle theresa natalie brittany diana beverly charlotte marie kayla
alexis lori tiffany crystal erin stacy dana tara kara leah paige sierra jenna chloe zoe naomi
taylor jamie casey jordan morgan riley avery quinn rowan sage skyler drew blake cameron
`.trim().split(/\s+/));

const looksLikeGivenName = (token) => FIRST_NAMES.has(token.toLowerCase().replace(/[^a-z]/g, ''));

const arg = (flag, fb) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fb;
};
const has = (f) => process.argv.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const newestIn = (dir, prefix, ext) => {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith(ext)).sort();
  return f.length ? `${dir}/${f[f.length - 1]}` : null;
};

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(12000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const strip = (h) => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ');

// "Kayla DeVito Art" -> "Kayla DeVito". Two leftover tokens after dropping a
// trailing category word is the shape of a person's name; three is a slogan.
function personFromBrand(storeName) {
  if (!storeName) return null;
  const tokens = storeName.replace(/[^A-Za-z' -]/g, ' ').split(/\s+/).filter(Boolean);
  while (tokens.length && CATEGORY_WORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  if (tokens.length !== 2) return null;
  const [a, b] = tokens;
  if (a.length < 2 || b.length < 2) return null;
  if (!/^[A-Z]/.test(a) || !/^[A-Z]/.test(b)) return null;
  if (CATEGORY_WORDS.has(a.toLowerCase()) || CATEGORY_WORDS.has(b.toLowerCase())) return null;
  if (!looksLikeGivenName(a)) return null;
  return { name: `${a} ${b}`, source: 'brand-is-a-person' };
}

function namesFromJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        // 'author' is excluded on purpose: Shopify themes and apps put their
        // own developer there, which is how a theme author ends up looking
        // like a store's founder.
        for (const key of ['founder', 'founders', 'employee']) {
          const v = node[key];
          if (!v) continue;
          for (const p of [].concat(v)) {
            const n = typeof p === 'string' ? p : p?.name;
            if (n && /^[A-Z][a-z]+ [A-Z]/.test(n)) out.push({ name: n, source: `jsonld:${key}` });
          }
        }
        Object.values(node).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* malformed blocks are common; skip */ }
  }
  return out;
}

function namesFromProse(text) {
  const out = [];
  const pats = [
    [/(?:I'm|I am)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g, 'prose:im'],
    [/[Mm]y name is\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g, 'prose:myname'],
    [/[Ff]ounded by\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g, 'prose:foundedby'],
    [/([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}),?\s+(?:the\s+)?(?:founder|owner|CEO|creator)/g, 'prose:title'],
  ];
  for (const [re, source] of pats) {
    for (const m of text.matchAll(re)) {
      const n = m[1].trim();
      // "Refund Policy" and friends match the shape but are page furniture.
      if (/^(Refund|Privacy|Shipping|Terms|Contact|Return|Search|Quick|Our|The|This|All)\b/i.test(n)) continue;
      if (!looksLikeGivenName(n.split(/\s+/)[0])) continue;
      out.push({ name: n, source });
    }
  }
  return out;
}

function classifyEmails(text, domain) {
  const found = new Set((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []));
  const personal = [];
  const generic = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(e)) continue;
    if (/(sentry|wixpress|example|shopify|godaddy)\./.test(e)) continue;
    const local = e.split('@')[0].replace(/[._-]/g, '');
    // brandname@gmail.com is a shared mailbox wearing a personal address's
    // clothes. If the local part is just the brand again, it reaches "the
    // shop", not a person, which is the thing this is supposed to avoid.
    const brand = domain.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
    const isBrandMailbox = brand.length > 3
      && (local.includes(brand) || brand.includes(local));
    (GENERIC.has(local) || isBrandMailbox ? generic : personal).push(e);
  }
  return { personal: [...new Set(personal)], generic: [...new Set(generic)] };
}

async function scrapeStore(domain, storeName) {
  const result = { domain, names: [], emails: { personal: [], generic: [] }, instagram: null };
  const brand = personFromBrand(storeName);
  if (brand) result.names.push(brand);

  for (const path of PAGES) {
    const html = await get(`https://${domain}${path}`);
    if (!html) continue;
    const text = strip(html);
    result.names.push(...namesFromJsonLd(html), ...namesFromProse(text));
    const { personal, generic } = classifyEmails(text, domain);
    result.emails.personal.push(...personal);
    result.emails.generic.push(...generic);
    if (!result.instagram) {
      const ig = html.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/);
      if (ig && !['p', 'reel', 'explore'].includes(ig[1])) result.instagram = ig[1];
    }
    await sleep(120);
  }

  // Dedupe, most-trusted source first.
  const rank = (s) => (s.startsWith('jsonld') ? 0 : s.startsWith('prose') ? 1 : 2);
  const seen = new Set();
  result.names = result.names
    .sort((a, b) => rank(a.source) - rank(b.source))
    .filter((n) => !seen.has(n.name.toLowerCase()) && seen.add(n.name.toLowerCase()));
  result.emails.personal = [...new Set(result.emails.personal)];
  result.emails.generic = [...new Set(result.emails.generic)];
  return result;
}

// ---------------------------------------------------------------- Lusha

const LUSHA_BASE = 'https://api.lusha.com';
const SENIORITY = ['owner', 'founder', 'ceo', 'c_level', 'vp', 'director', 'head'];

async function lusha(path, body, key) {
  const res = await fetch(`${LUSHA_BASE}${path}`, {
    method: 'POST',
    headers: { api_key: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw for the error path */ }
  if (!res.ok) {
    const detail = json?.message || json?.error || text.slice(0, 200);
    const err = new Error(`HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Domain -> candidate people. Costs a search action, not a reveal.
async function lushaProspect(domain, key) {
  const body = {
    pages: { page: 0, size: 10 },
    filters: {
      companies: { include: { domains: [domain] } },
      contacts: { include: { seniority: SENIORITY } },
    },
  };
  const res = await lusha('/v3/contacts/prospecting', body, key);
  return res?.data || res?.contacts || [];
}

// Reveal emails for chosen IDs. THIS is what consumes reveal credits.
async function lushaEnrich(contactIds, key) {
  const res = await lusha('/v3/contacts/enrich', { contactIds, reveal: ['emails'] }, key);
  return res?.data || res?.contacts || [];
}

// ---------------------------------------------------------------- csv

const CSV = arg('--contacts', 'prospecting/contacts.csv');

function loadCsv() {
  const rows = new Map();
  if (!existsSync(CSV)) return rows;
  const lines = readFileSync(CSV, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
  for (const line of lines) {
    const cells = line.split(',').map((c) => c.trim());
    const rec = Object.fromEntries(header.map((h, i) => [h, cells[i] || '']));
    if (rec.domain) rows.set(rec.domain.toLowerCase(), rec);
  }
  return rows;
}

function saveCsv(rows) {
  const cols = ['domain', 'email', 'name', 'title', 'source', 'confidence', 'notes'];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [
    '# domain,email,name,title,source,confidence,notes',
    '# Rows with an email are used as-is and never overwritten by a re-run.',
    '# confidence: lusha > jsonld > brand-is-a-person > prose. Verify before sending.',
    cols.join(','),
    ...[...rows.values()].map((r) => cols.map((c) => cell(r[c])).join(',')),
  ].join('\n');
  writeFileSync(CSV, out + '\n');
}

// ---------------------------------------------------------------- main

const scanPath = arg('--scan', newestIn('prospecting/out', 'scan-', '.json'));
const reviewsPath = arg('--reviews', newestIn('prospecting/out', 'reviews-', '.json'));

let targets;
if (arg('--domains', null)) {
  targets = arg('--domains').split(',').map((d) => ({ domain: d.trim().toLowerCase(), storeName: null }));
} else {
  if (!scanPath) {
    console.error('no scan file. run scan-stores.mjs first, or pass --domains a.com,b.com');
    process.exit(1);
  }
  const names = new Map();
  if (reviewsPath && existsSync(reviewsPath)) {
    for (const s of JSON.parse(readFileSync(reviewsPath, 'utf8'))) {
      if (s.resolved) names.set(s.resolved.toLowerCase(), s.storeName);
    }
  }
  targets = JSON.parse(readFileSync(scanPath, 'utf8'))
    .filter((r) => r.isShopify && !r.passwordProtected)
    .map((r) => ({ domain: r.domain, storeName: names.get(r.domain) || null }));
}

const rows = loadCsv();
const useLusha = has('--lusha');
const spend = has('--spend');
const key = process.env.LUSHA_API_KEY;

if (useLusha && !key) {
  console.error('--lusha needs LUSHA_API_KEY. Check your Lusha dashboard has API access at all;');
  console.error('the browser extension and the API are sold separately.');
  process.exit(1);
}

// Lusha answers a malformed key with "Invalid API key format", which is a
// 400 rather than a 401 and so reads like a request problem. Describe the
// value first, never echoing it, so an obvious paste error is obvious here.
const cleanKey = (key || '').trim().replace(/^["']|["']$/g, '');
if (useLusha) {
  if (cleanKey !== key) console.error('note: trimmed whitespace or quotes from LUSHA_API_KEY');
  if (/^(your|xxx|api|lusha)[-_]?key$/i.test(cleanKey) || cleanKey.includes('<')) {
    console.error(`LUSHA_API_KEY looks like a placeholder (${cleanKey.length} chars). Set the real key.`);
    process.exit(1);
  }
  if (cleanKey.length < 16) {
    console.error(`LUSHA_API_KEY is only ${cleanKey.length} characters, which is too short for a Lusha key.`);
    console.error('Copy it from Lusha > API. If your plan has no API section, the API is not included.');
    process.exit(1);
  }
  console.error(`lusha key: ${cleanKey.length} chars, ${/^[A-Za-z0-9-]+$/.test(cleanKey) ? 'alphanumeric' : 'contains punctuation'}`);
}

console.error(`${targets.length} domain(s), free scrape${useLusha ? ' + Lusha' : ''}${spend ? ' + REVEAL (spends credits)' : ''}\n`);

let resolved = 0;
let lushaCalls = 0;
let lushaBroken = false;
let revealed = 0;

for (const { domain, storeName } of targets) {
  const existing = rows.get(domain);
  if (existing?.email) {
    console.error(`  ${domain.padEnd(30)} already has ${existing.email}, skipping`);
    continue;
  }

  const found = await scrapeStore(domain, storeName);
  const best = found.names[0] || null;
  let email = found.emails.personal[0] || '';
  let source = email ? 'site:personal-email' : (best ? best.source : '');
  let name = best?.name || '';
  let title = '';
  let confidence = email ? 'high' : best ? (best.source.startsWith('jsonld') ? 'high' : 'medium') : '';

  if (useLusha && !lushaBroken && !email) {
    try {
      const people = await lushaProspect(domain, cleanKey);
      lushaCalls++;
      if (people.length) {
        const p = people[0];
        name = [p.firstName, p.lastName].filter(Boolean).join(' ') || name;
        title = p.jobTitle || p.title || '';
        source = 'lusha:prospecting';
        confidence = 'high';
        if (spend && (p.contactId || p.id)) {
          const enriched = await lushaEnrich([p.contactId || p.id], cleanKey);
          revealed++;
          const e = enriched[0]?.emails?.[0];
          email = (typeof e === 'string' ? e : e?.address || e?.email) || '';
          if (email) source = 'lusha:enriched';
        }
      }
    } catch (err) {
      console.error(`  ${domain.padEnd(30)} lusha: ${err.message}`);
      // A bad key can arrive as 400 "Invalid API key format" rather than 401,
      // so match on what the message says, not only on the status.
      const keyProblem = err.status === 401 || err.status === 403
        || /api[_ ]?key|unauthori[sz]ed|forbidden|invalid key/i.test(err.message);
      if (keyProblem) {
        console.error('\n  stopping: the key was rejected, so every further call fails identically.');
        console.error('  Lusha > API for the real key. No API section means the plan does not include it.');
        lushaBroken = true;
        break;
      }
    }
  }

  const notes = [
    found.emails.generic.length ? `generic: ${found.emails.generic.slice(0, 2).join(' ')}` : '',
    found.instagram ? `ig: @${found.instagram}` : '',
    found.names.length > 1 ? `also: ${found.names.slice(1, 3).map((n) => n.name).join(' / ')}` : '',
  ].filter(Boolean).join('; ');

  rows.set(domain, { domain, email, name, title, source, confidence, notes });
  if (email || name) resolved++;

  const label = email ? `EMAIL ${email}` : name ? `name ${name} (${source})` : 'nothing';
  console.error(`  ${domain.padEnd(30)} ${label}`);
  await sleep(150);
}

saveCsv(rows);

console.error('');
console.error(`resolved something for ${resolved}/${targets.length}`);
if (useLusha) console.error(`lusha searches: ${lushaCalls}, reveals: ${revealed}`);
console.error(`wrote ${CSV}`);
console.error('');
console.error('A name without an email is still progress: it is what Lusha, or a manual');
console.error('LinkedIn lookup, needs as a starting point. Rows with an email are never');
console.error('overwritten, so hand-researched contacts survive a re-run.');
