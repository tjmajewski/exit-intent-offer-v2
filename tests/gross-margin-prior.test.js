// The margin guard's gross margin is inferred, never asked for.
//
// Nothing writes settings.assumedGrossMargin (there is no UI, by design — a
// margin field during onboarding is a blocker on getting a store live), so
// every store used to run on a hardcoded 40%. That is 15 points too low for a
// beauty store and 15 points too HIGH for an electronics one, which is the
// dangerous direction: it authorizes discounts the margin cannot fund.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROSS_MARGIN_BY_VERTICAL,
  DEFAULT_GROSS_MARGIN,
  grossMarginForShop,
  mapProductTypeToVertical,
  VERTICALS
} from '../app/utils/store-cluster.server.js';
import { offerCeilingPercent } from '../app/utils/ai-decision.server.js';

describe('the margin table', () => {
  test('covers every vertical in the vocabulary', () => {
    for (const v of VERTICALS) {
      assert.ok(
        GROSS_MARGIN_BY_VERTICAL[v] !== undefined,
        `${v} has no margin prior, so it silently falls back to the default`
      );
    }
  });

  test('every prior is a plausible gross margin', () => {
    for (const [v, m] of Object.entries(GROSS_MARGIN_BY_VERTICAL)) {
      assert.ok(m > 0 && m < 1, `${v} is ${m}, which offerCeilingPercent will reject`);
      assert.ok(m >= 0.15 && m <= 0.85, `${v} at ${m} is outside any real DTC range`);
    }
  });

  test('a low-margin vertical is never authorized above a high-margin one', () => {
    assert.ok(GROSS_MARGIN_BY_VERTICAL.electronics < GROSS_MARGIN_BY_VERTICAL.beauty);
    assert.ok(GROSS_MARGIN_BY_VERTICAL.food < GROSS_MARGIN_BY_VERTICAL.jewelry);
  });
});

describe('grossMarginForShop', () => {
  test('prefers the operator override over the derived vertical', () => {
    // Reversed deliberately — see shopClusterDims. storeVertical's only writer
    // is the super-admin console, so it is an override, and an override that
    // loses to the thing it overrides is not one.
    const shop = { derivedVertical: 'electronics', storeVertical: 'beauty' };
    assert.equal(grossMarginForShop(shop), GROSS_MARGIN_BY_VERTICAL.beauty);
  });

  test('uses the derived vertical when no override is set', () => {
    assert.equal(
      grossMarginForShop({ derivedVertical: 'jewelry', storeVertical: null }),
      GROSS_MARGIN_BY_VERTICAL.jewelry
    );
  });

  test('an unclassified store gets the default, not a low-margin guess', () => {
    assert.equal(grossMarginForShop({}), DEFAULT_GROSS_MARGIN);
    assert.equal(grossMarginForShop(null), DEFAULT_GROSS_MARGIN);
    assert.equal(grossMarginForShop({ derivedVertical: 'nonsense' }), DEFAULT_GROSS_MARGIN);
  });

  test('an explicit merchant value always wins', () => {
    assert.equal(grossMarginForShop({ derivedVertical: 'beauty' }, 0.31), 0.31);
  });

  test('a junk explicit value falls through rather than poisoning the guard', () => {
    for (const bad of [0, 1, -1, 40, null, undefined, NaN, 'x']) {
      assert.equal(
        grossMarginForShop({ derivedVertical: 'beauty' }, bad),
        GROSS_MARGIN_BY_VERTICAL.beauty,
        `explicit ${bad} should not have been trusted`
      );
    }
  });
});

describe('hair and wig product types classify', () => {
  // The live shop sells wigs. Beauty listed 'hair care' but not 'hair', so
  // every product voted for nothing, derivation returned null, and the store
  // ran with no vertical, no margin prior and no cluster priors.
  test('wig and hair stores resolve to beauty', () => {
    for (const t of ['Wigs', 'Hair Extensions', 'Lace Front Wig', 'Bundles & Weaves', 'Braiding Hair']) {
      assert.equal(mapProductTypeToVertical(t), 'beauty', `"${t}" did not classify`);
    }
  });

  test('the widened keywords did not swallow other verticals', () => {
    assert.equal(mapProductTypeToVertical('Laptops'), 'electronics');
    assert.equal(mapProductTypeToVertical('Protein Powder'), 'health');
    assert.equal(mapProductTypeToVertical('Diamond Rings'), 'jewelry');
    assert.equal(mapProductTypeToVertical('Dog Leashes'), 'pets');
  });
});

describe('what the prior actually changes at the guard', () => {
  const ceiling = (agm) => offerCeilingPercent({ propensity: 40, aggression: 8, assumedGrossMargin: agm });

  test('a low-margin store is no longer authorized to discount like a beauty store', () => {
    // The whole point. At the old hardcoded 40% an electronics store could
    // hand out 20% on a ~25% margin.
    assert.ok(
      ceiling(GROSS_MARGIN_BY_VERTICAL.electronics) < ceiling(0.40),
      'electronics is still authorized at or above the old hardcoded default'
    );
  });

  test('the ceiling rises monotonically with margin', () => {
    const margins = [0.25, 0.35, 0.45, 0.55, 0.65];
    const ceilings = margins.map(ceiling);
    for (let i = 1; i < ceilings.length; i++) {
      assert.ok(ceilings[i] >= ceilings[i - 1], `non-monotonic: ${ceilings.join(', ')}`);
    }
  });

  test('the aggression dial still caps a high-margin store', () => {
    // Above ~50% margin the merchant's own dial binds, not the margin. A
    // generous prior therefore cannot run away with the discount.
    assert.equal(ceiling(0.65), ceiling(0.95));
  });
});

describe('the operator override wins', () => {
  test('a super-admin vertical beats the cron keyword vote', async () => {
    const { shopClusterDims } = await import('../app/utils/store-cluster.server.js');
    // The point of an override. This used to return 'other' — the field
    // existed in the console and was silently ignored once the cron ran.
    const shop = { storeVertical: 'beauty', derivedVertical: 'other' };
    assert.equal(shopClusterDims(shop).vertical, 'beauty');
    assert.equal(grossMarginForShop(shop), GROSS_MARGIN_BY_VERTICAL.beauty);
  });

  test('auto-derive still applies when no override is set', async () => {
    const { shopClusterDims } = await import('../app/utils/store-cluster.server.js');
    const shop = { storeVertical: null, derivedVertical: 'electronics' };
    assert.equal(shopClusterDims(shop).vertical, 'electronics');
  });

  test('free text typed before the field became a dropdown still resolves', async () => {
    const { shopClusterDims } = await import('../app/utils/store-cluster.server.js');
    for (const typed of ['Wigs', 'hair', 'BEAUTY']) {
      assert.equal(shopClusterDims({ storeVertical: typed }).vertical, 'beauty', `"${typed}"`);
    }
  });

  test('an unrecognisable override falls through instead of blanking the vertical', async () => {
    const { shopClusterDims } = await import('../app/utils/store-cluster.server.js');
    const shop = { storeVertical: 'asdfgh', derivedVertical: 'beauty' };
    assert.equal(shopClusterDims(shop).vertical, 'beauty');
  });
});
