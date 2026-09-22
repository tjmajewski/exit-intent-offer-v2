// HANDOFF-2026-09-19 §5.1 — the cross-store publish gate.
//
// Every expected value below is hand-computed against the rule "BOTH bars must
// clear", and the first case is the bug itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meetsPublishGate,
  MIN_META_STORES,
  MIN_META_IMPRESSIONS
} from '../app/utils/meta-learning-gate.js';

test('the §5.1 bug: one store with plenty of impressions must NOT publish', () => {
  // Old code: `storeCount < 3 && impressions < 100` → `1 < 3 && 500 < 100`
  //         → `true && false` → false → NOT skipped → PUBLISHED at k=1.
  // That single row carried merchant-authored copy strings and absolute
  // per-store revenue dollars into the global pool.
  assert.equal(meetsPublishGate(1, 500, 3), false);
});

test('three stores but too few impressions must not publish', () => {
  assert.equal(meetsPublishGate(3, 10, 3), false);
});

test('exactly at both bars publishes', () => {
  assert.equal(meetsPublishGate(3, 100, 3), true);
});

test('cluster scope uses its own store bar but the same impression bar', () => {
  assert.equal(meetsPublishGate(2, 100, 2), true);
  // One below the impression bar — the case the old `&&` let through whenever
  // the store bar happened to pass.
  assert.equal(meetsPublishGate(2, 99, 2), false);
  // Cluster store bar is 2, so a single store still fails it.
  assert.equal(meetsPublishGate(1, 100000, 2), false);
});

test('off-by-one on the store bar', () => {
  assert.equal(meetsPublishGate(2, 100, 3), false);
  assert.equal(meetsPublishGate(3, 100, 3), true);
});

test('missing or zero counts never publish', () => {
  assert.equal(meetsPublishGate(0, 0, 3), false);
  assert.equal(meetsPublishGate(undefined, undefined, 3), false);
  assert.equal(meetsPublishGate(null, 1000, 3), false);
});

test('defaults are the documented k-anonymity bars', () => {
  assert.equal(MIN_META_STORES, 3);
  assert.equal(MIN_META_IMPRESSIONS, 100);
  // Called without explicit bars, the defaults apply.
  assert.equal(meetsPublishGate(3, 100), true);
  assert.equal(meetsPublishGate(2, 100), false);
});
