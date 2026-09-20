/**
 * Database side of the metrics contract (HANDOFF-2026-09-19 §2.5).
 *
 * The arithmetic lives in `metrics-contract.js` and is pure and tested. This
 * file only fetches rows and hands them over. Keep it that way: anything that
 * does maths in here is a number no test can check.
 */

import { canonicalWhere } from './shop-metrics.server.js';
import {
  computeRecoveredRevenue,
  computeVerifiedLift,
  computeShowRate,
  explainM1VsM3,
  ATTRIBUTION_WINDOW_DAYS,
  ARMS,
  M1_LABEL, M2_LABEL, M3_LABEL, M4_LABEL
} from './metrics-contract.js';

export { ATTRIBUTION_WINDOW_DAYS, ARMS };

/**
 * Ceiling on rows pulled into memory for M1/M2. Past this the page reports a
 * truncated figure rather than quietly getting slower every month.
 */
const MAX_ORDERS_SCANNED = 5000;

/**
 * Record (or update) the one row that represents this order.
 *
 * Keyed on (shopId, orderId) with a database-level unique constraint, so a
 * webhook retry, a concurrent delivery or a second call site produces an
 * UPDATE rather than a second row. §2.5 implementation logic item 2: "make
 * the order id the uniqueness constraint in the schema so the database
 * refuses the duplicate rather than relying on the call site."
 *
 * Reversal fields are deliberately NOT written here — an orders/create
 * payload knows nothing about a refund that hasn't happened yet, and passing
 * a default 0 through an upsert would wipe a reversal recorded earlier by
 * out-of-order webhook delivery.
 */
export async function upsertAttributedOrder(db, {
  shopId,
  orderId,
  orderNumber = null,
  orderedAt,
  arm,
  rendered = false,
  renderedAt = null,
  decisionAt = null,
  aiDecisionId = null,
  impressionId = null,
  subtotal,
  totalPrice,
  totalTax = 0,
  totalShipping = 0,
  discountAmount = 0,
  shopCurrency,
  presentmentCurrency = null,
  testOrder = false
}) {
  // Non-null merge. Every call site knows a different subset of these
  // fields, so writing the whole object on update lets a later caller with
  // less information erase what an earlier one established — an impressionId,
  // a decision timestamp, or the arm itself. Only write what we were given.
  const shared = {
    orderNumber,
    orderedAt,
    arm,
    rendered,
    renderedAt,
    decisionAt,
    aiDecisionId,
    impressionId,
    subtotal,
    totalPrice,
    totalTax,
    totalShipping,
    discountAmount,
    shopCurrency,
    presentmentCurrency,
    testOrder
  };

  const update = Object.fromEntries(
    Object.entries(shared).filter(([, v]) => v !== null && v !== undefined)
  );

  return db.attributedOrder.upsert({
    where: { shopId_orderId: { shopId, orderId } },
    create: { shopId, orderId, ...shared },
    update
  });
}

/**
 * Apply a refund or cancellation to an order already attributed.
 *
 * Without this the headline number can only ever go up. A merchant who
 * refunds an order and still sees it claimed on the dashboard stops trusting
 * every other number on the page — which is why §2.5 makes the reversal
 * webhook part of shipping M1 rather than a follow-up.
 *
 * Returns null when the order was never attributed to us: a refund on an
 * order Resparq had nothing to do with is not an error.
 */
export async function applyOrderReversal(db, { shopId, orderId, refundedAmount, cancelledAt, absolute = false }) {
  const existing = await db.attributedOrder.findUnique({
    where: { shopId_orderId: { shopId, orderId } }
  });
  if (!existing) return null;

  const data = {};
  if (refundedAmount != null) {
    // `absolute` means the caller recomputed the whole reversal from an
    // authoritative order payload, so it replaces what is stored — including
    // downward, which a restock or an edit that adds items back requires.
    //
    // Without it, take the larger of stored and incoming: that protects an
    // out-of-order delivery from losing money already given back, at the cost
    // of never being able to lower the figure. Only for callers that see part
    // of the picture.
    //
    // Clamped to the subtotal either way, so a tax-inclusive refund figure
    // can't push recovered revenue negative.
    const next = absolute
      ? refundedAmount
      : Math.max(existing.refundedAmount || 0, refundedAmount);
    data.refundedAmount = Math.max(0, Math.min(next, existing.subtotal));
  }
  if (cancelledAt !== undefined) {
    data.cancelledAt = cancelledAt;
  }
  if (Object.keys(data).length === 0) return existing;

  return db.attributedOrder.update({
    where: { id: existing.id },
    data
  });
}

