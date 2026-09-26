/**
 * The metrics contract (HANDOFF-2026-09-19 §2.5).
 *
 * Four numbers, named distinctly, never mixed:
 *
 *   M1  recoveredRevenue  merchant-facing headline. Orders placed after a
 *                         shopper was SHOWN an offer. Attributed, not causal.
 *   M2  discountCost      what those same orders cost in discount.
 *   M3  verifiedLift      holdout vs treated, same moment, same population.
 *                         The only causal number in the product.
 *   M4  showRate          of the decisions made, how many produced a modal a
 *                         shopper actually saw. Internal diagnostic and the
 *                         tripwire for a silent confirm-render failure.
 *
 * Everything here is pure: rows in, numbers out, no database and no clock
 * beyond what the caller passes. That is deliberate — §2.5 requires every one
 * of these four numbers to carry a test with a hand-computed expected value,
 * and a function that opens its own Prisma client cannot have one.
 *
 * Money convention: every amount is in the SHOP's currency and is rounded to
 * cents only at the boundary (`round2`). Presentment currency is carried on
 * the row for display, never summed.
 */

/**
 * Attribution window, in days, from RENDER to order. Config, not a literal —
 * §2.5 calls the 7-day figure out by name as something that must be tunable.
 */
export const ATTRIBUTION_WINDOW_DAYS = 7;

/**
 * Minimum holdout sample before M3 is allowed to report a number at all.
 * Below this the UI says "measuring", never a projection.
 */
export const MIN_HOLDOUT_FOR_LIFT = 30;

/** Below this many decisions, M4 is noise rather than a tripwire. */
export const MIN_DECISIONS_FOR_SHOW_RATE = 50;

/**
 * A confirmed-render rate under this, with enough decisions behind it, means
 * confirm-render is being blocked rather than that shoppers aren't triggering.
 * §2 item 5: nothing computes this today, which is how the whole class of
 * show-side learning failures stayed invisible.
 */
export const SHOW_RATE_ALARM_THRESHOLD = 0.02;

const ARM_SHOWN = 'shown';
const ARM_SKIP = 'skip';
const ARM_HOLDOUT = 'holdout';
// Not an arm — the absence of one. An order we saw and could not resolve to a
// visitor, and therefore to a group. It carries its real money and is counted
// in no arm, so the coverage gap stays visible instead of being silently
// absorbed into whichever arm happened to have a stamp lying around.
const ARM_UNLINKED = 'unlinked';

export const ARMS = { SHOWN: ARM_SHOWN, SKIP: ARM_SKIP, HOLDOUT: ARM_HOLDOUT, UNLINKED: ARM_UNLINKED };

