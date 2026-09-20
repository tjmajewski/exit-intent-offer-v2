/**
 * Reading money out of a Shopify order payload (HANDOFF-2026-09-19 §2.5, M1).
 *
 * Pure on purpose: every one of these rules is a reconciliation a merchant
 * will run against their own Shopify reports, so each one carries a test with
 * a hand-computed expected value rather than living inline in a webhook.
 *
 * Two rules, and they interact:
 *
 * 1. Revenue is a SUBTOTAL — after discounts, before tax and shipping.
 *    `total_price` includes both; sales tax is not revenue Resparq recovered
 *    and a merchant reconciling one month will find it. `total_price` is
 *    stored alongside so the choice is revisitable without a backfill.
 *
 * 2. The subtotal we store is `subtotal_price`, NOT `current_subtotal_price`.
 *    Shopify's `current_*` family exists precisely because the originals do
 *    not move: `current_subtotal_price` already reflects edits, returns and
 *    refunds. Storing it as the subtotal and then subtracting a refund again
 *    double-counts the reversal — a $40 refund on a $100 order reads as $20
 *    recovered instead of $60.
 *
 * So: `subtotal_price` is the gross, and the refund is DERIVED as the
 * difference between the two. That derivation is absolute rather than
 * additive, which is what makes it idempotent under Shopify's at-least-once
 * delivery: replaying the same webhook converges on the same number instead
 * of accumulating.
 */

import { ATTRIBUTION_WINDOW_DAYS } from './metrics-contract.js';

const ARM_SHOWN = 'shown';
const ARM_SKIP = 'skip';
const ARM_HOLDOUT = 'holdout';

/** Epoch millis from a Date, an ISO string, or a number. Null when unusable. */
function toTime(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : Date.parse(v));
  return Number.isFinite(t) ? t : null;
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Shipping, summed across shipping lines. Shopify has no single field. */
function shippingTotal(payload) {
  const lines = payload?.shipping_lines;
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + num(l?.price), 0);
}

/**
 * Shopify test orders and draft-order conversions must never reach M1.
 *
 * `test: true` is Bogus-Gateway checkout. A draft order arrives with
 * `source_name: 'shopify_draft_order'`. The app's own preview/test path
 * stamps `resparq_test_mode` on the cart, which the caller passes in.
 */
export function isExcludedOrder(payload, { previewSession = false } = {}) {
  if (previewSession) return true;
  if (payload?.test === true) return true;
  if (payload?.source_name === 'shopify_draft_order') return true;
  return false;
}

/**
 * Normalised money for one orders/create payload, in SHOP currency.
 *
 * `current_subtotal_price` is the live figure — it already reflects edits and
 * removed items. Shopify omits it on older payloads, so `subtotal_price` is
 * the fallback, and only then a derived total_price - tax - shipping.
 */
export function orderMoney(payload) {
  const totalPrice = num(payload?.total_price);
  const totalTax = num(payload?.total_tax);
  const totalShipping = shippingTotal(payload);

  // Gross: the order as placed. `subtotal_price` does not move with refunds.
  let subtotal;
  if (payload?.subtotal_price != null) {
    subtotal = num(payload.subtotal_price);
  } else if (payload?.current_subtotal_price != null) {
    // Very old payloads omit subtotal_price. Falling back to the current
    // figure means a refund that already happened is invisible rather than
    // double-counted — the safe direction of the two.
    subtotal = num(payload.current_subtotal_price);
  } else {
    // Last resort. Never negative: a payload missing everything should read
    // zero rather than invent a refund.
    subtotal = Math.max(0, totalPrice - totalTax - totalShipping);
  }

  // Net: what the order is worth now. Used only to derive the reversal.
  const currentSubtotal = payload?.current_subtotal_price != null
    ? num(payload.current_subtotal_price)
    : null;

  return {
    subtotal,
    currentSubtotal,
    totalPrice,
    totalTax,
    totalShipping,
    // Never defaulted. §2.5 forbids summing across currencies, and a
    // fabricated 'USD' is exactly how that rule gets broken without anyone
    // noticing — the row would sum into a total it does not belong to.
    shopCurrency: payload?.currency || null,
    presentmentCurrency: payload?.presentment_currency || null
  };
}

