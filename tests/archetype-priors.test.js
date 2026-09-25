// Archetype priors had no test of any kind.
//
// The module tilts Thompson Sampling toward archetypes that have won a
// persona x scenario before. Its whole behaviour is threshold arithmetic —
// 50 rows in one segmentKey, 10 per archetype, at least two archetypes to
// rank — and none of it had ever been exercised. On the live store the
// expected answer is `none` on every decision, which is correct behaviour
// and indistinguishable from a broken module, so the arithmetic is the only
// thing that can be checked without traffic.
//
// The `where` assertions matter as much as the multipliers: the own-shop
// query counts RENDERED rows only, which is a far higher bar than the
// impression count the thresholds read like.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeArchetypePriors,
  getArchetypeMultiplier
} from '../app/utils/archetype-priors.js';

const KEY = 'd:mobile|t:paid|a:guest|p:product|pr:no|f:first';

// Build `count` impression rows for one archetype, `converted` of them won.
function rows(archetype, count, converted = 0) {
  return Array.from({ length: count }, (_, i) => ({
    archetype,
    converted: i < converted
  }));
}

// Minimal prisma stub. `impressions` is what variantImpression.findMany
// returns; `insights` maps `${segment}::${insightType}` to a stored row.
// Records the where clause it was called with so the filters can be asserted.
function fakeDb({ impressions = [], insights = {} } = {}) {
  const calls = { findManyWhere: null, insightKeys: [] };
  return {
    calls,
    variantImpression: {
      findMany: async ({ where }) => {
        calls.findManyWhere = where;
        return impressions;
      }
    },
    metaLearningInsights: {
      findFirst: async ({ where }) => {
        calls.insightKeys.push(`${where.segment}::${where.insightType}`);
        return insights[`${where.segment}::${where.insightType}`] || null;
      }
    }
  };
}

// A stored meta-learning insight that passes getMetaInsight's freshness and
// confidence gates (7-day max age, >= 0.8 confidence).
function insight(rankings) {
  return {
    lastUpdated: new Date(),
    confidenceLevel: 0.9,
    sampleSize: 4000,
    data: JSON.stringify({ rankings })
  };
}

describe('the own-shop threshold', () => {
  test('49 rendered rows in a key is not enough', async () => {
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 25, 5), ...rows('FIXED_DISCOUNT', 24, 1)] });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'none', '49 rows cleared a bar documented as 50');
    assert.equal(priors.size, 0);
  });

  test('50 rendered rows with two rankable archetypes is enough', async () => {
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 25, 5), ...rows('FIXED_DISCOUNT', 25, 1)] });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'own_shop');
    assert.equal(priors.size, 2);
  });

  test('an archetype with 9 rows is not ranked, so its sibling cannot be either', async () => {
    // 41 + 9 clears the 50-row total, but only one archetype clears the
    // per-archetype floor and a single ranking has nothing to rank against.
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 41, 8), ...rows('FIXED_DISCOUNT', 9, 0)] });
    const { source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'none', 'a lone rankable archetype was boosted with no comparison');
  });

  test('10 rows is the floor, not 11', async () => {
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 40, 8), ...rows('FIXED_DISCOUNT', 10, 0)] });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'own_shop');
    assert.equal(priors.size, 2);
  });

  test('a third archetype below the floor is dropped without blocking the other two', async () => {
    const db = fakeDb({
      impressions: [
        ...rows('PERCENT_DISCOUNT', 30, 6),
        ...rows('FIXED_DISCOUNT', 20, 1),
        ...rows('SOFT_UPSELL', 4, 4)   // 100% CVR on 4 rows — noise, must not win
      ]
    });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(priors.has('SOFT_UPSELL'), false, 'a 4-row archetype was allowed to rank');
    assert.equal(priors.size, 2);
  });
});

