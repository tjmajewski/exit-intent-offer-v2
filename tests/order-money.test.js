import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  orderMoney,
  refundedSubtotal,
  isExcludedOrder,
  readCartStamps
} from '../app/utils/order-money.js';

describe('orderMoney', () => {
  test('stores subtotal_price as the gross, NOT current_subtotal_price', () => {
    // The order was placed at 100 and 40 has since been refunded, so Shopify
    // reports current_subtotal_price 60. Storing 60 as the subtotal and then
    // subtracting the 40 refund again reports 20 recovered on an order that
    // recovered 60 — the double-subtraction this field choice exists to avoid.
    const m = orderMoney({
      total_price: '118.20',
      subtotal_price: '100.00',
      current_subtotal_price: '60.00',
      total_tax: '8.25',
      shipping_lines: [{ price: '9.95' }],
      currency: 'USD',
      presentment_currency: 'CAD'
    });
    assert.equal(m.subtotal, 100);
    assert.equal(m.currentSubtotal, 60);
    assert.equal(m.totalPrice, 118.2);
    assert.equal(m.totalTax, 8.25);
    assert.equal(m.totalShipping, 9.95);
    assert.equal(m.shopCurrency, 'USD');
    assert.equal(m.presentmentCurrency, 'CAD');
  });

  test('tax and shipping never enter the subtotal', () => {
    // 100 subtotal + 8.25 tax + 9.95 shipping = 118.20 total_price.
    // M1 must read 100. This is the reconciliation a merchant runs first.
    const m = orderMoney({
      total_price: '118.20', subtotal_price: '100.00',
      total_tax: '8.25', shipping_lines: [{ price: '9.95' }]
    });
    assert.equal(m.subtotal, 100);
  });

  test('falls back to current_subtotal_price on payloads with no subtotal_price', () => {
    // Refund already applied and invisible — under-reports rather than
    // double-subtracts, which is the safe direction of the two.
    const m = orderMoney({ total_price: '50.00', current_subtotal_price: '42.00', total_tax: '8.00' });
    assert.equal(m.subtotal, 42);
  });

  test('derives a subtotal only as a last resort', () => {
    // 118.20 - 8.25 - 9.95 = 100.00
    const m = orderMoney({
      total_price: '118.20', total_tax: '8.25', shipping_lines: [{ price: '9.95' }]
    });
    assert.equal(m.subtotal, 100);
  });

  test('a derived subtotal never goes negative', () => {
    const m = orderMoney({ total_price: '5.00', total_tax: '9.00' });
    assert.equal(m.subtotal, 0);
  });

  test('sums multiple shipping lines', () => {
    // 4.95 + 12.00 = 16.95
    const m = orderMoney({
      total_price: '100', subtotal_price: '80',
      shipping_lines: [{ price: '4.95' }, { price: '12.00' }]
    });
    assert.equal(m.totalShipping, 16.95);
  });

  test('a missing currency is null, never defaulted to USD', () => {
    // A fabricated currency sums a row into a total it does not belong to.
    const m = orderMoney({ total_price: '10', subtotal_price: '10' });
    assert.equal(m.shopCurrency, null);
  });

  test('missing fields read as zero, not NaN', () => {
    const m = orderMoney({});
    assert.equal(m.subtotal, 0);
    assert.equal(m.totalPrice, 0);
    assert.equal(m.totalTax, 0);
    assert.equal(m.totalShipping, 0);
    assert.equal(m.currentSubtotal, null);
  });
});

