// Margin-invariant + propensity-curve regression guard for the unified offer
// engine. No test runner in this project, so this is a standalone node harness:
//
//   node scripts/dev/verify-margin-invariant.mjs
//
// Asserts (exit 1 on any failure):
//   1. For every (propensity, aggression, assumedGrossMargin) in a randomized
//      matrix, the discount ceiling keeps post-discount gross margin >= 20%,
//      consumes <= half the gross margin, and never exceeds 25%.
//   2. aggression 0 => 0% (announce-only) on every path.
//   3. decideOffer never recommends an amount above its own ceiling.
// Also prints the worked-example table from HANDOFF for eyeballing.

//   4. Subscription amortization (spec 2.3): subShare = 0 is byte-identical to
//      the no-subscription call, and the margin invariants hold against the
//      AMORTIZED cost for subShare > 0.

import { offerCeilingPercent, decideOffer, subscriptionAmortization } from '../../app/utils/ai-decision.server.js';

const MARGIN_FLOOR = 0.20;
const EPS = 1e-9;
let failures = 0;
const fail = (msg) => { console.error('  FAIL:', msg); failures++; };

// ---------------------------------------------------------------------------
// 1. Randomized margin invariant
// ---------------------------------------------------------------------------
function rand(min, max) { return min + Math.random() * (max - min); }

for (let i = 0; i < 20000; i++) {
  const propensity = Math.round(rand(0, 100));
  const aggression = Math.round(rand(0, 10));
  const agm = rand(0.15, 0.65);
  const d = offerCeilingPercent({ propensity, aggression, assumedGrossMargin: agm }) / 100;

  if (d < 0 || d > 0.25 + EPS) {
    fail(`ceiling out of range: ${(d * 100).toFixed(1)}% (P=${propensity} agg=${aggression} agm=${agm.toFixed(2)})`);
  }
  if (d > 0) {
    // post-discount gross margin = (agm - d) / (1 - d)
    const postMargin = (agm - d) / (1 - d);
    if (postMargin < MARGIN_FLOOR - 1e-6) {
      fail(`margin floor breached: post=${(postMargin * 100).toFixed(1)}% (P=${propensity} agg=${aggression} agm=${agm.toFixed(3)} d=${(d * 100).toFixed(1)}%)`);
    }
    if (d > 0.5 * agm + 1e-6) {
      fail(`share cap breached: d=${(d * 100).toFixed(1)}% > half of margin ${(agm * 100).toFixed(1)}% (P=${propensity} agg=${aggression})`);
    }
  }
}
console.log('1. Randomized margin invariant (20k draws): checked');

// ---------------------------------------------------------------------------
// 2. aggression 0 => announce-only everywhere
// ---------------------------------------------------------------------------
for (let p = 0; p <= 100; p += 5) {
  const d = offerCeilingPercent({ propensity: p, aggression: 0, assumedGrossMargin: 0.4 });
  if (d !== 0) fail(`aggression 0 produced ${d}% at P=${p} (must be 0)`);
}
console.log('2. aggression 0 => 0% everywhere: checked');

// ---------------------------------------------------------------------------
// 3. decideOffer never exceeds its own ceiling (percentage path)
// ---------------------------------------------------------------------------
const offers = [];
for (let i = 0; i < 5000; i++) {
  const signals = {
    propensityScore: Math.round(rand(0, 100)),
    cartValue: Math.round(rand(10, 400)),
    itemCount: 1 + Math.floor(rand(0, 4)),
    exitPage: ['checkout', 'cart', 'product', 'collection'][Math.floor(rand(0, 4))],
    deviceType: ['mobile', 'desktop'][Math.floor(rand(0, 2))]
  };
  const aggression = Math.round(rand(0, 10));
  // shopId null + testMode true => pure, no db access
  const r = await decideOffer(signals, { aggression, shopId: null, testMode: true });
  if (!r) continue;
  offers.push(r);
  if (r.type === 'percentage' && r.amount > r.ceilingPercent + EPS) {
    fail(`decideOffer percentage amount ${r.amount}% > ceiling ${r.ceilingPercent}%`);
  }
  if (r.type === 'threshold') {
    const maxDollars = (r.threshold * r.ceilingPercent) / 100;
    if (r.amount > maxDollars + 1) {
      fail(`decideOffer threshold $${r.amount} > ceiling $${maxDollars.toFixed(2)} on $${r.threshold}`);
    }
  }
}
console.log(`3. decideOffer ceiling respected (${offers.length} non-skip offers): checked`);

