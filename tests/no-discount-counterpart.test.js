// The crash that made ~10% of eligible shoppers see nothing, invisibly.
//
// `baseline.replace('with_discount','no_discount')` turned
// `conversion_with_discount_fixed` into `conversion_no_discount_fixed`, which is
// not one of the six pools in gene-pools.js. getRandomGene read `.headlines` off
// undefined, the decision endpoint 500ed, and no row was written — so it looked
// exactly like the engine choosing not to spend.

import test from 'node:test';
import assert from 'node:assert/strict';
import { noDiscountCounterpart } from '../app/utils/baseline-selector.js';
import { genePools } from '../app/utils/gene-pools.js';

test('the bug: the dollars-off pool maps to a pool that EXISTS', () => {
  // Old behaviour: 'conversion_no_discount_fixed' -> undefined -> TypeError.
  assert.equal(noDiscountCounterpart('conversion_with_discount_fixed'), 'conversion_no_discount');
  assert.equal('conversion_no_discount_fixed' in genePools, false,
    'if this pool is ever added, revisit the mapping');
});

test('the two baselines the old string swap already handled are unchanged', () => {
  assert.equal(noDiscountCounterpart('revenue_with_discount'), 'revenue_no_discount');
  assert.equal(noDiscountCounterpart('conversion_with_discount'), 'conversion_no_discount');
});

test('downgrading an already-no-discount baseline is a no-op', () => {
  assert.equal(noDiscountCounterpart('revenue_no_discount'), 'revenue_no_discount');
  assert.equal(noDiscountCounterpart('conversion_no_discount'), 'conversion_no_discount');
  assert.equal(noDiscountCounterpart('pure_reminder'), 'pure_reminder');
});

test('EVERY result is a real gene pool — this is the whole point', () => {
  const inputs = [
    'revenue_with_discount', 'revenue_no_discount',
    'conversion_with_discount', 'conversion_with_discount_fixed',
    'conversion_no_discount', 'pure_reminder',
    // junk, to prove the fallback cannot synthesise a missing pool
    'something_with_discount_weird', '', 'undefined', null, undefined
  ];
  for (const input of inputs) {
    const out = noDiscountCounterpart(input);
    assert.ok(genePools[out], `noDiscountCounterpart(${JSON.stringify(input)}) -> ${out} is not a pool`);
    assert.ok(Array.isArray(genePools[out].headlines) || genePools[out].headlines,
      `${out} has no headlines — the exact shape the crash read off undefined`);
  }
});

test('every pool key round-trips to a pool that exists', () => {
  // Guards against someone adding a 7th pool and not updating the map.
  for (const key of Object.keys(genePools)) {
    assert.ok(genePools[noDiscountCounterpart(key)], `${key} downgrades to a missing pool`);
  }
});
