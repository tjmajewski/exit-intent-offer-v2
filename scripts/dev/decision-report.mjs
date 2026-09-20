#!/usr/bin/env node
// =============================================================================
// Decision report — what the engine decided, and what reached a shopper.
//
// Answers two questions the super-admin console cannot, because it only shows
// the most recent 50 rows:
//   1. How often is a discount actually withheld, and by which branch?
//   2. Of the decisions that DID carry an offer, how many ever rendered?
//
// USAGE (against production, without deploying anything):
//
//   fly proxy 15432:5432 -a <your-db-app>        # leave running in one tab
//   DATABASE_URL="postgres://<user>:<pass>@localhost:15432/<db>" \
//     node scripts/dev/decision-report.mjs [days]
//
// Get the connection string with:  fly postgres connect -a <your-db-app>
// or read it off:                  fly secrets list -a resparq
// =============================================================================
import { PrismaClient } from '@prisma/client';

const days = Number(process.argv[2] || 7);
const db = new PrismaClient();
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const row = (a, b, c) => console.log(`  ${String(a).padEnd(34)} ${String(b).padStart(6)}  ${c}`);

const shops = await db.shop.findMany({ select: { id: true, shopifyDomain: true } });

for (const shop of shops) {
  const decisions = await db.aIDecision.findMany({
    where: { shopId: shop.id, createdAt: { gte: since } },
    select: { id: true, decision: true },
  });
  if (decisions.length === 0) continue;

  console.log(`\n${shop.shopifyDomain}  —  ${decisions.length} decisions in ${days}d`);

  // Split the live path from cart-webhook / idle pre-decisions. Only live
  // decisions can be suppressed, and only live decisions can ever render.
  const live = [], pre = [];
  for (const d of decisions) {
    let j; try { j = JSON.parse(d.decision); } catch { continue; }
    (j.source ? pre : live).push({ id: d.id, ...j });
  }
  console.log(`  live path: ${live.length}   pre-decisions (never meant to surface): ${pre.length}`);

  console.log('\n  WHY NO OFFER (live path only)');
  const bySup = new Map();
  for (const d of live) {
    const key = d.offerSuppression?.code || (d.amount > 0 ? '(offer made)' : '(no record)');
    bySup.set(key, (bySup.get(key) || 0) + 1);
  }
  for (const [k, v] of [...bySup].sort((a, b) => b[1] - a[1])) row(k, v, pct(v, live.length));

  // Did it reach anyone? InterventionOutcome.rendered is the only truth here;
  // a decision exists from prefetch, a render is a separate confirmed event.
  const outcomes = await db.interventionOutcome.findMany({
    where: { shopId: shop.id, timestamp: { gte: since }, aiDecisionId: { not: null } },
    select: { aiDecisionId: true, wasShown: true, rendered: true, converted: true },
  });
  const byId = new Map(outcomes.map((o) => [o.aiDecisionId, o]));

  console.log('\n  DID IT REACH ANYONE (live path only)');
  let withOffer = 0, offerRendered = 0, noOffer = 0, noOfferRendered = 0, converted = 0;
  for (const d of live) {
    const o = byId.get(d.id);
    const hadOffer = Number(d.amount) > 0;
    if (hadOffer) { withOffer++; if (o?.rendered) offerRendered++; }
    else { noOffer++; if (o?.rendered) noOfferRendered++; }
    if (o?.converted) converted++;
  }
  row('decisions carrying an offer', withOffer, pct(withOffer, live.length));
  row('  ...that actually rendered', offerRendered, pct(offerRendered, withOffer));
  row('decisions with no offer', noOffer, pct(noOffer, live.length));
  row('  ...that actually rendered', noOfferRendered, pct(noOffer ? noOfferRendered : 0, noOffer));
  row('converted', converted, pct(converted, live.length));

  // Reach by trigger gene — the §2 question. A gene chosen often but rendering
  // rarely is the reach problem made visible.
  const imps = await db.variantImpression.findMany({
    where: { shopId: shop.id, timestamp: { gte: since } },
    select: { rendered: true, deviceType: true, variant: { select: { triggerType: true, idleSeconds: true } } },
  });
  if (imps.length) {
    console.log('\n  REACH BY TRIGGER GENE  (decided -> rendered)');
    const byTrig = new Map();
    for (const i of imps) {
      const k = `${i.variant?.triggerType || '?'}${i.variant?.idleSeconds ? `/${i.variant.idleSeconds}s` : ''} · ${i.deviceType || '?'}`;
      const cur = byTrig.get(k) || { decided: 0, rendered: 0 };
      cur.decided++; if (i.rendered) cur.rendered++;
      byTrig.set(k, cur);
    }
    for (const [k, v] of [...byTrig].sort((a, b) => b[1].decided - a[1].decided)) {
      row(k, v.decided, `${v.rendered} rendered (${pct(v.rendered, v.decided)})`);
    }
  }
}

await db.$disconnect();
