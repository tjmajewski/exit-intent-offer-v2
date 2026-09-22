// HANDOFF-2026-09-19 §5.6 — shop redaction scope.
//
// The handler itself opens Prisma, so per house style it cannot carry a test.
// The one piece of arithmetic in the fix is the MetaLearningInsights segment
// prefix, and the near-miss cases below are the ones that would silently
// either leave a shop's rows behind or delete another shop's.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOP_SCOPED_TABLES_WITHOUT_FK,
  SHOP_SCOPED_INSIGHT_TYPES,
  shopScopedInsightFilter,
  segmentBelongsToShop
} from '../app/utils/redaction-scope.js';

test('every table §5.6 named is covered', () => {
  // VisitorTouch first and by name: it holds the durable resparqVisitorId,
  // which is the most identifying thing the app stores.
  assert.ok(SHOP_SCOPED_TABLES_WITHOUT_FK.includes('visitorTouch'));
  assert.ok(SHOP_SCOPED_TABLES_WITHOUT_FK.includes('variantSegmentStat'));
  assert.ok(SHOP_SCOPED_TABLES_WITHOUT_FK.includes('evolutionCursor'));
  assert.ok(SHOP_SCOPED_TABLES_WITHOUT_FK.includes('adminAuditLog'));
  assert.equal(SHOP_SCOPED_TABLES_WITHOUT_FK.length, 4);
});

test('every table name resolves to a real Prisma delegate with deleteMany', async () => {
  // db[table] is indexed directly in the handler, so a name that does not
  // resolve throws at redaction time — on a path that only ever runs in
  // production, 48h after an uninstall, where nobody is watching. A casing
  // check is not enough: `visitorTouches`, `visitorTouchs` and `visitorTouchX`
  // all pass a casing check and all throw at runtime.
  //
  // Constructing PrismaClient does NOT open a connection, so this needs no
  // database. It asserts against the generated client, which is the thing the
  // handler actually indexes.
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient();
  try {
    for (const t of SHOP_SCOPED_TABLES_WITHOUT_FK) {
      assert.equal(
        typeof client[t]?.deleteMany,
        'function',
        `db.${t}.deleteMany must exist — the redact handler indexes it by this exact name`
      );
    }
    // The fifth table, deleted by filter rather than by the loop.
    assert.equal(typeof client.metaLearningInsights?.deleteMany, 'function');
  } finally {
    await client.$disconnect();
  }
});

test('the insight filter is scoped by BOTH type and segment prefix', () => {
  const filter = shopScopedInsightFilter('abc-123');
  assert.deepEqual(filter, {
    insightType: { in: ['surface_arm_stats', 'discount_arm_stats'] },
    segment: { startsWith: 'abc-123::' }
  });
});

test('insight types match the two shop-scoped writers and nothing else', () => {
  // surface-arm.server.js:25 and discount-arm.server.js:30. `generated_copy`
  // is keyed by baseline and cluster priors by cluster dims — both global, and
  // sweeping either up would damage every other shop.
  assert.deepEqual(SHOP_SCOPED_INSIGHT_TYPES, ['surface_arm_stats', 'discount_arm_stats']);
  assert.ok(!SHOP_SCOPED_INSIGHT_TYPES.includes('generated_copy'));
});

test('the segment predicate matches this shop', () => {
  assert.equal(segmentBelongsToShop('abc-123', 'abc-123::mobile'), true);
  assert.equal(segmentBelongsToShop('abc-123', 'abc-123::bucket_7'), true);
});

test('the :: is load-bearing — a longer id that shares a prefix must not match', () => {
  // Without the separator, redacting shop 'abc-123' would delete shop
  // 'abc-1234's rows too.
  assert.equal(segmentBelongsToShop('abc-123', 'abc-1234::mobile'), false);
  assert.equal(segmentBelongsToShop('abc-123', 'abc-123-extra::mobile'), false);
});

test('a single colon is not the convention and must not match', () => {
  assert.equal(segmentBelongsToShop('abc-123', 'abc-123:mobile'), false);
});

test('a different shop never matches', () => {
  assert.equal(segmentBelongsToShop('abc-123', 'def-456::mobile'), false);
});

test('bad input is false, never a throw and never a match-all', () => {
  assert.equal(segmentBelongsToShop('', '::mobile'), false);
  assert.equal(segmentBelongsToShop('abc-123', undefined), false);
  assert.equal(segmentBelongsToShop(undefined, 'abc-123::mobile'), false);
  assert.equal(segmentBelongsToShop(null, null), false);
});
