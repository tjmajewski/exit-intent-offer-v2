#!/usr/bin/env node
// "The merchant says nobody sees the modal." Answers that, in order.
//
//   flyctl ssh console -a resparq -C 'node scripts/ops/why-no-render.mjs 568e5d-75.myshopify.com'
//   node scripts/ops/why-no-render.mjs <shop-domain> [days]
//
// READ-ONLY. Every query is a find/count/groupBy. Nothing writes.
//
// ========================= WHY THIS EXISTS =================================
//
// The operator console reports "Last 50 decisions · 3 actually shown", which
// reads as a 6% show rate and sends everyone hunting for a bug. It is not the
// real ratio. Most `AIDecision` rows are `carts/update` PRE-DECISIONS that show
// no modal and were never meant to: on 2026-09-22, 43 of 50. The real figure was
// 3 of 7 storefront decisions, roughly 43%, which is unremarkable.
//
// So question one is always "what is the denominator", and this script refuses
// to mix the two populations.
//
// After that, a decision can fail to reach a shopper for FOUR different reasons,
// and they are not equally visible. In rough order of how often they bite:
//
//   1. The trigger never fired. Decisions are minted at PREFETCH on every carted
//      page load, before any trigger. Most visitors simply never exit-intent or
//      idle long enough. This is the design working, not a fault, and it is the
//      largest bucket.
//
//   2. The CLIENT-SIDE frequency gate suppressed it, and the server cannot see
//      that at all. exit-intent-modal.js holds a localStorage gate with
//      cooldownDays (default 3) and maxShowsPer30d (default 5), and the cooldown
//      DOUBLES per ignore streak: 3 -> 6 -> 12 -> 24 -> 30 days. A visitor who
//      dismissed one modal is locked out for days. The decision is still minted
//      and still counted, so it looks identical to "the trigger never fired".
//      This script cannot measure it directly; it flags the settings so you can
//      judge, and it reports ignoreStreak from the journey log as a proxy.
//
//   3. confirm-render was lost. `rendered` only flips via a fire-and-forget
//      fetch to /apps/exit-intent/api/confirm-render. An ad blocker, a CSP, a
//      flaky network or a fast navigation loses it, the modal WAS seen, and the
//      engine records rendered=false and learns "never show". That is
//      HANDOFF-2026-09-19 §2 item 5, still open. The tell is clicks or
//      conversions on impressions marked rendered=false — a shopper cannot click
//      a modal that never rendered.
//
//   4. The request crashed. A 500 in the decision endpoint writes NOTHING, so
//      the failure is absent rather than logged. Detected by diffing
//      VariantImpression against storefront AIDecision rows: impressions are
//      written BEFORE the work that can fail, decisions after. That gap is how
//      the 2026-09-21 discount outage was finally found, after a week. See
//      HANDOFF-2026-09-21 §2.2.

/* eslint-env node */
import { PrismaClient } from '@prisma/client';

const SHOP = process.argv[2];
const DAYS = Number(process.argv[3] || 30);
if (!SHOP) {
  console.error('usage: node scripts/ops/why-no-render.mjs <shop-domain> [days]');
  process.exit(1);
}

const db = new PrismaClient();
const since = new Date(Date.now() - DAYS * 864e5);

const shop = await db.shop.findFirst({ where: { shopifyDomain: SHOP } });
if (!shop) { console.error(`No shop ${SHOP}`); await db.$disconnect(); process.exit(1); }

const pad = (n, w = 5) => String(n).padStart(w);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');
const table = (title, obj) => {
  console.log(`\n${title}`);
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { console.log('   (none)'); return; }
  for (const [k, v] of rows) console.log(`  ${pad(v)}  ${k}`);
};

console.log(`\n${'='.repeat(70)}`);
console.log(`${SHOP} — last ${DAYS} days`);
console.log(`mode=${shop.mode} plan=${shop.plan} aggression=${shop.aggression} aiGoal=${shop.aiGoal}`);
console.log('='.repeat(70));

