// Turn scan rows into reviewable email drafts, best lead first, 12 at a time.
//
//   node prospecting/draft-emails.mjs                    # preview 12 in terminal
//   node prospecting/draft-emails.mjs --pptx             # one slide per email
//   node prospecting/draft-emails.mjs --sent yourstore.com    # record that you sent it
//   node prospecting/draft-emails.mjs --replied yourstore.com # they answered: stop following up
//   node prospecting/draft-emails.mjs --dead yourstore.com    # not interested: stop following up
//   node prospecting/draft-emails.mjs --status           # pipeline at a glance
//   node prospecting/draft-emails.mjs --review           # browser page, copy/paste into Zoho
//   node prospecting/draft-emails.mjs --eml              # one .eml file per draft
//   node prospecting/draft-emails.mjs --push             # Zoho Drafts (needs IMAP, a paid plan)
//   node prospecting/draft-emails.mjs --limit 5
//   node prospecting/draft-emails.mjs --include-drafted  # ignore the ledger
//   node prospecting/draft-emails.mjs --reset            # clear the ledger
//   node prospecting/draft-emails.mjs --test-connection  # creds + folder list
//
// Drafts only. There is deliberately no SMTP code in this file, so the worst
// this can do to a stranger's inbox is nothing. Sending stays a human action.
//
// Zoho's free plan does not expose IMAP, so --push only works on a paid plan.
// --review is the no-cost path: it writes a local page with every draft in
// rank order, a copy button per field, and a mailto link, which you paste into
// Zoho's web compose. Same ordering, same cap, same ledger.
//
// A refresh gives you the NEXT 12, not the same 12: every drafted domain is
// recorded in prospecting/state/drafted.json. --reset starts over.
//
// Once you mark a domain --sent, it leaves the pool and comes back on its own
// as a follow-up when one is due, scored so it lands wherever it deserves in a
// later batch rather than always at the top. Marking --replied or --dead stops
// that, which is the only thing standing between this and nagging someone who
// already said no.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import tls from 'node:tls';

const MONTHLY_PRICE = 50;
const DEFAULT_LIMIT = 12;
const STATE_PATH = 'prospecting/state/drafted.json';

// Days after a send before the next touch is due. Three touches total, then
// the lead is left alone whether or not it ever answered.
const FOLLOWUP_DAYS = [4, 10];
const FOLLOWUP_BONUS = 20;      // a contacted lead is warmer than a cold one
const OVERDUE_CAP = 14;         // but an ancient follow-up should not outrank everything

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);

const limit = parseInt(arg('--limit', String(DEFAULT_LIMIT)), 10);
const push = has('--push');
const review = has('--review');
const eml = has('--eml');
const pptx = has('--pptx');

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

// Follow-ups are short on purpose. The first email already made the argument;
// repeating it at length reads as pressure rather than persistence, and the
// third touch says plainly that it is the last one.
function renderFollowUp(row, contact, stage) {
  const name = contact?.firstName || 'there';
  const cat = row.catalog || {};
  const usd = row.currency === 'USD';
  const priced = cat.available && usd && row.paybackMonths;

  if (stage === 1) {
    return {
      subject: `re: ${row.domain}`,
      body: `Hi ${name},

Following up on the note about exit intent on ${row.domain}.${priced ? ` The short version: at your prices one recovered order covers about ${row.paybackMonths} ${row.paybackMonths === 1 ? 'month' : 'months'}.` : ''}

If this is not a priority right now, say so and I will stop.

Taylor`,
    };
  }

  return {
    subject: `re: ${row.domain}`,
    body: `Hi ${name},

Last one from me on this.

If exit intent is something you want to look at later in the year, reply and I will check back then. Otherwise I will leave you alone.

Taylor`,
  };
}

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

