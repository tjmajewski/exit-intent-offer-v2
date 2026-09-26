import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRecoveredRevenue,
  computeVerifiedLift,
  computeShowRate,
  netOrderAmounts,
  round2,
  EXCLUSION,
  ATTRIBUTION_WINDOW_DAYS,
  MIN_HOLDOUT_FOR_LIFT,
  ARMS
} from '../app/utils/metrics-contract.js';

// Every expected value below is hand-computed and written out in the comment
// that precedes it. §2.5 item 5: a metric reaches a dashboard only once its
// arithmetic has been checked by a human once, on paper.

const DAY = 86400000;
const T0 = Date.parse('2026-09-01T12:00:00.000Z');

function shownOrder(over = {}) {
  return {
    orderId: 'o1',
    arm: 'shown',
    rendered: true,
    testOrder: false,
    shopCurrency: 'USD',
    subtotal: 100,
    totalPrice: 118,
    discountAmount: 10,
    refundedAmount: 0,
    cancelledAt: null,
    renderedAt: new Date(T0),
    orderedAt: new Date(T0 + DAY),
    ...over
  };
}

describe('round2', () => {
  test('kills float dust before it reaches a merchant', () => {
    // 0.1 + 0.2 = 0.30000000000000004 -> 0.3
    assert.equal(round2(0.1 + 0.2), 0.3);
    // 1.005 * 3 = 3.0149999999999997 -> 3.01
    assert.equal(round2(1.005 * 3), 3.01);
    assert.equal(round2(NaN), 0);
  });
});

describe('netOrderAmounts', () => {
  test('clean order: nothing reversed', () => {
    // subtotal 100, discount 10, no refund
    // netSubtotal = 100, netDiscount = 10 * (100/100) = 10
    const a = netOrderAmounts(shownOrder());
    assert.equal(a.netSubtotal, 100);
    assert.equal(a.netDiscount, 10);
    assert.equal(a.fullyReversed, false);
  });

  test('partial refund prorates the discount cost', () => {
    // subtotal 100, refunded 40, discount 10
    // netSubtotal = 100 - 40 = 60
    // survivingShare = 60/100 = 0.6
    // netDiscount = 10 * 0.6 = 6
    const a = netOrderAmounts(shownOrder({ refundedAmount: 40 }));
    assert.equal(a.netSubtotal, 60);
    assert.equal(a.netDiscount, 6);
    assert.equal(a.fullyReversed, false);
  });

  test('full refund zeroes both revenue and discount cost', () => {
    // subtotal 100, refunded 100 -> netSubtotal 0, netDiscount 10 * 0 = 0
    const a = netOrderAmounts(shownOrder({ refundedAmount: 100 }));
    assert.equal(a.netSubtotal, 0);
    assert.equal(a.netDiscount, 0);
    assert.equal(a.fullyReversed, true);
  });

  test('cancellation is a 100% reversal regardless of refund field', () => {
    const a = netOrderAmounts(shownOrder({ cancelledAt: new Date(T0 + DAY) }));
    assert.equal(a.netSubtotal, 0);
    assert.equal(a.refunded, 100);
  });

  test('a refund larger than the subtotal cannot drive revenue negative', () => {
    // Shopify refunds include tax and shipping; subtotal-only refund data can
    // arrive larger than the subtotal. Clamp, never go below zero.
    const a = netOrderAmounts(shownOrder({ refundedAmount: 500 }));
    assert.equal(a.netSubtotal, 0);
    assert.equal(a.netDiscount, 0);
  });
});

