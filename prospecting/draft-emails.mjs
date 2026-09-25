// Turn scan rows into reviewable email drafts, best lead first, 12 at a time.
//
//   node prospecting/draft-emails.mjs                    # preview 12 in terminal
//   node prospecting/draft-emails.mjs --push             # also put them in Zoho Drafts
//   node prospecting/draft-emails.mjs --limit 5
//   node prospecting/draft-emails.mjs --include-drafted  # ignore the ledger
//   node prospecting/draft-emails.mjs --reset            # clear the ledger
//   node prospecting/draft-emails.mjs --test-connection  # check Zoho creds only
//
// Drafts only. There is deliberately no SMTP code in this file, so the worst
// this can do to a stranger's inbox is nothing. Sending stays a human action.
//
// A refresh gives you the NEXT 12, not the same 12: every drafted domain is
// recorded in prospecting/state/drafted.json. --reset starts over.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import tls from 'node:tls';

const MONTHLY_PRICE = 50;
const DEFAULT_LIMIT = 12;
const STATE_PATH = 'prospecting/state/drafted.json';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);

const limit = parseInt(arg('--limit', String(DEFAULT_LIMIT)), 10);
const push = has('--push');

const newestIn = (dir, prefix, ext) => {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(ext)).sort();
  return files.length ? `${dir}/${files[files.length - 1]}` : null;
};

// ---------------------------------------------------------------- scoring

// Zero outcome data exists yet: nothing has been sent, so nothing has replied.
// These weights are a prior, not a model. Every component is recorded on the
// row so that once replies come back you can see which signals actually
// predicted them and re-weight instead of guessing again.
const WEIGHTS = {
  angryRecently: 30,   // complained about a popup app in the last ~18 months
  angryOlder: 10,
  multiAppAngry: 15,   // hated more than one popup app
  noVendor: 25,        // nothing installed, so nothing to rip out
  vendorBasic: 10,     // capture vendor with no exit-intent trigger
  highAov: 25,         // >= $150 median, the thesis
  midAov: 12,          // >= $60
  catalogReadable: 15, // we can say something specific, so the email lands
  noCatalog: -15,      // pricing unreadable, so the draft goes generic and weak
  storeActive: 10,     // published a product in the last 120 days
  usBased: 8,          // deliverable, and no GDPR question
  hasContact: 20,      // a named human beats a guess
};

function scoreRow(row, anger, contact) {
  const parts = {};
  const cat = row.catalog || {};
  const usd = row.currency === 'USD';

  if (anger) {
    const months = anger.monthsAgo;
    if (months != null && months <= 18) parts.angryRecently = WEIGHTS.angryRecently;
    else parts.angryOlder = WEIGHTS.angryOlder;
    if (anger.apps.length > 1) parts.multiAppAngry = WEIGHTS.multiAppAngry;
  }

  if (!row.vendors || row.vendors.length === 0) parts.noVendor = WEIGHTS.noVendor;
  else if (!row.exitIntentCapable) parts.vendorBasic = WEIGHTS.vendorBasic;

  if (cat.available && usd) {
    if (cat.medianPrice >= 150) parts.highAov = WEIGHTS.highAov;
    else if (cat.medianPrice >= 60) parts.midAov = WEIGHTS.midAov;
    parts.catalogReadable = WEIGHTS.catalogReadable;
  } else {
    // Without prices the email loses its only concrete line. That is a worse
    // email, so it is a worse lead, independent of how big the store is.
    parts.noCatalog = WEIGHTS.noCatalog;
  }

  if (cat.newestPublished) {
    const days = (Date.now() - new Date(cat.newestPublished).getTime()) / 86400000;
    if (days <= 120) parts.storeActive = WEIGHTS.storeActive;
  }

  if ((contact?.country || anger?.country || '').toLowerCase().includes('united states')) {
    parts.usBased = WEIGHTS.usBased;
  }
  if (contact?.email) parts.hasContact = WEIGHTS.hasContact;

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, parts };
}

// ---------------------------------------------------------------- templates

const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Honest-footing paragraph. One live store, three recovered checkouts, ~$3k
// attributed. No lift number exists yet and inventing one is the fastest way
// to sound like every other popup app in their inbox, so the absence is said
// out loud and turned into the pitch for the holdout.
const PROOF = `Quick context so you can weigh it properly: Resparq is early. One store is live, two weeks in, with three recovered checkouts and about $3,000 in attributed revenue. Their traffic is too low for me to claim a lift percentage yet, and I am not going to pretend otherwise. The app runs a holdout group, so what you would get is your own measured number rather than mine.`;