// Minimal IMAP client: LIST and APPEND only. No dependency, and deliberately
// no command that can send mail. Line-based rather than chunk-based, because
// a tagged response and a continuation request can arrive in the same packet.
function imapSession({ host, port, user, pass }, run) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => {});
    let buf = '';
    let tag = 0;
    let pending = null;      // { id, resolve, reject, untagged: [] }
    let literal = null;      // body to write when the server says "+"
    let greeted = false;

    const fail = (err) => { socket.destroy(); reject(err); };
    socket.setTimeout(45000, () => fail(new Error('IMAP timeout')));
    socket.on('error', fail);

    // IMAP quoted strings escape backslash and double quote. App passwords are
    // usually alphanumeric, but a password that isn't would otherwise produce a
    // confusing BAD instead of an obvious auth failure.
    const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

    const send = (cmd, literalBody = null) => new Promise((res, rej) => {
      const id = `a${++tag}`;
      pending = { id, resolve: res, reject: rej, untagged: [] };
      literal = literalBody;
      socket.write(`${id} ${cmd}\r\n`);
    });

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) > -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        if (!greeted) {
          greeted = true;
          Promise.resolve(run({ send, q }))
            .then((value) => { socket.end(); resolve(value); })
            .catch(fail);
          continue;
        }

        if (line.startsWith('+')) {
          if (literal != null) {
            socket.write(literal + '\r\n');
            literal = null;
          }
          continue;
        }

        if (line.startsWith('*')) {
          pending?.untagged.push(line);
          continue;
        }

        const m = line.match(/^(a\d+) (OK|NO|BAD)\s*(.*)$/);
        if (!m || !pending || pending.id !== m[1]) continue;
        const done = pending;
        pending = null;
        literal = null;
        if (m[2] === 'OK') done.resolve({ text: m[3], untagged: done.untagged });
        else done.reject(new Error(`${m[2]} ${m[3]}`));
      }
    });
  });
}