/**
 * How much of this order has been reversed, expressed against the SUBTOTAL so
 * it can be subtracted from M1 directly.
 *
 * Primary source is `refund_line_items.subtotal` — the line-level figure,
 * explicit and unambiguous. The gross-minus-current difference is the
 * cross-check and the fallback: it catches reversals with no line detail, and
 * because both inputs are absolute it stays idempotent under replay where an
 * additive running total would not.
 *
 * What is deliberately NOT used: a refund's `transactions` totals. Those are
 * the customer-facing amount with tax and shipping in them, so subtracting
 * one from a subtotal over-refunds — a $9.95 shipping refund would erase
 * $9.95 of product revenue from M1. A reversal we cannot measure against the
 * subtotal is reported as zero rather than as a wrong number.
 */
export function refundedSubtotal(payload) {
  const lineBased = lineItemRefundTotal(payload);

  const gross = payload?.subtotal_price != null ? num(payload.subtotal_price) : null;
  const current = payload?.current_subtotal_price != null ? num(payload.current_subtotal_price) : null;
  const derived = (gross != null && current != null) ? Math.max(0, gross - current) : null;

  if (derived == null) return lineBased;
  if (lineBased === 0) return derived;
  // Both available: take the larger. An order edit can move `current` without
  // a refund line, and a refund line can exist before `current` catches up.
  return Math.max(lineBased, derived);
}

/** Summed `refund_line_items.subtotal` across every refund on the payload. */
function lineItemRefundTotal(payload) {
  const refunds = payload?.refunds;
  if (!Array.isArray(refunds) || refunds.length === 0) return 0;

  let total = 0;
  for (const refund of refunds) {
    const lineItems = refund?.refund_line_items;
    if (Array.isArray(lineItems)) {
      total += lineItems.reduce((s, li) => s + num(li?.subtotal), 0);
    }
  }
  return total;
}

/**
 * Which arm this order's visitor was in, and whether they actually saw
 * anything — read from the cart stamps.
 *
 * RESOLVED BY RECENCY, NOT BY PRIORITY. Decisions are minted per carted page
 * load and Shopify never clears a cart attribute on its own, so one cart
 * routinely carries stamps from several page loads at once: a skip from page
 * A, a holdout from page C, a render from page D. A fixed precedence order
 * gets those carts wrong in whichever direction the order happens to favour —
 * and "render wins" in particular would let a stale render stamp from page A
 * turn a genuine page-C holdout visitor into a treated one, corrupting the
 * only causal number in the product.
 *
 * So every arm stamp carries its own timestamp (`<decisionId>|<epochMs>`) and
 * the newest one wins. `rendered` is true only when the render stamp belongs
 * to that same winning decision — a render stamp from an older decision says
 * nothing about what the winning decision did.
 *
 * Correctness does not depend on the client's stamp-clearing succeeding.
 * Clearing is a fire-and-forget fetch that an ad blocker or an unload can
 * drop; recency resolution is right either way.
 *
 * @param {Array} noteAttributes  payload.note_attributes
 * @returns {{arm: string|null, aiDecisionId: string|null, rendered: boolean,
 *            impressionId: string|null, decisionAt: Date|null,
 *            renderedDecisionId: string|null, renderedAt: Date|null}}
 */