function render(row, anger, contact) {
  const cat = row.catalog || {};
  const usd = row.currency === 'USD';
  const name = contact?.firstName || 'there';
  const med = cat.available && usd ? money(cat.medianPrice) : null;
  const payback = row.paybackMonths;
  const vendors = (row.vendors || []).join(' and ');

  const mathLine = med && payback
    ? `Median item on the site runs about ${med}. At ${money(MONTHLY_PRICE)}/mo, one recovered order covers roughly ${payback} ${payback === 1 ? 'month' : 'months'}.`
    : `Hard for me to read your pricing from the outside, so I will not guess at the numbers.`;

  let subject;
  let opening;

  switch (row.scenario) {
    case 'E_HIGH_AOV_GREENFIELD':
      subject = `exit offer on ${row.domain}?`;
      opening = `I went through ${row.domain} and could not find an exit intent offer on the way out of the cart. At your price points that is the expensive kind of gap.`;
      break;
    case 'A_GREENFIELD':
      subject = `${row.domain} cart abandonment`;
      opening = `I went through ${row.domain} and did not see anything catching people on the way out of the cart.`;
      break;
    case 'B_EMAIL_ONLY':
      subject = `${row.domain}: capture on arrival, nothing on exit`;
      opening = `You are running ${vendors} to collect emails, but I did not see anything firing when someone abandons a cart. You catch them arriving and lose them leaving.`;
      break;
    case 'C_VENDOR_EXIT_CAPABLE':
    default:
      subject = `question about your ${vendors || 'popup'} setup`;
      opening = `You have ${vendors || 'a popup tool'} on ${row.domain}, so you already believe in this. My question is narrower: is it handing the same discount to everyone, including the people who were going to buy anyway?`;
      break;
  }

  if (row.discountHints?.length) {
    opening += ` I noticed ${row.discountHints[0]} on the site, which is the part worth targeting rather than broadcasting.`;
  }

  const angerLine = anger && anger.monthsAgo != null && anger.monthsAgo <= 18
    ? `\n\nI will also say: the reviews for these tools are full of people surprised by usage-based billing. Resparq is a flat ${money(MONTHLY_PRICE)}/mo. No usage fees, no per-impression charge.`
    : '';

  const body = `Hi ${name},

${opening}

${mathLine}${angerLine}

${PROOF}

Worth ten minutes?

Taylor`;

  return { subject, body };
}

// ---------------------------------------------------------------- inputs

const scanPath = arg('--scan', newestIn('prospecting/out', 'scan-', '.json'));
const reviewsPath = arg('--reviews', newestIn('prospecting/out', 'reviews-', '.json'));

function loadContacts() {
  const p = arg('--contacts', 'prospecting/contacts.csv');
  if (!existsSync(p)) return new Map();
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
  const map = new Map();
  for (const line of lines) {
    const cells = line.split(',').map((c) => c.trim());
    const rec = Object.fromEntries(header.map((h, i) => [h, cells[i] || '']));
    if (!rec.domain) continue;
    rec.firstName = (rec.name || '').split(' ')[0];
    map.set(rec.domain.toLowerCase(), rec);
  }
  return map;
}

function loadAnger() {
  const map = new Map();
  if (!reviewsPath || !existsSync(reviewsPath)) return map;
  for (const s of JSON.parse(readFileSync(reviewsPath, 'utf8'))) {
    if (!s.resolved) continue;
    const dates = s.reviews.map((r) => (r.date ? new Date(r.date).getTime() : null)).filter(Boolean);
    const newest = dates.length ? Math.max(...dates) : null;
    map.set(s.resolved.toLowerCase(), {
      apps: s.apps,
      country: s.country,
      storeName: s.storeName,
      monthsAgo: newest == null ? null : Math.round((Date.now() - newest) / 2629800000),
    });
  }
  return map;
}

// ---------------------------------------------------------------- IMAP

// Minimal IMAP APPEND. No dependency, and no code path that can send mail.
function imapAppend({ host, port, user, pass, folder, messages, testOnly }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => {});
    let buf = '';
    let tag = 0;
    const queue = [];
    let waiting = null;
    let appended = 0;

    const send = (cmd, literalBody) => new Promise((res, rej) => {
      const id = `a${++tag}`;
      queue.push({ id, res, rej, literalBody });
      socket.write(`${id} ${cmd}\r\n`);
    });

    socket.setTimeout(30000, () => { socket.destroy(); reject(new Error('IMAP timeout')); });
    socket.on('error', reject);

    socket.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      // Server asks for the literal with a continuation line.
      if (buf.includes('\r\n') && /^\+ /m.test(buf) && waiting?.literalBody) {
        socket.write(waiting.literalBody + '\r\n');
        buf = '';
        return;
      }
      let idx;
      while ((idx = buf.indexOf('\r\n')) > -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const m = line.match(/^a(\d+) (OK|NO|BAD)\s*(.*)$/);
        if (!m) continue;
        const entry = queue.find((q) => q.id === `a${m[1]}`);
        if (!entry) continue;
        queue.splice(queue.indexOf(entry), 1);
        waiting = null;
        if (m[2] === 'OK') entry.res(m[3]);
        else entry.rej(new Error(`${m[2]} ${m[3]}`));
      }
    });

    socket.once('data', async () => {
      try {
        await send(`LOGIN "${user}" "${pass}"`);
        if (testOnly) {
          await send('LOGOUT').catch(() => {});
          socket.end();
          return resolve({ ok: true, appended: 0, testOnly: true });
        }
        for (const raw of messages) {
          const bytes = Buffer.byteLength(raw, 'utf8');
          waiting = { literalBody: raw };
          const p = send(`APPEND "${folder}" (\\Draft) {${bytes}}`, raw);
          queue[queue.length - 1].literalBody = raw;
          await p;
          appended++;
        }
        await send('LOGOUT').catch(() => {});
        socket.end();
        resolve({ ok: true, appended });
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
  });
}