const imapLogin = (cfg) => imapSession(cfg, async ({ send, q }) => {
  await send(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
  await send('LOGOUT').catch(() => {});
  return { ok: true };
});

const imapFolders = (cfg) => imapSession(cfg, async ({ send, q }) => {
  await send(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
  const res = await send('LIST "" "*"');
  await send('LOGOUT').catch(() => {});
  return res.untagged
    .map((l) => (l.match(/"([^"]*)"\s*$/) || l.match(/\s(\S+)\s*$/) || [])[1])
    .filter(Boolean);
});

const imapAppend = (cfg, messages) => imapSession(cfg, async ({ send, q }) => {
  await send(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
  let appended = 0;
  for (const raw of messages) {
    // Literal length is in bytes, and the body must use CRLF line endings.
    const body = raw.replace(/\r?\n/g, '\r\n');
    await send(`APPEND ${q(cfg.folder)} (\\Draft) {${Buffer.byteLength(body, 'utf8')}}`, body);
    appended++;
  }
  await send('LOGOUT').catch(() => {});
  return { ok: true, appended };
});

function toMime({ from, to, subject, body }) {
  const date = new Date().toUTCString();
  return [
    ...(from ? [`From: ${from}`] : []),
    ...(to ? [`To: ${to}`] : ['To: ']),
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

// ---------------------------------------------------------------- ledger

const DAY = 86400000;
const emptyLead = () => ({ drafted: [], sent: [], replied: null, dead: null });

function loadState() {
  if (!existsSync(STATE_PATH)) return { version: 2, leads: {} };
  const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  if (raw.version === 2) return raw;
  // v1 was a flat list of drafted domains with no notion of sending.
  const leads = {};
  for (const d of raw.drafted || []) {
    leads[d.domain] = leads[d.domain] || emptyLead();
    leads[d.domain].drafted.push(d.at);
  }
  return { version: 2, leads };
}

function saveState(st) {
  mkdirSync('prospecting/state', { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

const normDomain = (d) => String(d).trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

// Where a lead stands right now: not yet touched, waiting out a gap between
// touches, due for the next one, finished, or closed by hand.
function leadStage(lead, now = Date.now()) {
  if (!lead) return { state: 'cold', stage: 0 };
  if (lead.replied) return { state: 'replied', stage: lead.sent.length };
  if (lead.dead) return { state: 'dead', stage: lead.sent.length };
  const sends = lead.sent.length;
  if (sends === 0) return { state: 'cold', stage: 0 };
  if (sends > FOLLOWUP_DAYS.length) return { state: 'exhausted', stage: sends };
  const last = new Date(lead.sent[sends - 1].at).getTime();
  const waitDays = FOLLOWUP_DAYS[sends - 1];
  const dueAt = last + waitDays * DAY;
  const overdueDays = Math.floor((now - dueAt) / DAY);
  return overdueDays >= 0
    ? { state: 'followup-due', stage: sends, overdueDays, dueAt }
    : { state: 'followup-waiting', stage: sends, daysUntil: Math.ceil((dueAt - now) / DAY), dueAt };
}

const state = loadState();
const leadFor = (domain) => state.leads[domain] || null;

if (has('--reset')) {
  saveState({ version: 2, leads: {} });
  console.error('ledger cleared');
  process.exit(0);
}

// --sent / --replied / --dead each take one or more domains.
for (const [flag, apply, verb] of [
  ['--sent', (l) => l.sent.push({ at: new Date().toISOString(), stage: l.sent.length + 1 }), 'sent'],
  ['--replied', (l) => { l.replied = new Date().toISOString(); }, 'replied'],
  ['--dead', (l) => { l.dead = new Date().toISOString(); }, 'closed'],
]) {
  const i = process.argv.indexOf(flag);
  if (i === -1) continue;
  const targets = process.argv.slice(i + 1).filter((a) => !a.startsWith('--')).map(normDomain);
  if (!targets.length) {
    console.error(`${flag} needs at least one domain`);
    process.exit(1);
  }
  for (const d of targets) {
    state.leads[d] = state.leads[d] || emptyLead();
    apply(state.leads[d]);
    const st = leadStage(state.leads[d]);
    let note = '';
    if (verb === 'sent') {
      note = st.state === 'exhausted'
        ? ', no further follow-ups (3 touches reached)'
        : `, follow-up ${st.stage + 1} due in ${FOLLOWUP_DAYS[st.stage - 1]} days`;
    }
    console.error(`${d}: ${verb} (touch ${state.leads[d].sent.length})${note}`);
  }
  saveState(state);
  process.exit(0);
}

if (has('--status')) {
  const entries = Object.entries(state.leads);
  if (!entries.length) {
    console.error('ledger empty');
    process.exit(0);
  }
  const buckets = {};
  for (const [domain, lead] of entries) {
    const st = leadStage(lead);
    (buckets[st.state] = buckets[st.state] || []).push({ domain, lead, st });
  }
  const order = ['followup-due', 'followup-waiting', 'cold', 'replied', 'dead', 'exhausted'];
  for (const key of order) {
    const list = buckets[key];
    if (!list) continue;
    console.error(`\n${key} (${list.length})`);
    for (const { domain, lead, st } of list.sort((a, b) => a.domain.localeCompare(b.domain))) {
      const when = key === 'followup-due' ? `  due ${st.overdueDays} day(s) ago`
        : key === 'followup-waiting' ? `  due in ${st.daysUntil} day(s)`
        : '';
      console.error(`  ${domain.padEnd(32)} touches ${lead.sent.length}${when}`);
    }
  }
  const total = entries.length;
  const sent = entries.filter(([, l]) => l.sent.length).length;
  console.error(`\n${total} lead(s) tracked, ${sent} contacted`);
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

// Zoho splits IMAP across two hostnames and five data centres, and picking the
// wrong one fails as "Invalid credentials" rather than as a wrong host, which
// sends you hunting for a password problem that isn't there. Paid and custom
// domain accounts generally live on imappro; free personal ones on imap.
const ZOHO_HOSTS = [
  'imappro.zoho.com', 'imap.zoho.com',
  'imappro.zoho.eu', 'imap.zoho.eu',
  'imappro.zoho.in', 'imap.zoho.in',
  'imappro.zoho.com.au', 'imap.zoho.com.au',
  'imappro.zoho.jp', 'imap.zoho.jp',
];

// Both --test-connection and --push need this. Keeping it in one place is the
// whole point: the first version validated only in the test path, so --push
// happily attempted a login with a placeholder address.
function requireCredentials() {
  if (!zoho.user || !zoho.pass) {
    console.error('set ZOHO_USER and ZOHO_APP_PASSWORD first (Zoho > Settings > Security > App Passwords)');
    process.exit(1);
  }
  // The setup instructions carry example values, and pasting one verbatim
  // fails as an auth error rather than as an obviously wrong value.
  if (/^(you@yourdomain\.com|your-actual@address\.com|user@example\.com)$/i.test(zoho.user)) {
    console.error(`ZOHO_USER is still the placeholder "${zoho.user}". Set it to your real Zoho address.`);
    process.exit(1);
  }
  // Paste artefacts cause the same error. The value is described, never echoed.
  const rawPass = process.env.ZOHO_APP_PASSWORD || '';
  if (rawPass !== rawPass.trim()) console.error('note: password has leading/trailing whitespace, trimming it');
  if (/\s/.test(rawPass.trim())) console.error('note: password contains a space. Zoho app passwords usually have none. Check the paste.');
  if (!zoho.user.includes('@')) console.error(`note: ZOHO_USER is "${zoho.user}" with no @. Zoho normally wants the full address.`);
  zoho.pass = rawPass.trim();
}

if (has('--test-connection')) {
  requireCredentials();

  const hosts = process.env.ZOHO_IMAP_HOST ? [process.env.ZOHO_IMAP_HOST] : ZOHO_HOSTS;
  console.error(`user: ${zoho.user}`);
  console.error(`trying ${hosts.length} host(s)...\n`);

  let winner = null;
  for (const host of hosts) {
    const cfg = { ...zoho, host };
    try {
      await imapLogin(cfg);
      console.error(`  ${host.padEnd(22)} OK`);
      winner = host;
      break;
    } catch (err) {
      console.error(`  ${host.padEnd(22)} ${err.message.slice(0, 70)}`);
    }
  }

  if (!winner) {
    console.error('\nNo host accepted these credentials. In order of likelihood:');
    console.error('  1. IMAP not enabled yet: Zoho Mail > Settings > Mail Accounts > your address > IMAP');
    console.error('  2. Login password used where an app-specific password is required');
    console.error('  3. App password generated before IMAP was enabled: regenerate it');
    console.error('  4. ZOHO_USER should be the full email address');
    process.exit(1);
  }

  console.error(`\nlogin OK on ${winner}`);
  if (winner !== 'imap.zoho.com') console.error(`add to your shell:  export ZOHO_IMAP_HOST='${winner}'`);
  try {
    const folders = await imapFolders({ ...zoho, host: winner });
    console.error(`folders: ${folders.join(', ')}`);
    const match = folders.find((f) => f.toLowerCase() === zoho.folder.toLowerCase());
    console.error(match
      ? `drafts folder "${zoho.folder}" found`
      : `WARNING: no folder named "${zoho.folder}". Set ZOHO_DRAFTS_FOLDER to one of the above.`);
  } catch (err) {
    console.error(`folder list failed: ${err.message}`);
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

// A lead is eligible if it has never been drafted, or if it was sent and a
// follow-up has come due. Everything else is deliberately out: mid-cadence
// leads, replies, closed leads, and anything that has had its three touches.
const ranked = rows
  .map((row) => {
    const a = anger.get(row.domain);
    const c = contacts.get(row.domain);
    const lead = leadFor(row.domain);
    const st = leadStage(lead);
    const score = scoreRow(row, a, c);
    if (st.state === 'followup-due') {
      // A contacted lead outranks a cold one at the same base score, and an
      // overdue one climbs further, but the bonus is capped so a forgotten
      // follow-up cannot permanently own the top of the list.
      score.parts.followUp = FOLLOWUP_BONUS;
      const overdue = Math.min(st.overdueDays, OVERDUE_CAP);
      if (overdue > 0) score.parts.overdue = overdue;
      score.total += FOLLOWUP_BONUS + overdue;
    }
    return { row, anger: a, contact: c, score, lead, st };
  })
  .filter((r) => {
    if (r.st.state === 'followup-due') return true;
    if (r.st.state !== 'cold') return false;         // waiting, replied, dead, exhausted
    if (has('--include-drafted')) return true;
    return !(r.lead?.drafted?.length);               // already drafted, never sent
  })
  .sort((a, b) => b.score.total - a.score.total);

const picked = ranked.slice(0, limit);

if (!picked.length) {
  const tracked = Object.keys(state.leads).length;
  console.error(`nothing eligible right now (${tracked} lead(s) tracked).`);
  console.error('--status to see what is waiting, --include-drafted to revisit, --reset to start over.');
  process.exit(0);
}

console.error(`scan:     ${scanPath}`);
console.error(`reviews:  ${reviewsPath || 'none'}`);
console.error(`contacts: ${contacts.size} loaded`);
console.error(`eligible: ${ranked.length}, drafting top ${picked.length}\n`);

// Whatever address you will actually send from. Only --push truly needs it.
const me = zoho.from || process.env.RESPARQ_FROM || '';

function recordDrafted(list) {
  const at = new Date().toISOString();
  for (const p of list) {
    state.leads[p.row.domain] = state.leads[p.row.domain] || emptyLead();
    state.leads[p.row.domain].drafted.push(at);
  }
  saveState(state);
  const tracked = Object.keys(state.leads).length;
  console.error(`ledger: ${tracked} lead(s) tracked`);
  console.error(`after you send one: node prospecting/draft-emails.mjs --sent ${list[0].row.domain}`);
}

const messages = [];
const drafts = [];
picked.forEach((p, i) => {
  const isFollowUp = p.st.state === 'followup-due';
  const { subject, body } = isFollowUp
    ? renderFollowUp(p.row, p.contact, p.st.stage)
    : render(p.row, p.anger, p.contact);
  // --review and --eml need no Zoho credentials, so the from/to placeholders
  // must not depend on them being set.
  const needsContact = !p.contact?.email;
  const to = needsContact ? '' : p.contact.email;
  const finalSubject = needsContact ? `[NEEDS CONTACT: ${p.row.domain}] ${subject}` : subject;
  const banner = needsContact
    ? `>> No contact yet for ${p.row.domain}. Find the founder or head of ecommerce, put them in the To: line, delete this banner.\n>> Store name: ${p.anger?.storeName || '?'} | ${p.anger?.country || '?'}\n\n`
    : '';

  messages.push(toMime({ from: me, to, subject: finalSubject, body: banner + body }));
  drafts.push({
    rank: i + 1, domain: p.row.domain, to, subject: finalSubject, body: banner + body,
    score: p.score.total, scenario: p.row.scenario,
    touch: isFollowUp ? p.st.stage + 1 : 1,
    overdueDays: isFollowUp ? p.st.overdueDays : null,
    catalog: p.row.catalog || {}, currency: p.row.currency || null,
    vendors: p.row.vendors || [], paybackMonths: p.row.paybackMonths ?? null,
    discountHints: p.row.discountHints || [],
    why: Object.entries(p.score.parts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`),
    storeName: p.anger?.storeName || null, country: p.anger?.country || null,
    needsContact,
  });

  const top = Object.entries(p.score.parts).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(', ');
  const touchLabel = isFollowUp ? ` [follow-up ${p.st.stage + 1}${p.st.overdueDays > 0 ? `, ${p.st.overdueDays}d overdue` : ''}]` : '';
  console.error(`${String(i + 1).padStart(2)}. ${p.row.domain.padEnd(30)} score ${String(p.score.total).padStart(3)}  ${p.row.scenario}${touchLabel}`);
  console.error(`    why: ${top || 'no signals'}`);
  if (!push && !review && !eml) {
    console.error(`    subj: ${finalSubject}`);
    console.error(banner + body ? `    ${(banner + body).split('\n').join('\n    ')}` : '');
  }
  console.error('');
});


// ------------------------------------------------- no-IMAP output paths

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function reviewPage(list) {
  const cards = list.map((d) => `
  <article class="card${d.needsContact ? ' needs' : ''}">
    <header>
      <span class="rank">${d.rank}</span>
      <div class="ident">
        <h2>${esc(d.domain)}</h2>
        <p class="meta">${esc(d.scenario)} &middot; score ${d.score}${d.storeName ? ` &middot; ${esc(d.storeName)}` : ''}${d.country ? ` &middot; ${esc(d.country)}` : ''}</p>
      </div>
      ${d.needsContact ? '<span class="flag">needs contact</span>' : ''}
    </header>
    <ul class="why">${d.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <div class="field">
      <label>To</label>
      <div class="row"><code>${d.to ? esc(d.to) : '&mdash; fill in after you find the contact'}</code>${d.to ? `<button data-copy="${esc(d.to)}">copy</button>` : ''}</div>
    </div>
    <div class="field">
      <label>Subject</label>
      <div class="row"><code>${esc(d.subject)}</code><button data-copy="${esc(d.subject)}">copy</button></div>
    </div>
    <div class="field">
      <label>Body</label>
      <pre id="b${d.rank}">${esc(d.body)}</pre>
      <div class="actions">
        <button data-copy-el="b${d.rank}">copy body</button>
        <a class="mailto" href="mailto:${d.to ? encodeURIComponent(d.to) : ''}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}">open in mail client</a>
      </div>
    </div>
  </article>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resparq drafts</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#1a1a18; --muted:#6b6b66; --line:#e2e2dd; --accent:#1c5d99; --flag:#9a4a1e; --flagbg:#fdf0e6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16161a; --card:#1e1e23; --ink:#eceCe8; --muted:#9a9a94; --line:#32323a; --accent:#7fb3e0; --flag:#e0a070; --flagbg:#2e2318; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:32px 20px 80px; }
  .wrap { max-width:820px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 28px; font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:18px; }
  .card.needs { border-left:3px solid var(--flag); }
  header { display:flex; align-items:flex-start; gap:12px; }
  .rank { font-variant-numeric:tabular-nums; font-weight:700; color:var(--muted); min-width:24px; }
  .ident { flex:1; }
  h2 { font-size:16px; margin:0; word-break:break-all; }
  .meta { margin:2px 0 0; font-size:12px; color:var(--muted); }
  .flag { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--flag); background:var(--flagbg); padding:3px 8px; border-radius:20px; white-space:nowrap; }
  .why { list-style:none; display:flex; flex-wrap:wrap; gap:6px; padding:0; margin:12px 0 4px 36px; }
  .why li { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:2px 6px; }
  .field { margin:14px 0 0 36px; }
  label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:4px; }
  .row { display:flex; align-items:center; gap:8px; }
  code { flex:1; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:6px 8px; overflow-x:auto; }
  pre { font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:12px; margin:0; overflow-x:auto; }
  button { font:inherit; font-size:12px; cursor:pointer; background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:5px; padding:5px 11px; }
  button:hover { border-color:var(--accent); color:var(--accent); }
  button.done { border-color:var(--accent); color:var(--accent); }
  .actions { display:flex; align-items:center; gap:12px; margin-top:8px; }
  .mailto { font-size:12px; color:var(--accent); }
  @media (max-width:640px){ .why,.field{margin-left:0;} }
</style></head><body><div class="wrap">
<h1>Resparq drafts</h1>
<p class="sub">${list.length} draft${list.length === 1 ? '' : 's'}, best lead first. Copy into Zoho web compose. Nothing here sends.</p>
${cards}
</div>
<script>
  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = 'copied'; btn.classList.add('done');
      setTimeout(() => { btn.textContent = t; btn.classList.remove('done'); }, 1200); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done); return; }
    // file:// is not a secure context in every browser, so keep the old path.
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } finally { ta.remove(); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy != null) copy(b.dataset.copy, b);
    else if (b.dataset.copyEl) copy(document.getElementById(b.dataset.copyEl).textContent, b);
  });
</script></body></html>`;
}

if (review || eml || pptx) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = `prospecting/out/drafts-${stamp}`;
  mkdirSync(dir, { recursive: true });
  if (eml) {
    drafts.forEach((d, i) => {
      const safe = d.domain.replace(/[^a-z0-9.-]/gi, '_');
      writeFileSync(`${dir}/${String(i + 1).padStart(2, '0')}-${safe}.eml`, messages[i]);
    });
    console.error(`wrote ${drafts.length} .eml file(s) to ${dir}/`);
  }
  if (pptx) {
    const { buildDeck } = await import('./deck.mjs');
    const out = `${dir}/outreach.pptx`;
    await buildDeck(drafts, out, { date: stamp.slice(0, 10) });
    console.error(`wrote ${out}`);
  }
  if (review) {
    const page = `${dir}/review.html`;
    writeFileSync(page, reviewPage(drafts));
    console.error(`wrote ${page}`);
    console.error(`open it:  open ${page}`);
  }
  recordDrafted(picked);
}

if (push) {
  requireCredentials();
  let res;
  try {
    res = await imapAppend(zoho, messages);
  } catch (err) {
    // A stack trace here says nothing useful: every real cause is configuration.
    console.error(`\npush FAILED on ${zoho.host}: ${err.message}`);
    if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(err.message)) {
      console.error(process.env.ZOHO_IMAP_HOST
        ? 'ZOHO_IMAP_HOST is set, so only that host was tried. Run --test-connection to check the others.'
        : 'No ZOHO_IMAP_HOST set, so this used imap.zoho.com. Paid accounts are usually on imappro.zoho.com.');
      console.error('Run: node prospecting/draft-emails.mjs --test-connection');
    } else if (/NO \[?TRYCREATE|Mailbox does not exist|NONEXISTENT/i.test(err.message)) {
      console.error(`No folder named "${zoho.folder}". Run --test-connection to list them, then set ZOHO_DRAFTS_FOLDER.`);
    }
    console.error('Nothing was drafted and the ledger is unchanged. --review works without IMAP.');
    process.exit(1);
  }
  console.error(`appended ${res.appended} draft(s) to "${zoho.folder}" on ${zoho.host}`);
  recordDrafted(picked);
} else if (!review && !eml) {
  console.error('preview only. --pptx writes a deck, --review a browser page, --eml files, --push needs Zoho IMAP.');
}
