// The dollars-off lanes must scale with the cart.
//
// FIXED_DISCOUNT and THRESHOLD_DISCOUNT draw from flat dollar pools. Before
// scaleDollarOffer, a $1,175 cart was offered $5-$16 off, or asked for $100
// more spend to earn $20 back, while the PERCENT lane beside it served $235.
// These tests pin both halves of the contract: large carts scale, small carts
// do not move at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleDollarOffer,
  maxConditionalDiscount,
  offerCeilingPercent,
  recommendedThreshold,
  capThresholdByDiscount
} from '../app/utils/ai-decision.server.js';
import { genePools } from '../app/utils/gene-pools.js';

const FIXED = genePools.conversion_with_discount_fixed.offerAmounts;
const THRESH = genePools.revenue_with_discount.offerAmounts;

// The live shop the regression was found on: mode=ai, aggression 8, default
// 40% assumed gross margin, propensity clustered below 50.
const AGG = 8;
const AGM = 0.40;

/** The endpoint's fixed lane, end to end: aggression cap -> scale -> ceiling. */
function servedFixed(gene, cartValue, { aggression = AGG, propensity = 40 } = {}) {
  const poolMax = Math.max(...FIXED);
  let amount = Math.min(gene, Math.round(poolMax * (aggression / 10)));
  amount = scaleDollarOffer(amount, cartValue);
  const ceiling = offerCeilingPercent({ propensity, aggression, assumedGrossMargin: AGM });
  return Math.max(Math.min(amount, Math.floor((cartValue * ceiling) / 100)), 0);
}

/** The endpoint's threshold lane, end to end. Conditional: no propensity taper. */
function servedThreshold(gene, cartValue, { aggression = AGG, propensity = 75 } = {}) {
  const poolMax = Math.max(...THRESH);
  let amount = Math.min(gene, Math.round(poolMax * (aggression / 10)));
  const thr = recommendedThreshold(cartValue);
  amount = scaleDollarOffer(amount, Math.max(0, thr - cartValue));
  amount = Math.min(amount, maxConditionalDiscount(cartValue, thr, AGM));
  const ceiling = offerCeilingPercent({
    propensity, aggression, assumedGrossMargin: AGM, conditional: true
  });
  amount = Math.max(Math.min(amount, Math.floor((thr * ceiling) / 100)), 0);
  return { amount, threshold: capThresholdByDiscount(cartValue, thr, amount) };
}

describe('scaleDollarOffer', () => {
  test('never returns less than the gene — it is a floor, not a replacement', () => {
    for (const gene of [...FIXED, ...THRESH]) {
      for (const basis of [0, 1, 10, 30, 100, 1175, 6142]) {
        assert.ok(
          scaleDollarOffer(gene, basis) >= gene,
          `gene ${gene} at basis ${basis} shrank to ${scaleDollarOffer(gene, basis)}`
        );
      }
    }
  });

  test('reads the gene as a percent once that exceeds the dollar floor', () => {
    assert.equal(scaleDollarOffer(5, 1175), 60);   // 5% of 1175 = 58.75 -> nice 60
    assert.equal(scaleDollarOffer(10, 1175), 120); // 117.5 -> 120
    assert.equal(scaleDollarOffer(20, 1175), 225); // 235 -> nice 225 ($25 grid)
  });

  test('is inert at and below the cart size the pools were written for', () => {
    for (const gene of FIXED) {
      assert.equal(scaleDollarOffer(gene, 100), gene, `gene ${gene} moved on a $100 cart`);
    }
  });

  test('degenerate input is the gene, never NaN and never a throw', () => {
    for (const bad of [0, -1, null, undefined, NaN, 'x']) {
      assert.equal(scaleDollarOffer(10, bad), 10);
      assert.equal(scaleDollarOffer(bad, 1175), Number(bad) || 0);
    }
  });
});

describe('FIXED_DISCOUNT served amount', () => {
  test('a $1,175 cart is no longer offered pocket change', () => {
    // The regression: every gene served $5-$16 here, 0.4%-1.4% of the cart.
    for (const gene of FIXED) {
      const served = servedFixed(gene, 1175);
      assert.ok(served >= 50, `gene ${gene} served $${served} on a $1,175 cart`);
    }
  });

  test('stays inside the margin ceiling at every cart size', () => {
    for (const cart of [30, 100, 400, 1175, 6142]) {
      const ceiling = offerCeilingPercent({ propensity: 40, aggression: AGG, assumedGrossMargin: AGM });
      const max = Math.floor((cart * ceiling) / 100);
      for (const gene of FIXED) {
        assert.ok(
          servedFixed(gene, cart) <= max,
          `gene ${gene} on a $${cart} cart served above the $${max} ceiling`
        );
      }
    }
  });

  test('small-cart stores are untouched by the change', () => {
    // Pre-change behavior on a $100 cart was the gene itself, capped to $16 by
    // the aggression dial. That must not have moved.
    assert.deepEqual(FIXED.map(g => servedFixed(g, 100)), [5, 10, 15, 16]);
  });

  test('offer grows monotonically with the cart', () => {
    const carts = [100, 400, 1175, 6142];
    for (const gene of FIXED) {
      const series = carts.map(c => servedFixed(gene, c));
      for (let i = 1; i < series.length; i++) {
        assert.ok(series[i] >= series[i - 1], `gene ${gene} shrank: ${series}`);
      }
    }
  });
});

