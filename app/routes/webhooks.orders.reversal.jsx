import { authenticate } from "../shopify.server";
import db from "../db.server";
import { orderMoney, refundedSubtotal } from "../utils/order-money.js";
import { applyOrderReversal } from "../utils/metrics-contract.server.js";

/**
 * Reversal webhooks: orders/updated and orders/cancelled.
 *
 * HANDOFF-2026-09-19 §2.5 makes this part of shipping M1 rather than a
 * follow-up. Without it, recovered revenue can only ever go UP — and a
 * merchant who refunds an order, then sees that order still claimed on the
 * dashboard, stops trusting every other number on the page. The headline
 * metric has to be able to go down.
 *
 * WHY NOT refunds/create. A refunds/create payload carries one refund and its
 * line items — not `subtotal_price`, not `current_subtotal_price`. You cannot
 * compute an ABSOLUTE reversal from it, only add to a running total, and an
 * additive total double-counts the moment Shopify redelivers (which it will;
 * delivery is at-least-once). orders/updated fires on refund, carries both
 * subtotal fields and the full refunds array, and lets every delivery
 * recompute the same answer from scratch. Idempotency by construction beats
 * idempotency by bookkeeping.
 *
 * orders/updated is the noisiest topic Shopify has — fulfillment, tags, notes,
 * risk, and once immediately after every orders/create. The guard below bails
 * on the payload alone, before touching the database, so the common case
 * costs nothing.
 *
 * An order Resparq never attributed has no AttributedOrder row and this
 * handler does nothing. A refund on someone else's order is not an error.
 */
export const action = async ({ request }) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    // Cheap payload-only guard. Nothing below this line runs for the large
    // majority of orders/updated deliveries, which carry no reversal at all.
    // An order EDIT that removes items moves current_subtotal_price without
    // producing a refund record or changing financial_status, so the
    // subtotal-refresh below has to be reachable on that signal too.
    const subtotalMoved =
      payload.subtotal_price != null &&
      payload.current_subtotal_price != null &&
      parseFloat(payload.subtotal_price) !== parseFloat(payload.current_subtotal_price);

    const hasReversal =
      payload.cancelled_at != null ||
      (Array.isArray(payload.refunds) && payload.refunds.length > 0) ||
      ['refunded', 'partially_refunded', 'voided'].includes(payload.financial_status) ||
      subtotalMoved;

    if (!hasReversal) {
      return new Response(null, { status: 200 });
    }

    console.log(`[Reversal Webhook] ${topic} for ${shop}`);

    const orderId = payload.id != null ? String(payload.id) : null;
    if (!orderId) {
      console.log('[Reversal Webhook] No order id on payload — skipping');
      return new Response(null, { status: 200 });
    }

    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true }
    });
    if (!shopRecord) {
      console.log('[Reversal Webhook] Unknown shop — nothing to reverse');
      return new Response(null, { status: 200 });
    }

    const existing = await db.attributedOrder.findUnique({
      where: { shopId_orderId: { shopId: shopRecord.id, orderId } }
    });
    if (!existing) {
      console.log(`[Reversal Webhook] Order ${orderId} was never attributed — nothing to reverse`);
      return new Response(null, { status: 200 });
    }

    // Absolute, recomputed from this payload. Replaying the same delivery
    // converges on the same number instead of accumulating.
    const money = orderMoney(payload);
    let refundedAmount = refundedSubtotal(payload);
    const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : null;

    // A voided order was never captured — no money changed hands, so none of
    // it is recovered revenue. Without this it passes the guard above and
    // then reverses nothing, leaving the full amount in M1.
    if (payload.financial_status === 'voided') {
      refundedAmount = Math.max(refundedAmount, money.subtotal);
    }

    // An order edit can change the gross. Keep it current so M1 reconciles
    // against what Shopify shows today — and write `subtotal_price`, the same
    // basis orders/create stored, never `current_subtotal_price`, or the two
    // mechanisms fight and the refund gets subtracted twice.
    if (money.subtotal > 0 && money.subtotal !== existing.subtotal) {
      await db.attributedOrder.update({
        where: { id: existing.id },
        data: {
          subtotal: money.subtotal,
          totalPrice: money.totalPrice,
          totalTax: money.totalTax,
          totalShipping: money.totalShipping
        }
      });
      console.log(`[Reversal Webhook] Order ${orderId} subtotal updated ${existing.subtotal} -> ${money.subtotal}`);
    }

    const updated = await applyOrderReversal(db, {
      shopId: shopRecord.id,
      orderId,
      refundedAmount,
      cancelledAt,
      // The order payload carries the whole reversal history, so this figure
      // is the truth rather than an increment. Taking the max instead would
      // make a restock, or an edit that adds items back, impossible to
      // reflect — the number could rise but never fall.
      absolute: true
    });

    console.log(
      `[Reversal Webhook] Order ${orderId}: refunded ${updated?.refundedAmount ?? 0} of ${updated?.subtotal ?? 0}` +
      (updated?.cancelledAt ? ' (cancelled)' : '')
    );

    return new Response(null, { status: 200 });
  } catch (error) {
    // authenticate.webhook throws a Response (401) on invalid HMAC — return it
    // as-is rather than swallowing it into a 500 that Shopify would retry.
    if (error instanceof Response) throw error;
    console.error('[Reversal Webhook] Error:', error);
    return new Response(null, { status: 500 });
  }
};