describe('what the own-shop query actually counts', () => {
  test('rendered rows only, non-null archetype, this shop, this key, inside the window', async () => {
    const db = fakeDb();
    await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    const where = db.calls.findManyWhere;

    // The bar is 50 RENDERED rows in one key, not 50 impressions. Impressions
    // are written rendered=false at decision prefetch and only flipped when
    // the client confirms a render, so dropping this filter would silently
    // lower the bar to include modals no shopper ever saw.
    assert.equal(where.rendered, true, 'the query stopped restricting to rendered rows');
    assert.deepEqual(where.archetype, { not: null });
    assert.equal(where.shopId, 'shop_1');
    assert.equal(where.segmentKey, KEY);
    assert.ok(where.timestamp.gte instanceof Date);

    const windowDays = (Date.now() - where.timestamp.gte.getTime()) / 86400000;
    assert.ok(Math.abs(windowDays - 30) < 0.01, `window is ${windowDays} days, not the documented 30`);
  });
});

describe('the multiplier shape', () => {
  test('best gets 1.30, worst gets 0.85', async () => {
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 25, 10), ...rows('FIXED_DISCOUNT', 25, 1)] });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(priors.get('PERCENT_DISCOUNT'), 1.30);
    assert.equal(priors.get('FIXED_DISCOUNT'), 0.85);
  });

  test('ranking is by conversion rate, not by volume', async () => {
    // FIXED has more conversions in absolute terms and more rows; PERCENT has
    // the better rate. Rate must win, or the priors just amplify traffic mix.
    const db = fakeDb({ impressions: [...rows('PERCENT_DISCOUNT', 10, 5), ...rows('FIXED_DISCOUNT', 40, 8)] });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.ok(
      priors.get('PERCENT_DISCOUNT') > priors.get('FIXED_DISCOUNT'),
      'the higher-volume archetype outranked the higher-converting one'
    );
  });

  test('the middle of three is interpolated, not rounded to an extreme', async () => {
    const db = fakeDb({
      insights: {
        [`${KEY}::archetype_performance_by_key`]: insight([
          { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.20 },
          { archetype: 'FIXED_DISCOUNT', conversionRate: 0.10 },
          { archetype: 'SOFT_UPSELL', conversionRate: 0.05 }
        ])
      }
    });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(priors.get('PERCENT_DISCOUNT'), 1.30);
    assert.equal(priors.get('FIXED_DISCOUNT'), 1.075);   // midpoint of 1.30 and 0.85
    assert.equal(priors.get('SOFT_UPSELL'), 0.85);
  });

  test('a single ranked archetype from meta gets the top boost', async () => {
    const db = fakeDb({
      insights: {
        [`${KEY}::archetype_performance_by_key`]: insight([
          { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.2 }
        ])
      }
    });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(priors.get('PERCENT_DISCOUNT'), 1.30);
  });

  test('every multiplier stays inside the conservative band', async () => {
    const db = fakeDb({
      insights: {
        [`${KEY}::archetype_performance_by_key`]: insight(
          ['A', 'B', 'C', 'D', 'E', 'F'].map((a, i) => ({ archetype: a, conversionRate: 0.5 - i * 0.05 }))
        )
      }
    });
    const { priors } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    for (const [archetype, m] of priors) {
      assert.ok(m >= 0.85 && m <= 1.30, `${archetype} got ${m}, outside the 0.85-1.30 band`);
    }
  });
});