describe('M1 recovered revenue / M2 discount cost', () => {
  test('sums three clean orders', () => {
    // 100 + 250 + 49.99 = 399.99
    // discounts 10 + 25 + 5 = 40
    // net = 399.99 - 40 = 359.99
    const rows = [
      shownOrder({ orderId: 'a', subtotal: 100, discountAmount: 10 }),
      shownOrder({ orderId: 'b', subtotal: 250, discountAmount: 25 }),
      shownOrder({ orderId: 'c', subtotal: 49.99, discountAmount: 5 })
    ];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 399.99);
    assert.equal(m.discountCost, 40);
    assert.equal(m.netRecovered, 359.99);
    assert.equal(m.orderCount, 3);
  });

  test('excludes a decided-but-never-rendered order', () => {
    // M1 counts a modal a shopper SAW. rendered:false is a prefetch, not a show.
    const rows = [shownOrder({ orderId: 'a' }), shownOrder({ orderId: 'b', rendered: false })];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.orderCount, 1);
    assert.equal(m.excluded[EXCLUSION.NOT_RENDERED], 1);
  });

  test('excludes holdout and skip arms', () => {
    const rows = [
      shownOrder({ orderId: 'a' }),
      shownOrder({ orderId: 'b', arm: 'holdout' }),
      shownOrder({ orderId: 'c', arm: 'skip' })
    ];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.excluded[EXCLUSION.WRONG_ARM], 2);
  });

  test('counts an order once even if the query hands it over twice', () => {
    const rows = [shownOrder({ orderId: 'dup' }), shownOrder({ orderId: 'dup' })];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.orderCount, 1);
    assert.equal(m.excluded[EXCLUSION.DUPLICATE], 1);
  });

  test('excludes test orders', () => {
    const rows = [shownOrder({ orderId: 'a' }), shownOrder({ orderId: 't', testOrder: true })];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.orderCount, 1);
    assert.equal(m.excluded[EXCLUSION.TEST_ORDER], 1);
  });

  test('never sums across currencies', () => {
    const rows = [
      shownOrder({ orderId: 'a', shopCurrency: 'USD', subtotal: 100 }),
      shownOrder({ orderId: 'b', shopCurrency: 'CAD', subtotal: 999 })
    ];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.excluded[EXCLUSION.CURRENCY_MISMATCH], 1);
  });

  test('honours the attribution window from render', () => {
    // window is 7 days: day 7 counts, day 8 does not
    const inWindow = shownOrder({ orderId: 'in', orderedAt: new Date(T0 + 7 * DAY) });
    const outWindow = shownOrder({ orderId: 'out', orderedAt: new Date(T0 + 8 * DAY) });
    const m = computeRecoveredRevenue([inWindow, outWindow], { currency: 'USD' });
    assert.equal(m.orderCount, 1);
    assert.equal(m.excluded[EXCLUSION.OUT_OF_WINDOW], 1);
    assert.equal(ATTRIBUTION_WINDOW_DAYS, 7);
  });

  test('an order placed before the render cannot be credited to it', () => {
    const m = computeRecoveredRevenue(
      [shownOrder({ orderId: 'before', orderedAt: new Date(T0 - DAY) })],
      { currency: 'USD' }
    );
    assert.equal(m.orderCount, 0);
    assert.equal(m.excluded[EXCLUSION.OUT_OF_WINDOW], 1);
  });

  test('refunds subtract; the number can go down', () => {
    // a: 200 subtotal, 60 refunded, 20 discount
    //    net 140, discount 20 * (140/200) = 14
    // b: 100 subtotal, fully refunded -> excluded entirely
    // M1 = 140, M2 = 14, net = 126
    const rows = [
      shownOrder({ orderId: 'a', subtotal: 200, discountAmount: 20, refundedAmount: 60 }),
      shownOrder({ orderId: 'b', subtotal: 100, discountAmount: 10, refundedAmount: 100 })
    ];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 140);
    assert.equal(m.discountCost, 14);
    assert.equal(m.netRecovered, 126);
    assert.equal(m.excluded[EXCLUSION.FULLY_REFUNDED], 1);
  });

  test('cancelled orders are excluded, not just zeroed', () => {
    const rows = [
      shownOrder({ orderId: 'a' }),
      shownOrder({ orderId: 'x', cancelledAt: new Date(T0 + DAY) })
    ];
    const m = computeRecoveredRevenue(rows, { currency: 'USD' });
    assert.equal(m.orderCount, 1);
    assert.equal(m.excluded[EXCLUSION.CANCELLED], 1);
  });

  test('enforces one currency even when the caller passes none', () => {
    // §2.5 forbids summing across currencies. A caller with no currency to
    // pass (there is none on the Shop record) must not switch the rule off:
    // the first row that carries one sets it, and the rest must match.
    const rows = [
      shownOrder({ orderId: 'a', shopCurrency: 'USD', subtotal: 100 }),
      shownOrder({ orderId: 'b', shopCurrency: 'EUR', subtotal: 999 })
    ];
    const m = computeRecoveredRevenue(rows);
    assert.equal(m.currency, 'USD');
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.excluded[EXCLUSION.CURRENCY_MISMATCH], 1);
  });

  test('a row with no currency cannot join a currency total', () => {
    // The new nullable shopCurrency column: a payload that arrived without a
    // currency cannot be shown to belong to the USD total, so it stays out.
    const rows = [
      shownOrder({ orderId: 'a', shopCurrency: 'USD', subtotal: 100 }),
      shownOrder({ orderId: 'b', shopCurrency: null, subtotal: 50 })
    ];
    const m = computeRecoveredRevenue(rows);
    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.excluded[EXCLUSION.CURRENCY_MISMATCH], 1);
  });

  test('a null-currency row FIRST does not get counted before a currency is set', () => {
    // Rows arrive newest-first, so the null row can lead. Excluding it only
    // once activeCurrency was set meant 50 + 999 summed and were then
    // labelled EUR.
    const rows = [
      shownOrder({ orderId: 'a', shopCurrency: null, subtotal: 50 }),
      shownOrder({ orderId: 'b', shopCurrency: 'EUR', subtotal: 999 })
    ];
    const m = computeRecoveredRevenue(rows);
    assert.equal(m.recoveredRevenue, 999);
    assert.equal(m.currency, 'EUR');
    assert.equal(m.orderCount, 1);
  });

  test('all-null currencies sum to nothing rather than to an unlabelled total', () => {
    const rows = [
      shownOrder({ orderId: 'a', shopCurrency: null, subtotal: 50 }),
      shownOrder({ orderId: 'b', shopCurrency: null, subtotal: 75 })
    ];
    const m = computeRecoveredRevenue(rows);
    assert.equal(m.recoveredRevenue, 0);
    assert.equal(m.orderCount, 0);
    assert.equal(m.currency, null);
  });

  test('a zero-value order does not inflate the order count', () => {
    // A 100%-discounted or zero-priced order recovered no revenue. Counting
    // it as an order makes orderCount disagree with Shopify for no gain.
    const m = computeRecoveredRevenue(
      [shownOrder({ orderId: 'free', subtotal: 0, discountAmount: 0 })],
      { currency: 'USD' }
    );
    assert.equal(m.recoveredRevenue, 0);
    assert.equal(m.orderCount, 0);
    assert.equal(m.excluded[EXCLUSION.ZERO_VALUE], 1);
  });

  test('empty input is zero, not NaN', () => {
    const m = computeRecoveredRevenue([], { currency: 'USD' });
    assert.equal(m.recoveredRevenue, 0);
    assert.equal(m.discountCost, 0);
    assert.equal(m.netRecovered, 0);
    assert.equal(m.orderCount, 0);
  });

  test('subtotal, not total_price: tax and shipping never enter M1', () => {
    // total_price 118 carries 8 tax + 10 shipping on a 100 subtotal.
    // M1 must read 100. This is the reconciliation a merchant runs first.
    const m = computeRecoveredRevenue(
      [shownOrder({ subtotal: 100, totalPrice: 118 })],
      { currency: 'USD' }
    );
    assert.equal(m.recoveredRevenue, 100);
  });
});

