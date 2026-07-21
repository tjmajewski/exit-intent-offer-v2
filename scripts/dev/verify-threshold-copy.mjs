// Verifies the two invariants behind the "save $8, needs $895 more" bug:
//
//   1. Every THRESHOLD_DISCOUNT copy line that can be drawn states the
//      qualifying condition, not just the reward. Urgency genes used to name a
//      dollar amount and nothing else, so the modal read as unconditional.
//   2. The threshold ask stays proportionate to the discount at every cart
//      size, including when the margin guard cuts the discount.
//
// Run: node scripts/dev/verify-threshold-copy.mjs

import { genePools } from '../../app/utils/gene-pools.js';
import { recommendedThreshold, capThresholdByDiscount, MAX_GAP_MULTIPLE }
  from '../../app/utils/ai-decision.server.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failures++;
};

// --- 1. Condition-stating copy -------------------------------------------
// The renderer's guard rewrites copy that fails to state the condition, but a
// pool that relies on the rewrite has effectively stopped evolving: every
// urgency impression serves identical fallback text. The pool itself must be
// coherent.
console.log('\nTHRESHOLD_DISCOUNT copy states the qualifying condition');

const pool = genePools.revenue_with_discount;
const CONDITION = /\{\{threshold_remaining\}\}|\{\{threshold\}\}|\{\{percent_to_goal\}\}/;

for (const [slot, lines] of Object.entries({
  headlines: pool.headlines,
  headlinesWithUrgency: pool.headlinesWithUrgency,
  subheadsWithUrgency: pool.subheadsWithUrgency
})) {
  for (const line of lines) {
    check(`${slot}: "${line}"`, CONDITION.test(line),
      'names a reward but never the spend required to earn it');
  }
}

// Social-proof headlines are exempt: they are merged WITH the base headlines
// (variant-engine.js), so the condition can come from the paired subhead.

// --- 2. Proportionate ask -------------------------------------------------
console.log('\nThreshold ask stays proportionate to the discount');

const MIN_RATIO = 1 / MAX_GAP_MULTIPLE; // 20% return floor
const carts = [0, 25, 40, 60, 80, 100, 150, 200, 300, 500, 800, 1500, 2983, 10000];
const discounts = [1, 5, 8, 10, 15, 20, 25];

let worst = { ratio: Infinity };
for (const cv of carts) {
  for (const d of discounts) {
    const thr = capThresholdByDiscount(cv, recommendedThreshold(cv), d);
    const gap = thr - cv;
    check(`cart $${cv}, discount $${d}: must add something`, gap >= 10,
      `gap was $${gap}`);
    // The +$10 floor legitimately outranks the ratio cap on tiny discounts.
    if (gap > 10) {
      const ratio = d / gap;
      if (ratio < worst.ratio) worst = { ratio, cv, d, gap };
      check(`cart $${cv}, discount $${d}: return >= 20%`, ratio >= MIN_RATIO - 1e-9,
        `asks $${gap} to save $${d} (${(ratio * 100).toFixed(1)}%)`);
    }
  }
}
console.log(`\n  worst ratio-capped case: cart $${worst.cv}, ` +
  `$${worst.d} off for $${worst.gap} more (${(worst.ratio * 100).toFixed(1)}%)`);

// --- 3. No regression at typical cart sizes -------------------------------
// The cap must not touch the $50-$200 range most stores sell into.
console.log('\nNo change to typical cart sizes ($40-$300)');
for (const cv of [40, 60, 80, 100, 150, 200, 300]) {
  const before = recommendedThreshold(cv);
  const after = capThresholdByDiscount(cv, before, cv < 100 ? 10 : cv < 250 ? 15 : 20);
  check(`cart $${cv}: threshold unchanged at $${before}`, before === after,
    `moved to $${after}`);
}

console.log(`\n${failures === 0 ? 'THRESHOLD COPY + PROPORTIONALITY: ALL CHECKS PASS'
  : `THRESHOLD COPY: ${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
