// Which rows belong to a shop for the purposes of `shop/redact`.
//
// HANDOFF-2026-09-19 §5.6 / 09-20 §6: the live redact handler
// (app/routes/webhooks.jsx) deleted every table that holds a foreign key to
// Shop and then called `db.shop.delete`. Because the tables below carry a
// plain `shopId` STRING and no FK, Postgres raised nothing, `shop.delete`
// succeeded, and the handler logged a clean success while the rows survived.
// That is the exact failure shape the handler's own header warns about, and
// `VisitorTouch` in particular holds a durable per-shopper `resparqVisitorId`.
//
// This module is pure so the one piece of arithmetic in the fix — the
// MetaLearningInsights segment prefix — can carry a test. The deleteMany calls
// themselves live in the handler.

/**
 * Tables that carry a `shopId` column with NO foreign key to Shop, and were
 * therefore silently missed by shop redaction.
 *
 * Order does not matter (no FKs between them), but they must all run BEFORE
 * `db.shop.delete`.
 *
 * `AdminAuditLog` is a judgement call rather than a mechanical one. These are
 * records of OUR admin actions against the shop, not the merchant's own data,
 * and GDPR erasure arguably does not reach them — deleting them destroys our
 * audit trail. Resolved in favour of deletion because the handler's standard
 * is "erasure means erasure", and a retained row keyed to the shop is exactly
 * what a regulator would ask about. Recorded here so the next person does not
 * reverse it blind. Its `shopId` is nullable; a `{ shopId }` filter matches
 * only the rows that have one, which is correct — null rows are login events
 * with no shop.
 */
export const SHOP_SCOPED_TABLES_WITHOUT_FK = [
  'visitorTouch',
  'variantSegmentStat',
  'evolutionCursor',
  'adminAuditLog'
];

/**
 * `MetaLearningInsights` has no shopId column at all. Two writers encode the
 * shop into the `segment` string instead:
 *   - surface-arm.server.js:74   → `${shopId}::${device}`
 *   - discount-arm.server.js:94  → `${shopId}::${bucket}`
 * Their insightType constants are the two below. Every other writer of this
 * table is genuinely global (generated_copy is keyed by baseline; cluster
 * priors are keyed by cluster dimensions) and must NOT be swept up.
 */
export const SHOP_SCOPED_INSIGHT_TYPES = ['surface_arm_stats', 'discount_arm_stats'];

/**
 * Prisma filter matching only this shop's MetaLearningInsights segments.
 *
 * A shop id is a v4 UUID, so the `<id>::` prefix cannot collide with another
 * shop's. The `::` is load-bearing: without it, a prefix match on the bare id
 * would also match a longer id that happens to start with the same characters.
 * Scoped by insightType as well as segment so that a future writer reusing the
 * `::` convention for something global cannot be silently swept in.
 *
 * @param {string} shopId
 * @returns {{ insightType: { in: string[] }, segment: { startsWith: string } }}
 */
export function shopScopedInsightFilter(shopId) {
  return {
    insightType: { in: SHOP_SCOPED_INSIGHT_TYPES },
    segment: { startsWith: `${shopId}::` }
  };
}

/**
 * Does a MetaLearningInsights segment belong to this shop? The predicate the
 * Prisma filter above expresses, exposed so it can be asserted directly.
 *
 * @param {string} shopId
 * @param {string} segment
 * @returns {boolean}
 */
export function segmentBelongsToShop(shopId, segment) {
  if (typeof shopId !== 'string' || !shopId.length) return false;
  if (typeof segment !== 'string') return false;
  return segment.startsWith(`${shopId}::`);
}

// KNOWN RESIDUAL, deliberately not fixed here.
//
// app/cron/calibrate-propensity.js:161 writes `storeIntercepts[shopId]` into
// the `data` JSON of a single GLOBAL MetaLearningInsights row, which
// propensity-model.server.js:220 reads back. A per-shop fitted coefficient
// keyed by shop id therefore survives redaction. Fixing it needs a
// read-modify-write of the global model row, which risks the live propensity
// model for every shop. It is a regression coefficient keyed by an internal
// UUID, not identifying data. Recorded in HANDOFF; do not fix it in the same
// change as this one.