describe('refundedSubtotal', () => {
  test('no refunds is zero', () => {
    assert.equal(refundedSubtotal({ refunds: [] }), 0);
    assert.equal(refundedSubtotal({}), 0);
  });

  test('sums refund line subtotals, not transaction totals', () => {
    // Two lines refunded at 30 and 12 subtotal = 42.
    // The transaction says 46.20 because it carries tax; using that would
    // over-refund the merchant's recovered revenue by 4.20.
    const amount = refundedSubtotal({
      refunds: [{
        refund_line_items: [{ subtotal: '30.00' }, { subtotal: '12.00' }],
        transactions: [{ kind: 'refund', status: 'success', amount: '46.20' }]
      }]
    });
    assert.equal(amount, 42);
  });

  test('derives the reversal from gross minus current when there is no line detail', () => {
    // 100 placed, 60 now = 40 reversed. Absolute, so replaying converges.
    const amount = refundedSubtotal({ subtotal_price: '100.00', current_subtotal_price: '60.00' });
    assert.equal(amount, 40);
  });

  test('a shipping-only refund removes no product revenue', () => {
    // 9.95 of shipping was refunded. The subtotal did not move, and there are
    // no refund line items. Subtracting the tax/shipping-inclusive
    // transaction total would erase 9.95 of PRODUCT revenue from M1.
    const amount = refundedSubtotal({
      subtotal_price: '100.00',
      current_subtotal_price: '100.00',
      refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '9.95' }] }]
    });
    assert.equal(amount, 0);
  });

  test('takes the larger of the line-based and derived figures', () => {
    // Lines say 30; current_subtotal says 100 - 55 = 45 reversed (an edit
    // removed more than the refund lines account for). Take 45.
    const amount = refundedSubtotal({
      subtotal_price: '100.00',
      current_subtotal_price: '55.00',
      refunds: [{ refund_line_items: [{ subtotal: '30.00' }] }]
    });
    assert.equal(amount, 45);
  });

  test('is idempotent under replay', () => {
    // The same payload delivered twice must produce the same number, not an
    // accumulating one. This is the property the additive version lacked.
    const payload = {
      subtotal_price: '100.00', current_subtotal_price: '60.00',
      refunds: [{ refund_line_items: [{ subtotal: '40.00' }] }]
    };
    assert.equal(refundedSubtotal(payload), 40);
    assert.equal(refundedSubtotal(payload), 40);
  });

  test('accumulates across several refunds on one order', () => {
    // 20 + 15 = 35
    const amount = refundedSubtotal({
      refunds: [
        { refund_line_items: [{ subtotal: '20.00' }] },
        { refund_line_items: [{ subtotal: '15.00' }] }
      ]
    });
    assert.equal(amount, 35);
  });
});

describe('isExcludedOrder', () => {
  test('excludes Shopify test orders', () => {
    assert.equal(isExcludedOrder({ test: true }), true);
  });
  test('excludes draft orders', () => {
    assert.equal(isExcludedOrder({ source_name: 'shopify_draft_order' }), true);
  });
  test('excludes the app preview/test session path', () => {
    assert.equal(isExcludedOrder({}, { previewSession: true }), true);
  });
  test('a real order is not excluded', () => {
    assert.equal(isExcludedOrder({ test: false, source_name: 'web' }), false);
  });
});