export function readCartStamps(noteAttributes, { orderedAt = null, windowDays = ATTRIBUTION_WINDOW_DAYS } = {}) {
  const attrs = Array.isArray(noteAttributes) ? noteAttributes : [];
  // Shopify clears a cart attribute by setting it to the EMPTY STRING, not by
  // removing it. Without this normalisation a cleared stamp reads as present
  // with a blank value, and every cleared cart would resolve to whichever arm
  // the blank belonged to.
  const get = (name) => {
    const raw = attrs.find(a => a?.name === name)?.value;
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    return trimmed === '' ? null : trimmed;
  };

  // `<decisionId>|<epochMs>`. Legacy stamps are a bare value with no
  // timestamp; they sort oldest so any timestamped stamp beats them, which is
  // the right answer — a stamp written before this shipped is from an earlier
  // page load by definition.
  const parse = (raw, legacySentinel) => {
    if (raw == null) return null;
    const bar = raw.lastIndexOf('|');
    const id = bar === -1 ? raw : raw.slice(0, bar);
    const ts = bar === -1 ? 0 : (Number(raw.slice(bar + 1)) || 0);
    return {
      aiDecisionId: (id && id !== legacySentinel) ? id : null,
      at: ts
    };
  };

  const candidates = [
    { arm: ARM_HOLDOUT, ...(parse(get('exit_intent_holdout'), 'true') || {}), present: get('exit_intent_holdout') != null },
    { arm: ARM_SKIP, ...(parse(get('exit_intent_decision'), 'no_intervention') || {}), present: get('exit_intent_decision') != null },
    { arm: ARM_SHOWN, ...(parse(get('exit_intent_shown_decision'), null) || {}), present: get('exit_intent_shown_decision') != null }
  ].filter(c => c.present);

  // The render stamp. `exit_intent_ai_decision` carries the decision id it
  // belongs to; `exit_intent: 'true'` is the legacy flag with no id.
  const renderStamp = parse(get('exit_intent_ai_decision'), null);
  const legacyRenderFlag = get('exit_intent') === 'true';
  const impressionId = get('exit_intent_impression');

  // A render stamp is itself evidence of a shown decision. Include it as a
  // candidate so a cart that only ever got the render stamp (an older
  // extension, before the decision-time stamp existed) still resolves.
  if (renderStamp || legacyRenderFlag) {
    candidates.push({
      arm: ARM_SHOWN,
      aiDecisionId: renderStamp?.aiDecisionId ?? null,
      at: renderStamp?.at ?? 0,
      present: true,
      fromRender: true
    });
  }

  if (candidates.length === 0) {
    return {
      arm: null, aiDecisionId: null, rendered: false, impressionId: null,
      decisionAt: null, renderedDecisionId: null, renderedAt: null
    };
  }

  // Newest wins. Ties go to the render candidate: if a decision stamp and its
  // own render stamp carry the same timestamp they describe one event, and
  // the render is the more specific fact about it.
  const winner = candidates.reduce((best, c) => {
    if (c.at > best.at) return c;
    if (c.at === best.at && c.fromRender) return c;
    return best;
  });

  // Rendered only when the render stamp belongs to the winning decision.
  // A legacy render flag with no id can only vouch for a shown winner that
  // also has no id to contradict it.
  const rendered = winner.arm === ARM_SHOWN && (
    (renderStamp?.aiDecisionId != null && renderStamp.aiDecisionId === winner.aiDecisionId) ||
    (renderStamp?.aiDecisionId == null && legacyRenderFlag && winner.aiDecisionId == null) ||
    Boolean(winner.fromRender)
  );

  // A DISPLAYED modal outranks a later decision not to show one.
  //
  // Decisions are minted on every carted page load, and the cart page itself
  // almost always skips — so a shopper who was shown an offer, dismissed it
  // and checked out without clicking ends up with a fresher skip stamp than
  // their own render stamp. Resolved on recency alone that reads as "we
  // showed this person nothing", and the sale drops out of the merchant's
  // revenue entirely. Being shown something is not undone by a later page
  // deciding to stay quiet.
  //
  // Only over SKIP. A later holdout stamp still wins: holdout is a
  // measurement control and quietly moving a visitor into the treated group
  // corrupts the only causal number in the product.
  //
  // Bounded by the attribution window so a render cannot claim an order
  // forever — carts outlive the window they are attributed over.
  let resolvedWinner = winner;
  let resolvedRendered = rendered;
  if (winner.arm === ARM_SKIP && renderStamp?.aiDecisionId) {
    const orderedTime = toTime(orderedAt);
    const withinWindow =
      orderedTime == null ||
      renderStamp.at === 0 ||
      (orderedTime - renderStamp.at) / 86400000 <= windowDays;
    if (withinWindow) {
      resolvedWinner = {
        arm: ARM_SHOWN,
        aiDecisionId: renderStamp.aiDecisionId,
        at: renderStamp.at
      };
      resolvedRendered = true;
    }
  }

  return {
    arm: resolvedWinner.arm,
    aiDecisionId: resolvedWinner.aiDecisionId ?? null,
    rendered: resolvedRendered,
    impressionId,
    decisionAt: resolvedWinner.at > 0 ? new Date(resolvedWinner.at) : null,
    // The decision that actually RENDERED, regardless of which stamp won on
    // recency. When a later prefetch decision outranks an earlier rendered
    // one, the order still belongs to the decision the shopper saw — the
    // caller needs this to attribute it, rather than looking up the skip
    // decision and missing.
    renderedDecisionId: renderStamp?.aiDecisionId ?? null,
    renderedAt: renderStamp?.at > 0 ? new Date(renderStamp.at) : null
  };
}