// ---------------------------------------------------------------------------
// 4. Subscription amortization (spec 2.3)
// ---------------------------------------------------------------------------
// 4a. Identity: subShare = 0 must not change a single output.
for (let i = 0; i < 5000; i++) {
  const propensity = Math.round(rand(0, 100));
  const aggression = Math.round(rand(0, 10));
  const agm = rand(0.15, 0.65);
  const base = offerCeilingPercent({ propensity, aggression, assumedGrossMargin: agm });
  for (const cycles of [1, 3, 12, 999]) {
    const withSub = offerCeilingPercent({
      propensity, aggression, assumedGrossMargin: agm, subShare: 0, expectedCycles: cycles
    });
    if (withSub !== base) {
      fail(`subShare=0 not identity: ${withSub}% vs ${base}% (P=${propensity} agg=${aggression} agm=${agm.toFixed(2)} cycles=${cycles})`);
    }
  }
}
console.log('4a. subShare=0 identity (5k draws x 4 cycle values): checked');

// 4b. For subShare > 0 the invariants hold against the AMORTIZED cost, and the
//     nominal ceiling is never below the one-time-cart ceiling (amortization
//     only ever relaxes) nor above D_MAX.
for (let i = 0; i < 20000; i++) {
  const propensity = Math.round(rand(0, 100));
  const aggression = Math.round(rand(0, 10));
  const agm = rand(0.15, 0.65);
  const subShare = rand(0.01, 1);
  const cycles = rand(1, 24);

  const nominal = offerCeilingPercent({
    propensity, aggression, assumedGrossMargin: agm, subShare, expectedCycles: cycles
  }) / 100;
  const base = offerCeilingPercent({ propensity, aggression, assumedGrossMargin: agm }) / 100;

  if (nominal < base - EPS) {
    fail(`amortization tightened the ceiling: ${(nominal * 100).toFixed(1)}% < base ${(base * 100).toFixed(1)}%`);
  }
  if (nominal > 0.25 + EPS) {
    fail(`amortized ceiling out of range: ${(nominal * 100).toFixed(1)}% (subShare=${subShare.toFixed(2)} cycles=${cycles.toFixed(1)})`);
  }
  if (nominal > 0) {
    const dEff = nominal * subscriptionAmortization(subShare, cycles);
    const postMargin = (agm - dEff) / (1 - dEff);
    if (postMargin < MARGIN_FLOOR - 1e-6) {
      fail(`amortized margin floor breached: post=${(postMargin * 100).toFixed(1)}% (agm=${agm.toFixed(3)} d=${(nominal * 100).toFixed(1)}% subShare=${subShare.toFixed(2)} cycles=${cycles.toFixed(1)})`);
    }
    if (dEff > 0.5 * agm + 1e-6) {
      fail(`amortized share cap breached: dEff=${(dEff * 100).toFixed(1)}% > half of margin ${(agm * 100).toFixed(1)}%`);
    }
  }
}
console.log('4b. Amortized margin invariant (20k draws): checked');

// ---------------------------------------------------------------------------
// Worked-example table (HANDOFF: agm 0.40, aggression 5)
// ---------------------------------------------------------------------------
console.log('\nPropensity -> ceiling %% (agm 0.40, aggression 5):');
for (const p of [95, 85, 80, 75, 60, 45, 30, 20, 10]) {
  const d = offerCeilingPercent({ propensity: p, aggression: 5, assumedGrossMargin: 0.4 });
  console.log(`  P=${String(p).padStart(3)} -> ${d === 0 ? 'announce-only' : d + '%'}`);
}

console.log('');
if (failures > 0) {
  console.error(`MARGIN INVARIANT: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('MARGIN INVARIANT: ALL CHECKS PASS');