describe('readCartStamps', () => {
  const T = (ms) => String(ms);
  const stamp = (name, id, at) => ({ name, value: at == null ? id : `${id}|${T(at)}` });

  test('single holdout stamp', () => {
    const s = readCartStamps([stamp('exit_intent_holdout', 'dec_1', 1000)]);
    assert.equal(s.arm, 'holdout');
    assert.equal(s.aiDecisionId, 'dec_1');
    assert.equal(s.rendered, false);
  });

  test('legacy holdout stamp of "true" yields no decision id', () => {
    const s = readCartStamps([{ name: 'exit_intent_holdout', value: 'true' }]);
    assert.equal(s.arm, 'holdout');
    assert.equal(s.aiDecisionId, null);
  });

  test('legacy skip stamp of "no_intervention" yields no decision id', () => {
    const s = readCartStamps([{ name: 'exit_intent_decision', value: 'no_intervention' }]);
    assert.equal(s.arm, 'skip');
    assert.equal(s.aiDecisionId, null);
  });

  test('decision-time shown stamp alone is shown-but-NOT-rendered', () => {
    // The §2.2 case the second stamp exists to capture: decided, prepared,
    // never seen. Belongs in M3's ITT denominator, not in M1.
    const s = readCartStamps([stamp('exit_intent_shown_decision', 'dec_3', 5000)]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.rendered, false);
  });

  test('render stamp for the winning decision marks it rendered', () => {
    const s = readCartStamps([
      stamp('exit_intent_shown_decision', 'dec_3', 5000),
      stamp('exit_intent_ai_decision', 'dec_3', 5000),
      { name: 'exit_intent', value: 'true' },
      { name: 'exit_intent_impression', value: 'imp_9' }
    ]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.rendered, true);
    assert.equal(s.aiDecisionId, 'dec_3');
    assert.equal(s.impressionId, 'imp_9');
  });

  // --- the cases priority-ordering got wrong -------------------------------

  test('a STALE skip stamp does not shadow a later rendered modal', () => {
    // Page A skipped at t=1000. Page D showed and rendered at t=9000.
    // Under priority ordering this read as arm=skip, rendered=false, and the
    // order was dropped from M1 despite the shopper having seen the offer.
    const s = readCartStamps([
      stamp('exit_intent_decision', 'dec_a', 1000),
      stamp('exit_intent_shown_decision', 'dec_d', 9000),
      stamp('exit_intent_ai_decision', 'dec_d', 9000),
      { name: 'exit_intent', value: 'true' }
    ]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.rendered, true);
    assert.equal(s.aiDecisionId, 'dec_d');
  });

  test('a STALE render stamp does not turn a later holdout visitor into a treated one', () => {
    // Page A rendered at t=1000. Page C minted a holdout at t=8000.
    // "Render wins" would corrupt the only causal number in the product by
    // counting a control visitor as treated. Recency gets it right.
    const s = readCartStamps([
      stamp('exit_intent_shown_decision', 'dec_a', 1000),
      stamp('exit_intent_ai_decision', 'dec_a', 1000),
      { name: 'exit_intent', value: 'true' },
      stamp('exit_intent_holdout', 'dec_c', 8000)
    ]);
    assert.equal(s.arm, 'holdout');
    assert.equal(s.aiDecisionId, 'dec_c');
    assert.equal(s.rendered, false);
  });

  test('a render stamp from an older decision does not vouch for the winner', () => {
    // Winner is dec_d (shown, t=9000) but the only render stamp belongs to
    // dec_a. dec_d was decided and never displayed.
    const s = readCartStamps([
      stamp('exit_intent_ai_decision', 'dec_a', 1000),
      stamp('exit_intent_shown_decision', 'dec_d', 9000)
    ]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.aiDecisionId, 'dec_d');
    assert.equal(s.rendered, false);
  });

  test('a cleared stamp is absent, not an empty-valued skip', () => {
    // Shopify clears a cart attribute by setting it to the EMPTY STRING.
    // Without normalisation every cleared cart resolved to arm=skip.
    const s = readCartStamps([
      { name: 'exit_intent_decision', value: '' },
      stamp('exit_intent_shown_decision', 'dec_d', 9000),
      stamp('exit_intent_ai_decision', 'dec_d', 9000)
    ]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.rendered, true);
  });

  test('a legacy untimestamped stamp loses to any timestamped one', () => {
    // A stamp written before this shipped is from an earlier page load by
    // definition, so it sorts oldest.
    const s = readCartStamps([
      { name: 'exit_intent_decision', value: 'dec_old' },
      stamp('exit_intent_shown_decision', 'dec_new', 100)
    ]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.aiDecisionId, 'dec_new');
  });

  test('a legacy render-only cart still reads as shown and rendered', () => {
    // An un-updated theme extension writes only this. It must keep working.
    const s = readCartStamps([{ name: 'exit_intent', value: 'true' }]);
    assert.equal(s.arm, 'shown');
    assert.equal(s.rendered, true);
    assert.equal(s.aiDecisionId, null);
  });

  test('decisionAt is exposed for the attribution window', () => {
    const s = readCartStamps([stamp('exit_intent_shown_decision', 'dec_3', 1700000000000)]);
    assert.equal(s.decisionAt.getTime(), 1700000000000);
  });

  test('exposes the rendered decision separately from the winning one', () => {
    // A modal rendered as dec_d, then the /cart page minted dec_e which
    // skipped. Recency says the arm is skip, and that is the right reading of
    // the stamps — but the order, if a Resparq code is redeemed on it,
    // belongs to dec_d. The caller needs both facts.
    const s = readCartStamps([
      stamp('exit_intent_shown_decision', 'dec_d', 5000),
      stamp('exit_intent_ai_decision', 'dec_d', 5000),
      { name: 'exit_intent', value: 'true' },
      stamp('exit_intent_decision', 'dec_e', 9000)
    ]);
    assert.equal(s.arm, 'skip');
    assert.equal(s.aiDecisionId, 'dec_e');
    assert.equal(s.rendered, false);
    assert.equal(s.renderedDecisionId, 'dec_d');
    assert.equal(s.renderedAt.getTime(), 5000);
  });

  test('renderedDecisionId is null when nothing rendered', () => {
    const s = readCartStamps([stamp('exit_intent_decision', 'dec_e', 9000)]);
    assert.equal(s.renderedDecisionId, null);
    assert.equal(s.renderedAt, null);
  });

  test('no stamps at all is no arm', () => {
    const s = readCartStamps([]);
    assert.equal(s.arm, null);
    assert.equal(s.rendered, false);
    assert.equal(s.decisionAt, null);
    assert.equal(s.renderedDecisionId, null);
  });
});