describe('source priority', () => {
  test('own-shop data wins over a cross-store leaderboard for the same key', async () => {
    const db = fakeDb({
      impressions: [...rows('PERCENT_DISCOUNT', 25, 5), ...rows('FIXED_DISCOUNT', 25, 1)],
      insights: {
        [`${KEY}::archetype_performance_by_key`]: insight([
          { archetype: 'SOFT_UPSELL', conversionRate: 0.9 }
        ])
      }
    });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'own_shop');
    assert.equal(priors.has('SOFT_UPSELL'), false, 'cross-store data overrode this store\'s own evidence');
  });

  test('the key-level leaderboard wins over the vertical-level one', async () => {
    const db = fakeDb({
      insights: {
        [`${KEY}::archetype_performance_by_key`]: insight([
          { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.2 },
          { archetype: 'FIXED_DISCOUNT', conversionRate: 0.1 }
        ]),
        ['beauty::mobile_paid::archetype_performance_by_vertical']: insight([
          { archetype: 'SOFT_UPSELL', conversionRate: 0.9 }
        ])
      }
    });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', {
      segmentKey: KEY,
      segment: 'mobile_paid',
      storeVertical: 'beauty'
    });
    assert.equal(source, 'meta_by_key');
    assert.equal(priors.has('SOFT_UPSELL'), false);
  });

  test('the vertical leaderboard is keyed vertical::segment and used as the last resort', async () => {
    const db = fakeDb({
      insights: {
        ['beauty::mobile_paid::archetype_performance_by_vertical']: insight([
          { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.2 },
          { archetype: 'FIXED_DISCOUNT', conversionRate: 0.1 }
        ])
      }
    });
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', {
      segmentKey: KEY,
      segment: 'mobile_paid',
      storeVertical: 'beauty'
    });
    assert.equal(source, 'meta_by_vertical');
    assert.equal(priors.get('PERCENT_DISCOUNT'), 1.30);
  });

  test('a vertical with no segment does not fall through to a bare-vertical lookup', async () => {
    const db = fakeDb();
    const { source } = await computeArchetypePriors(db, 'shop_1', {
      segmentKey: KEY,
      storeVertical: 'beauty'
    });
    assert.equal(source, 'none');
    assert.equal(
      db.calls.insightKeys.some(k => k.includes('archetype_performance_by_vertical')),
      false,
      'looked up a vertical leaderboard without a segment to key it on'
    );
  });
});

describe('the no-signal case', () => {
  test('no data anywhere is `none` with an empty map, not a throw', async () => {
    const db = fakeDb();
    const { priors, source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'none');
    assert.equal(priors.size, 0);
  });

  test('no segmentKey skips both key-based sources', async () => {
    const db = fakeDb({ impressions: rows('PERCENT_DISCOUNT', 100, 50) });
    const { source } = await computeArchetypePriors(db, 'shop_1', {});
    assert.equal(source, 'none');
    assert.equal(db.calls.findManyWhere, null, 'queried own-shop impressions with no key to scope them');
  });

  test('a stale leaderboard is ignored', async () => {
    const stale = insight([
      { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.2 },
      { archetype: 'FIXED_DISCOUNT', conversionRate: 0.1 }
    ]);
    stale.lastUpdated = new Date(Date.now() - 8 * 86400000);
    const db = fakeDb({ insights: { [`${KEY}::archetype_performance_by_key`]: stale } });
    const { source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'none', 'an 8-day-old insight was used against a 7-day rule');
  });

  test('a low-confidence leaderboard is ignored', async () => {
    const weak = insight([
      { archetype: 'PERCENT_DISCOUNT', conversionRate: 0.2 },
      { archetype: 'FIXED_DISCOUNT', conversionRate: 0.1 }
    ]);
    weak.confidenceLevel = 0.79;
    const db = fakeDb({ insights: { [`${KEY}::archetype_performance_by_key`]: weak } });
    const { source } = await computeArchetypePriors(db, 'shop_1', { segmentKey: KEY });
    assert.equal(source, 'none');
  });
});

describe('getArchetypeMultiplier', () => {
  test('an unknown archetype is neutral, never penalized', () => {
    const priors = new Map([['PERCENT_DISCOUNT', 1.3]]);
    assert.equal(getArchetypeMultiplier(priors, 'TRUST_REMINDER'), 1.0);
  });

  test('an empty priors map leaves every sample untouched', () => {
    assert.equal(getArchetypeMultiplier(new Map(), 'PERCENT_DISCOUNT'), 1.0);
  });

  test('a null archetype or null map is neutral', () => {
    assert.equal(getArchetypeMultiplier(null, 'PERCENT_DISCOUNT'), 1.0);
    assert.equal(getArchetypeMultiplier(new Map([['A', 1.3]]), null), 1.0);
  });
});