// ---------------------------------------------------------------- 1. denominator
const decisions = await db.aIDecision.findMany({
  where: { shopId: shop.id, createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' }
});

const storefront = [];
const preDecisions = [];
for (const row of decisions) {
  let d = {}, s = {};
  try { d = JSON.parse(row.decision || '{}'); } catch (_) { /* unparseable row */ }
  try { s = JSON.parse(row.signals || '{}'); } catch (_) { /* unparseable row */ }
  (d.source ? preDecisions : storefront).push({ row, d, s });
}

console.log(`\n### 1. THE DENOMINATOR — do not mix these`);
console.log(`  AIDecision rows total .................. ${pad(decisions.length)}`);
console.log(`  pre-decisions (never show a modal) ..... ${pad(preDecisions.length)}  <- exclude from every rate`);
console.log(`  real storefront decisions .............. ${pad(storefront.length)}  <- the only valid denominator`);
if (preDecisions.length) {
  const bySource = {};
  for (const p of preDecisions) bySource[p.d.source] = (bySource[p.d.source] || 0) + 1;
  table('  pre-decision writers:', bySource);
}

// ---------------------------------------------------------------- 2. the funnel
const imps = await db.variantImpression.findMany({
  where: { shopId: shop.id, timestamp: { gte: since } },
  select: { rendered: true, clicked: true, converted: true, archetype: true,
            deviceType: true, triggerReason: true, discountAmount: true }
});
const rendered = imps.filter((i) => i.rendered);
const offers = await db.discountOffer.count({ where: { shopId: shop.id, createdAt: { gte: since } } });

console.log(`\n### 2. THE FUNNEL`);
console.log(`  storefront decisions ................... ${pad(storefront.length)}`);
console.log(`  VariantImpression rows ................. ${pad(imps.length)}`);
console.log(`  rendered=true .......................... ${pad(rendered.length)}  (${pct(rendered.length, imps.length)} of impressions)`);
console.log(`  clicked ................................ ${pad(imps.filter((i) => i.clicked).length)}`);
console.log(`  converted .............................. ${pad(imps.filter((i) => i.converted).length)}`);
console.log(`  DiscountOffer codes minted ............. ${pad(offers)}`);
if (offers === 0 && storefront.some(({ d }) => d.type && d.type !== 'no-discount' && d.type !== 'holdout')) {
  console.log(`  >> Discount decisions exist but NO codes were minted. Run`);
  console.log(`  >> scripts/ops/probe-discount-mint.mjs — this is the 2026-09-21 outage shape.`);
}

// ------------------------------------------------- 3. crashes (the invisible ones)
// Impressions are written BEFORE the work that can fail; decisions after. Only
// non-holdout storefront decisions get an impression, so compare like with like.
const decisionsWithImpression = storefront.filter(({ d }) => d.type !== 'holdout').length;
const gap = imps.length - decisionsWithImpression;
console.log(`\n### 3. CRASHED REQUESTS (write nothing, so only a gap reveals them)`);
console.log(`  impressions ............................ ${pad(imps.length)}`);
console.log(`  storefront decisions (excl. holdout) ... ${pad(decisionsWithImpression)}`);
console.log(`  gap .................................... ${pad(gap)}`);
if (gap > 2) {
  console.log(`  >> ${gap} request(s) wrote an impression and NO decision — they threw`);
  console.log(`  >> between recordImpression and aIDecision.create and returned 500.`);
  console.log(`  >> The shopper saw nothing and nothing was logged. Check which`);
  console.log(`  >> archetypes are missing from section 5 below.`);
} else {
  console.log(`  >> No meaningful gap. Requests are completing.`);
}

// --------------------------------------------- 4. confirm-render loss
// A shopper cannot click or convert on a modal that never rendered, so any such
// row proves the confirm-render fetch was lost rather than the modal unseen.
const ghostClicks = imps.filter((i) => !i.rendered && (i.clicked || i.converted)).length;
console.log(`\n### 4. confirm-render RELIABILITY`);
console.log(`  impressions marked NOT rendered ........ ${pad(imps.length - rendered.length)}`);
console.log(`  ...of those, clicked or converted ...... ${pad(ghostClicks)}`);
if (ghostClicks > 0) {
  console.log(`  >> ${ghostClicks} shopper(s) interacted with a modal recorded as never rendered.`);
  console.log(`  >> confirm-render is being LOST (ad blocker / CSP / fast navigation).`);
  console.log(`  >> Every show-side learner is therefore under-counting. 09-19 §2 item 5.`);
} else {
  console.log(`  >> No proof of loss in this window. Absence of proof only —`);
  console.log(`  >> with 0 clicks overall this check cannot fire either way.`);
}

// --------------------------------------------- 5. where the storefront ones went
const byType = {}, byTrigger = {}, byDevice = {}, bySupp = {};
for (const { d, s } of storefront) {
  byType[d.type || 'unknown'] = (byType[d.type || 'unknown'] || 0) + 1;
  const trig = d.triggerType ? `${d.triggerType}${d.idleSeconds ? ` (${d.idleSeconds}s)` : ''}` : 'unset';
  byTrigger[trig] = (byTrigger[trig] || 0) + 1;
  byDevice[s.deviceType || 'unknown'] = (byDevice[s.deviceType || 'unknown'] || 0) + 1;
  if (d.offerSuppression) {
    const k = `${d.offerSuppression.kind}/${d.offerSuppression.code}`;
    bySupp[k] = (bySupp[k] || 0) + 1;
  }
}
console.log(`\n### 5. STOREFRONT DECISIONS — what was decided`);
table('  decision.type:', byType);
table('  trigger the client was told to arm:', byTrigger);
table('  device:', byDevice);
table('  offerSuppression (why no discount):', bySupp);

const byArch = {};
for (const i of imps) {
  byArch[`${i.archetype || 'null'}  rendered=${i.rendered}`] = (byArch[`${i.archetype || 'null'}  rendered=${i.rendered}`] || 0) + 1;
}
table('  archetype x rendered (a discount archetype at 0 rendered = crash):', byArch);

// --------------------------------------------- 6. the client-side gate we cannot see
const touches = await db.visitorTouch.findMany({
  where: { shopId: shop.id, timestamp: { gte: since } },
  select: { response: true, surface: true, ignoreStreak: true, showNumber: true, visitorId: true }
});
const byResponse = {};
for (const t of touches) byResponse[`${t.surface}/${t.response}`] = (byResponse[`${t.surface}/${t.response}`] || 0) + 1;

const streaks = touches.map((t) => t.ignoreStreak).filter((n) => typeof n === 'number');
const maxStreak = streaks.length ? Math.max(...streaks) : 0;
const visitors = new Set(touches.map((t) => t.visitorId).filter(Boolean)).size;

console.log(`\n### 6. THE CLIENT-SIDE FREQUENCY GATE — invisible to the server`);
console.log(`  distinct visitors in the journey log .... ${pad(visitors)}`);
console.log(`  highest ignoreStreak seen .............. ${pad(maxStreak)}`);
console.log(`  implied cooldown at that streak ........ ${pad(Math.min(3 * Math.pow(2, maxStreak), 30))} days`);
table('  journey log surface/response:', byResponse);
console.log(`
  exit-intent-modal.js holds a localStorage gate the server never sees:
  cooldownDays (default 3) and maxShowsPer30d (default 5), with the cooldown
  DOUBLING per ignore streak (3 -> 6 -> 12 -> 24 -> 30, capped).

  A visitor inside that window gets a decision minted and NO modal, which is
  indistinguishable here from "the trigger never fired". If renders look low and
  sections 3 and 4 are clean, check the merchant's frequency settings before
  assuming a bug.`);

// --------------------------------------------- verdict
console.log(`\n${'='.repeat(70)}`);
console.log('VERDICT');
console.log('='.repeat(70));
const renderRate = imps.length ? rendered.length / imps.length : 0;
if (storefront.length === 0) {
  console.log('  No storefront decisions at all. Either no carted traffic, or the');
  console.log('  extension is not loading. Check the theme app embed is enabled.');
} else if (gap > 2) {
  console.log(`  CRASHES are the main loss: ${gap} requests died before writing a decision.`);
  console.log('  Fix that first; everything else is downstream noise.');
} else if (ghostClicks > 0) {
  console.log('  confirm-render LOSS is proven. Renders are under-reported and every');
  console.log('  show-side learner is biased toward "never show".');
} else if (imps.length === 0) {
  console.log(`  ${storefront.length} storefront decision(s) but ZERO VariantImpression rows.`);
  console.log('  Impressions are skipped for holdouts, for dev-shop writes, and when the');
  console.log('  opening surface is the pill. If none of those apply, recordImpression is');
  console.log('  failing and no show-side learning is happening at all.');
} else if (renderRate < 0.15) {
  console.log(`  Render rate ${pct(rendered.length, imps.length)} with no crashes and no proven confirm-render loss.`);
  console.log('  Most likely the client-side frequency gate (section 6) or genuinely');
  console.log('  few visitors triggering. Check frequency settings next.');
} else {
  console.log(`  Render rate ${pct(rendered.length, imps.length)} of impressions, no crash gap, no proven`);
  console.log('  confirm-render loss. This is normal: decisions are minted at prefetch');
  console.log('  and most visitors never trigger. Judge against storefront decisions,');
  console.log('  never against the raw AIDecision count.');
}
console.log('');

await db.$disconnect();