function toMime({ from, to, subject, body }) {
  const date = new Date().toUTCString();
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'X-Resparq-Draft: prospecting',
    '',
    body,
  ].join('\r\n');
}

// ---------------------------------------------------------------- main

if (has('--reset')) {
  mkdirSync('prospecting/state', { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ drafted: [] }, null, 2));
  console.error('ledger cleared');
  process.exit(0);
}

const zoho = {
  host: process.env.ZOHO_IMAP_HOST || 'imap.zoho.com',
  port: Number(process.env.ZOHO_IMAP_PORT || 993),
  user: process.env.ZOHO_USER,
  pass: process.env.ZOHO_APP_PASSWORD,
  folder: process.env.ZOHO_DRAFTS_FOLDER || 'Drafts',
  from: process.env.ZOHO_FROM || process.env.ZOHO_USER,
};

if (has('--test-connection')) {
  if (!zoho.user || !zoho.pass) {
    console.error('set ZOHO_USER and ZOHO_APP_PASSWORD first (Zoho > Settings > Security > App Passwords)');
    process.exit(1);
  }
  try {
    await imapAppend({ ...zoho, messages: [], testOnly: true });
    console.error(`login OK as ${zoho.user} on ${zoho.host}`);
  } catch (err) {
    console.error(`login FAILED: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!scanPath) {
  console.error('no scan file found. run scan-stores.mjs first, or pass --scan <path>');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(scanPath, 'utf8')).filter((r) => r.isShopify && !r.passwordProtected);
const contacts = loadContacts();
const anger = loadAnger();

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { drafted: [] };
const already = new Set(state.drafted.map((d) => d.domain));

const ranked = rows
  .map((row) => {
    const a = anger.get(row.domain);
    const c = contacts.get(row.domain);
    return { row, anger: a, contact: c, score: scoreRow(row, a, c) };
  })
  .filter((r) => has('--include-drafted') || !already.has(r.row.domain))
  .sort((a, b) => b.score.total - a.score.total);

const picked = ranked.slice(0, limit);

if (!picked.length) {
  console.error(`nothing left to draft (${already.size} already drafted). --include-drafted or --reset to revisit.`);
  process.exit(0);
}

console.error(`scan:     ${scanPath}`);
console.error(`reviews:  ${reviewsPath || 'none'}`);
console.error(`contacts: ${contacts.size} loaded`);
console.error(`eligible: ${ranked.length}, drafting top ${picked.length}\n`);

const messages = [];
picked.forEach((p, i) => {
  const { subject, body } = render(p.row, p.anger, p.contact);
  const needsContact = !p.contact?.email;
  const to = needsContact ? zoho.from : p.contact.email;
  const finalSubject = needsContact ? `[NEEDS CONTACT: ${p.row.domain}] ${subject}` : subject;
  const banner = needsContact
    ? `>> No contact yet for ${p.row.domain}. Find the founder or head of ecommerce, put them in the To: line, delete this banner.\n>> Store name: ${p.anger?.storeName || '?'} | ${p.anger?.country || '?'}\n\n`
    : '';

  messages.push(toMime({ from: zoho.from, to, subject: finalSubject, body: banner + body }));

  const top = Object.entries(p.score.parts).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(', ');
  console.error(`${String(i + 1).padStart(2)}. ${p.row.domain.padEnd(30)} score ${String(p.score.total).padStart(3)}  ${p.row.scenario}`);
  console.error(`    why: ${top || 'no signals'}`);
  if (!push) {
    console.error(`    subj: ${finalSubject}`);
    console.error(banner + body ? `    ${(banner + body).split('\n').join('\n    ')}` : '');
  }
  console.error('');
});

if (push) {
  if (!zoho.user || !zoho.pass) {
    console.error('set ZOHO_USER and ZOHO_APP_PASSWORD to push. previewed only.');
    process.exit(1);
  }
  const res = await imapAppend({ ...zoho, messages });
  console.error(`appended ${res.appended} draft(s) to "${zoho.folder}" on ${zoho.host}`);
  mkdirSync('prospecting/state', { recursive: true });
  state.drafted.push(...picked.map((p) => ({ domain: p.row.domain, score: p.score.total, at: new Date().toISOString() })));
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.error(`ledger: ${state.drafted.length} domains drafted to date`);
} else {
  console.error('preview only. --push to put these in Zoho Drafts (nothing is ever sent).');
}