/**
 * All four numbers, for one shop, over one window.
 *
 * M1/M2 come from AttributedOrder. M3/M4 come from InterventionOutcome, which
 * is the decision-level table — the two are counted from different rows on
 * purpose and are not expected to agree. See explainM1VsM3().
 */
export async function getMetricsContract(db, shopId, { since = null, until = null } = {}) {
  // There is no currency on the Shop record, so the currency can only come
  // from the orders themselves. computeRecoveredRevenue enforces the
  // single-currency rule internally from the rows it is given, so passing a
  // hint here is an optimisation, not the guard.
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { id: true }
  });
  if (!shop) return null;

  const orderWindow = {};
  if (since) orderWindow.gte = since;
  if (until) orderWindow.lte = until;
  const hasOrderWindow = Object.keys(orderWindow).length > 0;

  // M3 and M4 count DECISIONS, and canonicalWhere already owns those
  // definitions for the whole product — `treated` is intent-to-treat
  // (everyone the holdout coin sent to treatment, shown or not), `shown`
  // requires rendered, and `missed` is the decided-but-never-displayed slice.
  // Rolling a private copy here is how a sixth definition of "impressions"
  // gets born; use the canonical one and stay reconciled with
  // getShopMetrics and the admin console by construction.
  const W = canonicalWhere({
    shopIds: [shopId],
    from: since || new Date(0),
    to: until || null
  });

  const orderWhere = {
    shopId,
    arm: ARMS.SHOWN,
    testOrder: false,
    ...(hasOrderWindow ? { orderedAt: orderWindow } : {})
  };

  const [orders, firstOrder, treatedDecisions, treatedConversions,
         holdoutDecisions, holdoutConversions, missed, rendered] = await Promise.all([
    db.attributedOrder.findMany({
      where: orderWhere,
      orderBy: { orderedAt: 'desc' },
      // Bounded. This is the only figure on the page that is summed in JS
      // rather than by the database, so it must not grow without limit as a
      // merchant's order history does.
      take: MAX_ORDERS_SCANNED
    }),
    // Is this shop measuring yet, and since when? Distinguishes "no contract
    // data at all" from "no orders in the selected window", which are
    // different answers and only one of them is $0.
    db.attributedOrder.findFirst({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, shopCurrency: true }
    }),

    // M3 — intent-to-treat on BOTH sides, from canonicalWhere.
    db.interventionOutcome.count({ where: W.treated }),
    db.interventionOutcome.count({ where: W.treatedConverted }),
    db.interventionOutcome.count({ where: W.holdout }),
    db.interventionOutcome.count({ where: W.holdoutConverted }),

    // M4 — of the decisions that chose to show, how many displayed.
    // `shown` (rendered) and `missed` (decided, never displayed) are disjoint
    // and together are exactly the shown-arm decision set, so the show rate
    // is shown / (shown + missed) with no private filter of our own.
    db.interventionOutcome.count({ where: W.missed }),
    db.interventionOutcome.count({ where: W.shown })
  ]);

  const revenue = computeRecoveredRevenue(orders);
  const currency = revenue.currency;
  const lift = computeVerifiedLift({
    treatedDecisions, treatedConversions, holdoutDecisions, holdoutConversions
  });
  const showRate = computeShowRate({ decisions: missed + rendered, rendered });

  return {
    currency,
    // Null when the shop has no AttributedOrder rows at all. The UI shows
    // "measuring" for null and $0 for a real empty window — collapsing the
    // two is what makes a merchant think the page is broken.
    measuringSince: firstOrder?.createdAt ?? null,
    truncated: orders.length >= MAX_ORDERS_SCANNED,
    window: { since, until, attributionWindowDays: ATTRIBUTION_WINDOW_DAYS },
    m1: {
      label: M1_LABEL,
      amount: revenue.recoveredRevenue,
      orderCount: revenue.orderCount,
      excluded: revenue.excluded
    },
    m2: { label: M2_LABEL, amount: revenue.discountCost },
    net: revenue.netRecovered,
    m3: { label: M3_LABEL, ...lift },
    m4: { label: M4_LABEL, ...showRate },
    disclosure: explainM1VsM3()
  };
}