describe('THRESHOLD_DISCOUNT served amount', () => {
  test('a $1,175 cart is no longer asked for $100 more to earn $20', () => {
    for (const gene of THRESH) {
      const { amount } = servedThreshold(gene, 1175);
      assert.ok(amount >= 30, `gene ${gene} served $${amount} off on a $1,175 cart`);
    }
  });

  test('THE MERCHANT NEVER LOSES MONEY ON THE UPSELL', () => {
    // The regression this file exists to prevent a second time. Scaling the
    // reward without bounding it against the margin on the ADDED spend
    // produced "spend $350 more, save $300": the merchant earns $140 and gives
    // back $300, losing $160 on a shopper who was already converting.
    for (const cart of [50, 100, 400, 875, 1175, 6142]) {
      for (const gene of THRESH) {
        const { amount, threshold } = servedThreshold(gene, cart);
        const earned = (threshold - cart) * AGM;
        assert.ok(
          earned >= amount,
          `gene ${gene} on $${cart}: merchant earns $${earned.toFixed(0)} on a ` +
          `$${threshold - cart} upsell but gives back $${amount}`
        );
      }
    }
  });

  test('keeps at least half the incremental margin for the merchant', () => {
    for (const cart of [400, 875, 1175, 6142]) {
      for (const gene of THRESH) {
        const { amount, threshold } = servedThreshold(gene, cart);
        assert.ok(
          amount <= maxConditionalDiscount(cart, threshold, AGM) + 1,
          `gene ${gene} on $${cart} gave back $${amount} of a $${((threshold - cart) * AGM).toFixed(0)} margin`
        );
      }
    }
  });

  test('the arms stay distinguishable — the cap must not flatten the pool', () => {
    // If every gene clamps to the same number the bandit has nothing to learn
    // on this lane.
    const served = THRESH.map(g => servedThreshold(g, 1175).amount);
    assert.ok(new Set(served).size >= 3, `pool flattened to ${served.join(', ')}`);
  });

  test('the ask stays proportionate to the reward', () => {
    // MAX_GAP_MULTIPLE: never more than $5 of extra spend per $1 saved.
    for (const cart of [100, 400, 1175, 6142]) {
      for (const gene of THRESH) {
        const { amount, threshold } = servedThreshold(gene, cart);
        const gap = threshold - cart;
        assert.ok(gap >= 10, `gene ${gene} on $${cart}: gap $${gap} leaves nothing to add`);
        if (amount > 0) {
          assert.ok(
            gap <= amount * 5,
            `gene ${gene} on $${cart}: asked $${gap} more to save $${amount}`
          );
        }
      }
    }
  });

  test('stays inside the conditional margin ceiling', () => {
    for (const cart of [100, 400, 1175, 6142]) {
      const ceiling = offerCeilingPercent({
        propensity: 75, aggression: AGG, assumedGrossMargin: AGM, conditional: true
      });
      for (const gene of THRESH) {
        const { amount } = servedThreshold(gene, cart);
        const max = Math.floor((recommendedThreshold(cart) * ceiling) / 100);
        assert.ok(amount <= max, `gene ${gene} on $${cart} served $${amount} above $${max}`);
      }
    }
  });
});

describe('the two flat lanes are now comparable arms', () => {
  test('fixed and percent land within 2x on the cart the bandit compares them on', () => {
    // A visitor is split between these two lanes by a visitorId hash alone
    // (flatDiscountBaseline). If the lanes differ 15x in value, the bandit is
    // measuring offer size and calling it copy.
    const cart = 1175;
    const pctPool = genePools.conversion_with_discount.offerAmounts;
    const ceiling = offerCeilingPercent({ propensity: 40, aggression: AGG, assumedGrossMargin: AGM });
    const pctMax = Math.min(Math.round(Math.max(...pctPool) * (AGG / 10)), ceiling);
    const percentDollars = (cart * pctMax) / 100;
    const fixedDollars = servedFixed(Math.max(...FIXED), cart);
    const ratio = Math.max(percentDollars, fixedDollars) / Math.min(percentDollars, fixedDollars);
    assert.ok(ratio <= 2, `lanes are ${ratio.toFixed(1)}x apart ($${percentDollars} vs $${fixedDollars})`);
  });
});

describe('maxConditionalDiscount', () => {
  test('is half the margin on the added spend, never on the whole cart', () => {
    // $1,150 cart, $1,500 threshold: the upsell is $350, worth $140 at a 40%
    // margin, so at most $70 may be given back.
    assert.equal(maxConditionalDiscount(1150, 1500, 0.40), 70);
  });

  test('an ask that adds nothing funds nothing', () => {
    assert.equal(maxConditionalDiscount(1000, 1000, 0.40), 0);
    assert.equal(maxConditionalDiscount(1000, 900, 0.40), 0);
  });

  test('a richer margin funds a bigger giveback', () => {
    assert.ok(maxConditionalDiscount(1000, 1300, 0.70) > maxConditionalDiscount(1000, 1300, 0.40));
  });

  test('bad margin input falls back to the engine default, never NaN', () => {
    for (const bad of [0, 1, -1, null, undefined, NaN, 'x']) {
      assert.equal(maxConditionalDiscount(1000, 1300, bad), maxConditionalDiscount(1000, 1300, 0.40));
    }
  });

  test('agrees with MAX_GAP_MULTIPLE at the default margin', () => {
    // MAX_GAP_MULTIPLE = 5 says "never more than $5 of ask per $1 saved".
    // Half the incremental margin at 40% says "never more than 20% of the ask".
    // They are the same bound from opposite sides; if one moves, so must the other.
    const gap = 500;
    assert.equal(maxConditionalDiscount(1000, 1000 + gap, 0.40), gap / 5);
  });
});