/** Cents, not float dust. 0.1 + 0.2 must not reach a merchant's screen. */
export function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toFiniteNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function toTime(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Why a row was left out of M1/M2. Surfaced so the dashboard (and the
 * reconcile script) can explain a gap rather than leaving a merchant to
 * discover it against their Shopify report.
 */
export const EXCLUSION = {
  DUPLICATE: 'duplicate_order_id',
  NOT_RENDERED: 'not_rendered',
  WRONG_ARM: 'not_shown_arm',
  // Distinct from WRONG_ARM on purpose. "Not the shown arm" is a decision we
  // made and can defend; "unlinked" is an order we failed to attribute at all,
  // and the two must never be reported as the same kind of gap.
  UNLINKED: 'unlinked',
  TEST_ORDER: 'test_order',
  CANCELLED: 'cancelled',
  FULLY_REFUNDED: 'fully_refunded',
  OUT_OF_WINDOW: 'outside_attribution_window',
  CURRENCY_MISMATCH: 'currency_mismatch',
  ZERO_VALUE: 'zero_value'
};

/**
 * Net of reversals for one order.
 *
 * A refund subtracts from revenue, and it subtracts the discount that funded
 * the refunded part along with it — a merchant who refunds half an order has
 * not paid us a full order's discount cost. Cancellation is a 100% reversal.
 *
 * `subtotal` is the GROSS subtotal (`subtotal_price`): after discounts,
 * before tax and shipping, and before any reversal. Tax is not revenue
 * Resparq recovered and shipping is not margin; §2.5 is explicit that using
 * `total_price` is what a reconciling merchant finds first. It is
 * deliberately not `current_subtotal_price`, which already has the refund
 * taken out of it — subtracting `refundedAmount` from that would count the
 * reversal twice. See orderMoney() in order-money.js.
 */
export function netOrderAmounts(row) {
  const grossSubtotal = Math.max(0, toFiniteNumber(row.subtotal));
  const discount = Math.max(0, toFiniteNumber(row.discountAmount));
  const cancelled = Boolean(row.cancelledAt);
  const refunded = cancelled
    ? grossSubtotal
    : Math.min(grossSubtotal, Math.max(0, toFiniteNumber(row.refundedAmount)));

  const netSubtotal = round2(grossSubtotal - refunded);
  // Prorate the discount against what survived. Full reversal -> zero cost,
  // which is the only answer that keeps M1 - M2 honest on a refunded order.
  const survivingShare = grossSubtotal > 0 ? netSubtotal / grossSubtotal : 0;
  const netDiscount = round2(discount * survivingShare);

  return {
    grossSubtotal: round2(grossSubtotal),
    refunded: round2(refunded),
    netSubtotal,
    grossDiscount: round2(discount),
    netDiscount,
    fullyReversed: grossSubtotal > 0 && netSubtotal === 0
  };
}

/**
 * M1 + M2. Computed together because §2.5 forbids showing one without the
 * other: "M1 shown without M2 is a half-truth."
 *
 * @param {Array} rows            AttributedOrder-shaped rows.
 * @param {object} opts
 * @param {string} opts.currency  Shop currency. Rows in any other currency are
 *                                excluded, never converted and never summed.
 * @param {number} opts.windowDays Render -> order window.
 * @returns {{recoveredRevenue, discountCost, netRecovered, orderCount, currency, excluded, orders}}
 */
export function computeRecoveredRevenue(rows, { currency = null, windowDays = ATTRIBUTION_WINDOW_DAYS } = {}) {
  const excluded = {};
  const seenOrderIds = new Set();
  const counted = [];

  const drop = (reason) => { excluded[reason] = (excluded[reason] || 0) + 1; };

  // The single-currency rule enforces itself from the rows, rather than
  // trusting the caller to pass the right currency. §2.5 states it outright
  // — never sum across currencies without conversion — and a caller that
  // passes null (or a shop with no currency recorded anywhere) would
  // otherwise switch the check off entirely and sum EUR into a USD total.
  //
  // The first row that carries a currency sets it; every later row must
  // match exactly, and a row with no currency at all cannot be shown to
  // belong to the same total, so it is excluded too.
  let activeCurrency = currency;

  for (const row of rows || []) {
    // "One order counted once" — the uniqueness constraint lives in the
    // schema, but a query that joins can still hand us the same order twice.
    const orderKey = String(row.orderId ?? '');
    if (orderKey && seenOrderIds.has(orderKey)) { drop(EXCLUSION.DUPLICATE); continue; }
    if (orderKey) seenOrderIds.add(orderKey);

    if (row.testOrder) { drop(EXCLUSION.TEST_ORDER); continue; }
    // Checked BEFORE the arm test, which would otherwise file it under
    // "not the shown arm". An order we could not attribute at all is not a
    // decision we made — it is a measurement we failed to take, and the two
    // must stay separable or the coverage gap hides inside a number that
    // looks deliberate.
    if (row.arm === ARM_UNLINKED) { drop(EXCLUSION.UNLINKED); continue; }
    // M1 counts a modal a shopper SAW. Not decided, not prefetched.
    if (row.arm !== ARM_SHOWN) { drop(EXCLUSION.WRONG_ARM); continue; }
    if (!row.rendered) { drop(EXCLUSION.NOT_RENDERED); continue; }

    // A row with no currency cannot be shown to belong to any total, so it
    // is excluded before it can be summed — including when it is the FIRST
    // row and there is no active currency yet to compare it against.
    if (!row.shopCurrency) { drop(EXCLUSION.CURRENCY_MISMATCH); continue; }
    if (activeCurrency == null) {
      activeCurrency = row.shopCurrency;
    } else if (row.shopCurrency !== activeCurrency) {
      drop(EXCLUSION.CURRENCY_MISMATCH); continue;
    }

    // Window runs from RENDER, not from decision: the clock a shopper
    // experiences starts when they saw something.
    const renderedAt = toTime(row.renderedAt ?? row.decisionAt);
    const orderedAt = toTime(row.orderedAt);
    if (renderedAt != null && orderedAt != null) {
      const ageDays = (orderedAt - renderedAt) / 86400000;
      if (ageDays < 0 || ageDays > windowDays) { drop(EXCLUSION.OUT_OF_WINDOW); continue; }
    }

    const amounts = netOrderAmounts(row);
    if (row.cancelledAt) { drop(EXCLUSION.CANCELLED); continue; }
    if (amounts.fullyReversed) { drop(EXCLUSION.FULLY_REFUNDED); continue; }
    // A zero-value order contributes nothing and should not inflate the
    // order count a merchant reconciles against Shopify.
    if (amounts.netSubtotal === 0) { drop(EXCLUSION.ZERO_VALUE); continue; }

    counted.push({ orderId: orderKey, ...amounts });
  }

  const recoveredRevenue = round2(counted.reduce((s, o) => s + o.netSubtotal, 0));
  const discountCost = round2(counted.reduce((s, o) => s + o.netDiscount, 0));

  return {
    recoveredRevenue,                               // M1
    discountCost,                                   // M2
    netRecovered: round2(recoveredRevenue - discountCost),
    orderCount: counted.length,
    currency: activeCurrency,
    excluded,
    orders: counted
  };
}

/**
 * M3 — verified lift.
 *
 * Intent-to-treat on both sides: the denominator is DECISIONS, counted from
 * decision time, for treated and holdout alike. Counting treated from render
 * and holdout from decision is the apples-to-oranges comparison §2 item 3
 * describes, and it biases in the flattering direction every time.
 *
 * Returns nulls rather than zeros below the sample gate. A null is something
 * a UI can render as "measuring"; a zero is a lie with a decimal point.
 */
export function computeVerifiedLift({
  treatedDecisions = 0,
  treatedConversions = 0,
  holdoutDecisions = 0,
  holdoutConversions = 0,
  minHoldout = MIN_HOLDOUT_FOR_LIFT
} = {}) {
  const treatedCVR = treatedDecisions > 0 ? treatedConversions / treatedDecisions : null;
  const holdoutCVR = holdoutDecisions > 0 ? holdoutConversions / holdoutDecisions : null;

  const measured = holdoutDecisions >= minHoldout && treatedDecisions > 0;

  if (!measured || treatedCVR == null || holdoutCVR == null) {
    return {
      treatedDecisions, treatedConversions, holdoutDecisions, holdoutConversions,
      treatedCVR, holdoutCVR,
      liftPts: null, relativeLift: null, liftFactor: null,
      measured: false, minHoldout
    };
  }

  const liftPts = (treatedCVR - holdoutCVR) * 100;
  const relativeLift = holdoutCVR > 0 ? (treatedCVR - holdoutCVR) / holdoutCVR : null;
  // Share of attributed revenue that would not have happened. Clamped at 0
  // for the merchant surface; the signed liftPts stays available for the
  // admin console, which is allowed to see a negative result.
  const liftFactor = treatedCVR > 0 ? Math.max(0, (treatedCVR - holdoutCVR) / treatedCVR) : 0;

  return {
    treatedDecisions, treatedConversions, holdoutDecisions, holdoutConversions,
    treatedCVR, holdoutCVR,
    liftPts, relativeLift, liftFactor,
    measured: true, minHoldout
  };
}

/**
 * M4 — show rate. Of the decisions made, how many produced a modal a shopper
 * actually saw.
 *
 * `alarm` is the point of this metric. confirm-render is fire-and-forget and
 * is the sole gate on all show-side learning; when it is blocked the engine
 * learns "never show" and every other number degrades quietly. A near-zero
 * show rate over a real number of decisions is that failure, visible.
 */
export function computeShowRate({
  decisions = 0,
  rendered = 0,
  minDecisions = MIN_DECISIONS_FOR_SHOW_RATE,
  alarmThreshold = SHOW_RATE_ALARM_THRESHOLD
} = {}) {
  const enoughData = decisions >= minDecisions;
  const showRate = decisions > 0 ? rendered / decisions : null;
  return {
    decisions,
    rendered,
    showRate,
    measured: enoughData && showRate != null,
    alarm: Boolean(enoughData && showRate != null && showRate < alarmThreshold),
    minDecisions
  };
}

/**
 * The one line of plain language §2.5 requires next to M1 and M3. The first
 * merchant to notice that the two don't match will otherwise assume one of
 * them is fabricated.
 */
export function explainM1VsM3() {
  return 'Recovered revenue counts every order placed after a shopper saw an offer. ' +
    'Verified lift measures how many of those orders would not have happened anyway, ' +
    'against a holdout group. They answer different questions, so they will not match.';
}

/** §2.5 item 4: M1 is an attributed claim, never a causal one. */
export const M1_LABEL = 'Revenue from orders placed after a Resparq offer';
export const M2_LABEL = 'Discount cost on those orders';
export const M3_LABEL = 'Verified lift vs holdout';
export const M4_LABEL = 'Show rate';
