// Read-only diagnostic: what offers is the AI actually serving one shop, and
// at what intent scores? Answers "are we giving threshold offers to people who
// were never going to buy?" without guessing from the decision log.
//
//   fly ssh console -a resparq -C "node scripts/probe-shop-decisions.js <domain-fragment>"
//
// Writes nothing. Safe to run against production.

// ESM: package.json sets "type": "module", so require() is unavailable here.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const fragment = process.argv[2];
if (!fragment) {
  console.error('usage: node scripts/probe-shop-decisions.js <domain-fragment>');
  process.exit(1);
}

const band = (p) => (p == null ? 'unknown' : p < 50 ? 'LOW' : p < 70 ? 'MID' : 'HIGH');
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '-');

(async () => {
  const shop = await db.shop.findFirst({
    where: { shopifyDomain: { contains: fragment } },
    select: { id: true, shopifyDomain: true, mode: true, plan: true, aggression: true, aiGoal: true },
  });
  if (!shop) {
    console.log(`No shop matching "${fragment}"`);
    return;
  }
  console.log(`\n${shop.shopifyDomain}  mode=${shop.mode} plan=${shop.plan} aggression=${shop.aggression}\n`);

  const decisions = await db.aIDecision.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { signals: true, decision: true, createdAt: true },
  });

  const rows = [];
  for (const d of decisions) {
    let s = {}, x = {};
    try { s = JSON.parse(d.signals) || {}; } catch {}
    try { x = JSON.parse(d.decision) || {}; } catch {}
    rows.push({
      p: s.propensityScore ?? null,
      page: s.exitPage ?? null,
      cart: s.cartValue ?? null,
      type: x.type ?? (x.show === false ? 'skip' : null),
      amount: x.amount ?? null,
      threshold: x.threshold ?? null,
      archetype: x.archetype ?? null,
    });
  }
  console.log(`Decisions sampled: ${rows.length}\n`);

  // Intent distribution — if everything is LOW, the propensity model is the
  // problem, not the offer mapping.
  const hist = {};
  for (const r of rows) {
    const key = r.p == null ? 'unknown' : `${Math.floor(r.p / 10) * 10}-${Math.floor(r.p / 10) * 10 + 9}`;
    hist[key] = (hist[key] || 0) + 1;
  }
  console.log('Propensity distribution');
  for (const k of Object.keys(hist).sort()) {
    console.log(`  ${k.padEnd(9)} ${String(hist[k]).padStart(4)}  ${pct(hist[k], rows.length)}`);
  }

  // The actual question: which offer shape does each intent band receive?
  console.log('\nOffer shape by intent band');
  const grid = {};
  for (const r of rows) {
    const key = `${band(r.p)} -> ${r.type || 'none'}`;
    grid[key] = (grid[key] || 0) + 1;
  }
  for (const k of Object.keys(grid).sort()) {
    console.log(`  ${k.padEnd(24)} ${String(grid[k]).padStart(4)}  ${pct(grid[k], rows.length)}`);
  }

  // How big an ask is each threshold offer, relative to what's already in the
  // cart? A high percentage on a low-intent visitor is the case to scrutinise.
  const thresholds = rows.filter((r) => r.type === 'threshold' && r.cart > 0 && r.threshold > 0);
  if (thresholds.length) {
    console.log(`\nThreshold offers: ${thresholds.length}`);
    const asks = thresholds.map((r) => ((r.threshold - r.cart) / r.cart) * 100).sort((a, b) => a - b);
    const median = asks[Math.floor(asks.length / 2)];
    const lowIntent = thresholds.filter((r) => r.p != null && r.p < 50).length;
    console.log(`  median extra spend asked: ${median.toFixed(0)}% of current cart`);
    console.log(`  served to LOW intent (<50): ${lowIntent} (${pct(lowIntent, thresholds.length)})`);
  }

  // Outcome side: did the shapes actually differ in result?
  const outcomes = await db.interventionOutcome.groupBy({
    by: ['scoreBucket', 'wasShown'],
    where: { shopId: shop.id },
    _count: { _all: true },
    _sum: { revenue: true, profit: true },
  });
  console.log('\nOutcomes by score bucket (bucket | shown | n | revenue | profit)');
  for (const o of outcomes.sort((a, b) => a.scoreBucket.localeCompare(b.scoreBucket))) {
    console.log(
      `  ${o.scoreBucket.padEnd(7)} ${String(o.wasShown).padEnd(6)} ${String(o._count._all).padStart(4)}` +
      `  $${(o._sum.revenue || 0).toFixed(0).padStart(7)}  $${(o._sum.profit || 0).toFixed(0).padStart(7)}`
    );
  }
  console.log('');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