describe('M3 verified lift', () => {
  test('reports nothing below the holdout sample gate', () => {
    // 29 holdout decisions, gate is 30
    const m = computeVerifiedLift({
      treatedDecisions: 1000, treatedConversions: 50,
      holdoutDecisions: 29, holdoutConversions: 1
    });
    assert.equal(m.measured, false);
    assert.equal(m.liftPts, null);
    assert.equal(m.liftFactor, null);
    assert.equal(MIN_HOLDOUT_FOR_LIFT, 30);
  });

  test('hand-computed lift at the gate', () => {
    // treated:  80 / 1000 = 8.0%
    // holdout:   3 /   50 = 6.0%
    // liftPts = 8.0 - 6.0 = 2 points
    // relativeLift = (0.08 - 0.06) / 0.06 = 0.3333...
    // liftFactor = (0.08 - 0.06) / 0.08 = 0.25
    const m = computeVerifiedLift({
      treatedDecisions: 1000, treatedConversions: 80,
      holdoutDecisions: 50, holdoutConversions: 3
    });
    assert.equal(m.measured, true);
    assert.equal(round2(m.liftPts), 2);
    assert.equal(round2(m.relativeLift * 100), 33.33);
    // liftFactor stays an unrounded ratio on purpose — it is multiplied
    // against revenue, and rounding it here would move dollars.
    assert.equal(round2(m.liftFactor), 0.25);
  });

  test('negative lift is reported signed, with the merchant factor clamped', () => {
    // treated:  40 / 1000 = 4%
    // holdout:   6 /  100 = 6%
    // liftPts = -2, liftFactor clamped to 0
    const m = computeVerifiedLift({
      treatedDecisions: 1000, treatedConversions: 40,
      holdoutDecisions: 100, holdoutConversions: 6
    });
    assert.equal(round2(m.liftPts), -2);
    assert.equal(m.liftFactor, 0);
    assert.equal(m.measured, true);
  });

  test('a zero-conversion holdout still measures once the sample is there', () => {
    // treated 50/1000 = 5%, holdout 0/40 = 0%
    // liftPts = 5, relativeLift undefined (div by zero) -> null, liftFactor 1
    const m = computeVerifiedLift({
      treatedDecisions: 1000, treatedConversions: 50,
      holdoutDecisions: 40, holdoutConversions: 0
    });
    assert.equal(round2(m.liftPts), 5);
    assert.equal(m.relativeLift, null);
    assert.equal(m.liftFactor, 1);
  });

  test('both arms are intent-to-treat: denominators are decisions', () => {
    // The guard against §2 item 3. If a caller passes rendered-only treated
    // counts against decision-time holdout counts the comparison is biased,
    // so the field names say decisions and the test pins the arithmetic.
    const m = computeVerifiedLift({
      treatedDecisions: 200, treatedConversions: 10,   // 5%
      holdoutDecisions: 200, holdoutConversions: 10    // 5%
    });
    assert.equal(round2(m.liftPts), 0);
    assert.equal(m.liftFactor, 0);
  });
});

describe('M4 show rate', () => {
  test('hand-computed rate', () => {
    // 340 renders / 1000 decisions = 34%
    const m = computeShowRate({ decisions: 1000, rendered: 340 });
    assert.equal(m.showRate, 0.34);
    assert.equal(m.measured, true);
    assert.equal(m.alarm, false);
  });

  test('raises the confirm-render alarm on a near-zero rate', () => {
    // 3 / 5000 = 0.06%, well under the 2% alarm line
    const m = computeShowRate({ decisions: 5000, rendered: 3 });
    assert.equal(m.alarm, true);
  });

  test('stays quiet below the minimum sample', () => {
    // 0 / 10 is zero, but 10 decisions is not evidence of anything
    const m = computeShowRate({ decisions: 10, rendered: 0 });
    assert.equal(m.measured, false);
    assert.equal(m.alarm, false);
  });

  test('no decisions yet is null, not zero', () => {
    const m = computeShowRate({ decisions: 0, rendered: 0 });
    assert.equal(m.showRate, null);
    assert.equal(m.measured, false);
  });
});

// ---------------------------------------------------------------------------
// The unlinked arm.
//
// An order we saw and could not resolve to a visitor is recorded — it has to
// be, or the coverage gap is invisible — but it is NOT an observation of any
// arm. Six of the twelve orders placed in the first live store's first twelve
// days were in exactly this state.
// ---------------------------------------------------------------------------
describe('ARM_UNLINKED', () => {
  test('is a distinct arm value, never an alias for an arm we chose', () => {
    assert.equal(ARMS.UNLINKED, 'unlinked');
    assert.notEqual(ARMS.UNLINKED, ARMS.SHOWN);
    assert.notEqual(ARMS.UNLINKED, ARMS.SKIP);
    assert.notEqual(ARMS.UNLINKED, ARMS.HOLDOUT);
  });

  test('has its own exclusion reason, distinct from "not the shown arm"', () => {
    // WRONG_ARM is a decision we made and can defend. UNLINKED is a failure to
    // attribute. Reporting them as one number hides the failure inside the
    // decision.
    assert.equal(EXCLUSION.UNLINKED, 'unlinked');
    assert.notEqual(EXCLUSION.UNLINKED, EXCLUSION.WRONG_ARM);
  });

  test('carries real money and still contributes nothing to M1', () => {
    // The money is real — this is a genuine order worth $500 — but nobody can
    // say whether Resparq caused it, so M1 must not claim it.
    const m = computeRecoveredRevenue([
      shownOrder({ orderId: 'linked', subtotal: 100 }),
      shownOrder({ orderId: 'lost', subtotal: 500, arm: ARMS.UNLINKED })
    ], { now: T0 });

    assert.equal(m.recoveredRevenue, 100);
    assert.equal(m.orderCount, 1);
    // Filed under its own reason, not under "not the shown arm": one is a
    // decision, the other is a failure to measure.
    assert.equal(m.excluded[EXCLUSION.UNLINKED], 1);
    assert.equal(m.excluded[EXCLUSION.WRONG_ARM], undefined);
  });
});
