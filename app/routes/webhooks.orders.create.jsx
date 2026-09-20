import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordInterventionConversion, recordConversionForDecision } from "../utils/intervention-threshold.server.js";
import { orderMoney, refundedSubtotal, isExcludedOrder, readCartStamps } from "../utils/order-money.js";
import { upsertAttributedOrder } from "../utils/metrics-contract.server.js";
import { isLearningWriteSkipped } from "../utils/dev-shop-guard.server.js";
import { pruneAnalyticsEvents } from "../utils/analytics-metafield.js";

/**
 * Discount cost Resparq is actually responsible for on this order.
 *
 * `total_discounts` is the order's ENTIRE discount, so charging it to us the
 * moment one of our codes appears means a merchant's stacked sitewide code
 * lands on Resparq's margin — profit reads low and the engine learns that a
 * perfectly good offer was expensive. Shopify stamps a per-code `amount` on
 * each discount_codes entry; sum only the entries we matched.
 *
 * Fallback: when Shopify omits `amount`, total_discounts is only safe if our
 * code is the single code on the order. With several codes and no per-code
 * amounts the split is unknowable, so charge nothing rather than over-charge.
 *
 * @param {object} payload        orders/create webhook body
 * @param {Array}  matchedCodes   discount_codes entries we attributed (nulls ok)
 * @returns {number} discount in order currency, 0 when none of it is ours
 */
function ourDiscountAmount(payload, matchedCodes) {
  const seen = new Set();
  const matched = [];
  for (const dc of matchedCodes) {
    // exitDiscountUsed is normalised to exitIntentDiscount/configuredDiscountUsed
    // partway through the handler, so the same code arrives here twice.
    if (!dc?.code) continue;
    const key = dc.code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(dc);
  }
  if (matched.length === 0) return 0;

  const summed = matched.reduce((total, dc) => total + (parseFloat(dc.amount) || 0), 0);
  if (summed > 0) return summed;

  const allCodes = payload.discount_codes || [];
  return allCodes.length === 1 ? parseFloat(payload.total_discounts) || 0 : 0;
}

/**
 * Denormalised decision-time signals for an InterventionOutcome created on
 * the fallback path (no decision-time row to update). Shape is shared by all
 * three arms, which is why it stopped being inlined three times.
 */
function signalFieldsFromDecision(decision) {
  let signalData = {};
  if (decision?.signals) {
    try { signalData = JSON.parse(decision.signals); } catch { /* ignore */ }
  }
  return {
    propensityScore: signalData.propensityScore ?? signalData.propensity ?? null,
    intentScore: signalData.intentScore ?? null,
    cartValue: signalData.cartValue ?? null,
    deviceType: signalData.deviceType ?? null,
    trafficSource: signalData.trafficSource ?? null,
    segment: signalData.deviceType === 'mobile'
      ? 'mobile'
      : (signalData.deviceType === 'desktop' ? 'desktop' : 'all')
  };
}

/** signalFieldsFromDecision, for callers that hold an id rather than a row. */
async function signalFieldsForDecision(db, aiDecisionId) {
  if (!aiDecisionId) return signalFieldsFromDecision(null);
  const decision = await db.aIDecision.findUnique({ where: { id: aiDecisionId } });
  return signalFieldsFromDecision(decision);
}

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, payload, admin } = await authenticate.webhook(request);

    console.log(" Webhook received:", topic);
    console.log("Shop:", shop);

    // RENEWAL GUARD (spec 2.6): recurring subscription billing arrives on this
    // same orders/create webhook with source_name 'subscription_contract'.
    // Resparq discounts first orders only (spec 2.0) and never touches a
    // renewal, so counting one inside an attribution window would silently
    // inflate measured lift and corrupt holdout integrity. Bail before any
    // attribution matching.
    if (payload.source_name === 'subscription_contract') {
      console.log(`[Webhook] Subscription renewal (order ${payload.id}) — skipping attribution`);
      return new Response(null, { status: 200 });
    }

    // IDEMPOTENCY: claim this order before processing. Shopify retries
    // webhooks (and a 500 below guarantees one); without the claim, retries
    // double-count analytics revenue, conversion rows, and threshold counters.
    // At-most-once semantics: a partial failure after the claim loses that
    // order's attribution rather than double-counting on retry.
    try {
      await db.webhookOrder.create({
        data: { shopDomain: shop, orderId: String(payload.id) }
      });
    } catch (e) {
      if (e?.code === 'P2002') {
        console.log(`[Webhook] Order ${payload.id} already processed — skipping duplicate delivery`);
        return new Response(null, { status: 200 });
      }
      throw e;
    }

    // Dev/test stores must never write to the learning tables (poisons the
    // adaptive threshold). Decision endpoint already skips their impressions;
    // gate the webhook's conversion writes for consistency.
    const devWriteSkip = isLearningWriteSkipped({ shopDomain: shop });
    console.log("Order ID:", payload.id);
    console.log("Order total:", payload.total_price);

    // METRICS CONTRACT (§2.5). Revenue is `subtotal_price` — after discounts,
    // before tax and shipping — for every surface that reports or learns from
    // it. `total_price` carries sales tax and shipping, neither of which
    // Resparq recovered, and a merchant reconciling one month against their
    // Shopify report finds the difference immediately.
    //
    // Not `current_subtotal_price`: that one already has refunds taken out,
    // so storing it and then subtracting a reversal counts the refund twice.
    // See orderMoney(). `total_price` is still stored on AttributedOrder so
    // the choice is revisitable without a backfill.
    //
    // KNOWN GAP, deliberately out of this change: the legacy path below still
    // bills on `total_price` (`orderValue`, updateAnalytics, storeConversion,
    // UsageCharge.recoveredRevenue), so commission is charged on a basis that
    // includes sales tax while this card excludes it. Reconcile those before
    // the next billing cycle.
    const money = orderMoney(payload);
    const attributionRevenue = money.subtotal;

    // Which arm this cart's visitor was in, and whether they actually saw
    // anything. Resolved by recency across all the stamps on the cart —
    // Shopify never clears a cart attribute and a decision is minted per
    // carted page load, so one cart routinely carries several.
    const stamps = readCartStamps(payload.note_attributes);

    // Orders that must never reach M1: Bogus-Gateway test checkouts and
    // draft orders.
    //
    // KNOWN GAP: this does NOT cover a merchant self-testing on their live
    // storefront. `stampShownDecisionOnCart` honours isResparqTestMode(), but
    // `renderStampAttributes()` does not — so a test-mode render still stamps
    // `exit_intent` on a real cart, and an order placed through a real
    // gateway afterwards is counted. Pre-existing (the legacy metafield
    // revenue has always counted it); fix by guarding the render stamp the
    // same way the decision stamp is guarded.
    const excludedFromMetrics = isExcludedOrder(payload);

    /**
     * The one row that represents this order in the metrics contract.
     *
     * Unique on (shopId, orderId) in the schema, so a webhook retry or a
     * second call site produces an UPDATE. Every counting bug in HANDOFF §2
     * is a second row created where an existing row should have been updated;
     * this is the database refusing to let that happen again.
     *
     * An order that arrives already partially refunded (a slow webhook, a
     * replay) carries its reversal in the payload — record it now rather than
     * waiting for a refunds/create that already fired.
     */
    const recordAttributedOrder = async ({
      shopId, arm, aiDecisionId = null, impressionId = null, rendered = false,
      discountAmount = 0, decisionCreatedAt = null
    }) => {
      try {
        const alreadyRefunded = Math.min(refundedSubtotal(payload), money.subtotal);
        await upsertAttributedOrder(db, {
          shopId,
          orderId: String(payload.id),
          orderNumber: payload.name ?? (payload.order_number != null ? `#${payload.order_number}` : null),
          orderedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
          arm,
          rendered,
          // There is no render timestamp anywhere in the database —
          // InterventionOutcome carries `rendered` as a boolean and a
          // `timestamp` that is decision time. The cart stamp is the only
          // place a real one exists, so the decision stamp's clock is what
          // the attribution window runs from. Writing the ORDER's timestamp
          // here (as the first cut did) makes every order zero days old and
          // the window inert.
          renderedAt: rendered ? (stamps.decisionAt ?? null) : null,
          decisionAt: stamps.decisionAt ?? decisionCreatedAt ?? null,
          aiDecisionId,
          impressionId,
          subtotal: money.subtotal,
          totalPrice: money.totalPrice,
          totalTax: money.totalTax,
          totalShipping: money.totalShipping,
          discountAmount,
          // Null, never 'USD'. §2.5 forbids summing across currencies and a
          // fabricated currency is how that rule breaks silently.
          shopCurrency: money.shopCurrency,
          presentmentCurrency: money.presentmentCurrency,
          testOrder: excludedFromMetrics
        });
        if (alreadyRefunded > 0 || payload.cancelled_at) {
          const { applyOrderReversal } = await import('../utils/metrics-contract.server.js');
          await applyOrderReversal(db, {
            shopId,
            orderId: String(payload.id),
            refundedAmount: alreadyRefunded,
            cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : undefined
          });
        }
      } catch (err) {
        // Never fail the webhook over the reporting row. A lost AttributedOrder
        // costs one order's worth of M1; a thrown error costs the whole
        // delivery, and the idempotency claim above means Shopify's retry is
        // swallowed rather than reprocessed.
        console.error('[Webhook] AttributedOrder write failed:', err.message);
      }
    };

    // Check if our discount code was used
    const discountCodes = payload.discount_codes || [];
    let exitDiscountUsed = discountCodes.find(dc =>
      dc.code && (/^\d+(OFF|DOLLARSOFF)$/i.test(dc.code) || /^SAVE\d+$/i.test(dc.code))
    );

    // PRIMARY DETECTION: cart attribute stamped by modal JS on CTA click.
    // This fires for every offer type (discount, no-discount) and
    // is the most reliable signal that this order came from an exit intent interaction.
    const noteAttributes = payload.note_attributes || [];
    const exitIntentAttribute = noteAttributes.find(
      attr => attr.name === 'exit_intent' && attr.value === 'true'
    );
    if (exitIntentAttribute) {
      console.log('[Webhook] Exit intent cart attribute detected on order');
    }

    // EVOLUTION SYSTEM: Track conversion for variant performance
    const exitIntentDiscount = discountCodes.find(dc =>
      dc.code && dc.code.startsWith('EXIT')
    );

    // Also check if any order discount matches the shop's configured discount code
    // This handles manual mode where merchants use custom codes (e.g. "SAVE10")
    let configuredDiscountUsed = null;
    if (!exitDiscountUsed && !exitIntentDiscount && discountCodes.length > 0) {
      try {
        const shopCfg = await db.shop.findUnique({
          where: { shopifyDomain: shop },
          select: { discountCode: true, manualGenericDiscountCode: true, aiGenericDiscountCode: true }
        });
        const configuredCodes = [
          shopCfg?.discountCode,
          shopCfg?.manualGenericDiscountCode,
          shopCfg?.aiGenericDiscountCode
        ].filter(Boolean).map(c => c.toLowerCase());
        if (configuredCodes.length > 0) {
          configuredDiscountUsed = discountCodes.find(dc =>
            dc.code && configuredCodes.includes(dc.code.toLowerCase())
          ) || null;
        }
      } catch (e) {
        console.error("[Webhook] Error checking configured discount codes:", e);
      }
    }

    // Exact impression attribution: modal/pill/cart-banner CTA clicks stamp
    // exit_intent_impression on the cart. The fuzzy "latest clicked impression
    // in 24h" match misattributes as soon as two shoppers overlap.
    const impressionAttr = noteAttributes.find(
      attr => attr.name === 'exit_intent_impression'
    );

    // A Resparq code may have been redeemed on this order. `exitDiscountUsed`
    // and `configuredDiscountUsed` are NOT proof of that on their own —
    // `exitDiscountUsed` matches any `10OFF`/`SAVE20`-shaped code and
    // `configuredDiscountUsed` matches the shop's own configured code, both
    // of which a merchant uses in newsletters and campaigns that have nothing
    // to do with us. Provenance is established below, once shopRecord exists.
    const redeemedCode = exitIntentDiscount || exitDiscountUsed || configuredDiscountUsed;

    // Gate on ANY attribution signal, not just a redeemed discount code.
    // Previously this branch was `if (exitIntentDiscount)`, so an order that
    // converted through the cart-attribute path (customer saw the modal, went
    // on to buy without using the code) updated InterventionOutcome and the
    // Conversion table but left VariantImpression.converted false. The result
    // was a shop page reading "Orders attributed 1 / $1,000" directly above
    // "Conversions 0 / Revenue $0" — and, worse, the variant that earned the
    // order got no fitness credit, so evolution learned nothing from it.
    //
    // devWriteSkip is honoured here for the first time. VariantImpression is a
    // learning table (it feeds evolution fitness), and widening the gate above
    // would otherwise let dev/test orders write into it — exactly what the
    // flag exists to prevent.
    //
    // Holdout is excluded outright. A holdout visitor is a measurement
    // control; crediting their order to a variant's fitness is exactly the
    // contamination the holdout exists to avoid. The `exit_intent` flag is
    // never cleared from a cart, so without this check a stale one from an
    // earlier page load pulls holdout orders into evolution learning.
    const hasAttribution =
      stamps.arm !== 'holdout' &&
      (exitIntentDiscount || exitIntentAttribute || exitDiscountUsed || configuredDiscountUsed);

    if (hasAttribution && !devWriteSkip) {
      console.log(
        `[Evolution] Attributed order (${exitIntentDiscount ? `code ${exitIntentDiscount.code}` : 'cart attribute'})`
      );

      const shopRecord = await db.shop.findUnique({
        where: { shopifyDomain: shop }
      });

      if (shopRecord) {
        // Prefer the exact impression stamped on the cart; validate it belongs
        // to this shop and hasn't already converted (webhook retries are
        // handled upstream, but a shared device could replay an old id).
        let impression = null;
        if (impressionAttr?.value) {
          impression = await db.variantImpression.findFirst({
            where: {
              id: impressionAttr.value,
              shopId: shopRecord.id,
              converted: false
            }
          });
          if (!impression) {
            console.log(`[Evolution] Stamped impression ${impressionAttr.value} not usable — falling back to fuzzy match`);
          }
        }

        // Fallback (legacy orders without the stamp): most recent unconverted
        // impression that actually rendered. 24h window matches the
        // discount-code expiry — without it an order could credit a weeks-old
        // impression from a different visitor.
        //
        // `clicked` is NOT required. Requiring it meant no-click conversions
        // (saw the offer, closed it, checked out anyway) could never be
        // attributed on the fallback path. `rendered` is required instead:
        // impressions are minted at decision prefetch, so an unrendered row
        // represents a modal the visitor never saw and must not take credit.
        if (!impression) {
          impression = await db.variantImpression.findFirst({
            where: {
              shopId: shopRecord.id,
              converted: false,
              rendered: true,
              timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            orderBy: { timestamp: 'desc' }
          });
        }

        if (impression) {
          const { recordConversion } = await import('../utils/variant-engine.js');
          const revenue = parseFloat(payload.total_price);
          // Only the discount our own code granted — see ourDiscountAmount().
          const discountAmount = ourDiscountAmount(payload, [
            exitIntentDiscount, exitDiscountUsed, configuredDiscountUsed
          ]);

          await recordConversion(impression.id, revenue, discountAmount);

          console.log(`[Evolution] Conversion recorded for impression ${impression.id}`);
          console.log(`[Evolution] Revenue: $${revenue}, Discount: $${discountAmount}`);
        } else {
          console.log('[Evolution] No matching impression found for conversion');
        }
      }
    }

    // PHASE 5: Track ALL discount usage for promotional intelligence
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (shopRecord && discountCodes.length > 0) {
      for (const dc of discountCodes) {
        if (!dc.code) continue;

        // Find promotion in database
        const promo = await db.promotion.findFirst({
          where: {
            shopId: shopRecord.id,
            code: dc.code
          }
        });

        if (promo) {
          // Update usage stats
          const stats = JSON.parse(promo.usageStats);
          stats.total += 1;
          stats.last24h = (stats.last24h || 0) + 1;

          await db.promotion.update({
            where: { id: promo.id },
            data: {
              usageStats: JSON.stringify(stats)
            }
          });

          console.log(` Promotion usage tracked: ${dc.code} (Total: ${stats.total})`);

          // Classify promotion if not yet classified
          if (!promo.classification) {
            await classifyPromotion(promo.id);
          }
        }
      }
    }

    // ARM RESOLUTION. `stamps` resolves the cart's arm stamps by recency,
    // which is right for stamps alone — but recency is the wrong tie-breaker
    // against a REDEEMED RESPARQ CODE.
    //
    // A modal renders on a product page and the shopper clicks through with
    // the code. The very next carted page load (the /cart page itself) mints
    // a fresh decision, that decision skips, and its skip stamp is now the
    // newest thing on the cart. Resolved on recency alone the order reads as
    // `skip` — so the skip arm is credited with a conversion our modal
    // caused, the shown outcome is never marked converted, and the order
    // takes the skip branch's early return, losing the Conversion row, the
    // analytics revenue and the redemption flag.
    //
    // Two conditions, and BOTH are required:
    //
    //   1. Resparq provably issued the code. An EXIT-prefixed code is
    //      app-generated; anything else has to be matched to a DiscountOffer
    //      row we actually minted. Without this, a merchant's own `SAVE20`
    //      newsletter campaign — which `exitDiscountUsed`'s regex happily
    //      matches — books unrelated revenue into M1.
    //   2. Resparq decided something for this cart at all. A cart with no
    //      stamps never had a decision made for it, so there is no arm to
    //      correct and nothing to attribute.
    //
    // Holdout is deliberately NOT overridable. A holdout visitor is never
    // issued a code, so a code on a holdout cart means something else is
    // wrong — and silently reclassifying a control visitor as treated
    // corrupts the only causal number in the product.
    let resparqIssuedCode = Boolean(exitIntentDiscount);
    if (!resparqIssuedCode && redeemedCode?.code && shopRecord) {
      try {
        // Case-insensitive: the configured-code match above lowercases both
        // sides, and a merchant-typed generic code routinely differs in case
        // from the code Shopify puts on the order. An exact match here means
        // a real Resparq order fails provenance, resolves to `skip`, and is
        // lost from M1.
        const issued = await db.discountOffer.findFirst({
          where: {
            shopId: shopRecord.id,
            discountCode: { equals: redeemedCode.code, mode: 'insensitive' }
          },
          select: { id: true }
        });
        resparqIssuedCode = Boolean(issued);
      } catch (err) {
        console.error('[Webhook] Discount provenance lookup failed:', err.message);
      }
    }

    const armOverriddenByCode =
      resparqIssuedCode && stamps.arm != null && stamps.arm !== 'holdout';
    const resolvedArm = armOverriddenByCode ? 'shown' : stamps.arm;
    const resolvedRendered = stamps.rendered || armOverriddenByCode;
    // Under the override the winning stamp is the LATER skip decision, but the
    // order belongs to the decision that actually rendered. readCartStamps
    // hands that one back separately; without it the exact outcome lookup
    // misses and falls through to a shop-wide fuzzy match that can mark a
    // different shopper's outcome converted.
    const attributionDecisionId = armOverriddenByCode
      ? (stamps.renderedDecisionId ?? stamps.aiDecisionId)
      : stamps.aiDecisionId;

    if (armOverriddenByCode && stamps.arm !== 'shown') {
      console.log(
        `[Webhook] Arm resolved to 'shown' by Resparq-issued code (cart stamps said '${stamps.arm}')`
      );
    }

    // HOLDOUT CONVERSION TRACKING: Detect orders from the 5% holdout group.
    // These conversions are recorded for incrementality measurement but are
    // excluded from the adaptive threshold learning loop.
    // Gated on the RESOLVED arm, not on the raw attribute. A cart carrying a
    // stale holdout stamp from an earlier page load alongside a newer shown
    // decision is a treated visitor, and entering this branch on attribute
    // presence alone would return early and silently drop their order from
    // every downstream surface.
    if (resolvedArm === 'holdout' && shopRecord) {
      console.log('[Webhook] Holdout group conversion detected');
      try {
        const aiDecisionId = stamps.aiDecisionId;

        if (!devWriteSkip) {
          // The decision endpoint already inserted this outcome row at
          // prefetch time (wasShown:false, isHoldout:true, converted:false).
          // recordConversionForDecision updates it in place; a second insert
          // double-counts into getIncrementality's holdout numerator and
          // deflates reported lift. The find-or-create logic used to be
          // copy-pasted into each of these branches — §2.1 left that open and
          // the shared helper closes it.
          const { path } = await recordConversionForDecision(db, {
            shopId: shopRecord.id,
            aiDecisionId,
            wasShown: false,
            isHoldout: true,
            revenue: attributionRevenue,
            discountAmount: 0,
            fallbackFields: await signalFieldsForDecision(db, aiDecisionId)
          });
          console.log(`[Webhook] Holdout conversion ${path}: $${attributionRevenue}`);
        }
      } catch (err) {
        console.error('[Webhook] Error recording holdout conversion:', err.message);
      }

      // Outside the try above on purpose. The outcome write and the M1 write
      // are independent facts about this order, and a failure in the learning
      // table must not also cost the merchant-facing number — the idempotency
      // claim at the top of this handler means Shopify's retry returns early,
      // so anything skipped here is skipped permanently.
      if (!devWriteSkip) {
        await recordAttributedOrder({
          shopId: shopRecord.id,
          arm: 'holdout',
          aiDecisionId: stamps.aiDecisionId,
          rendered: false,
          discountAmount: 0
        });
      }

      // Holdout conversions don't flow into analytics/revenue attribution
      return new Response(null, { status: 200 });
    }

    // NATURAL CONVERSION TRACKING: Detect orders where AI decided NOT to show a modal
    // but the customer converted anyway. This closes the feedback loop for the
    // adaptive intervention threshold system.
    // The cart attribute value is now the unique aiDecisionId (not a boolean).
    if (resolvedArm === 'skip' && shopRecord) {
      console.log('[Webhook] Natural conversion detected — customer bought without modal');
      try {
        const decisionId = stamps.aiDecisionId;
        const hasExactDecisionId = Boolean(decisionId);

        // The exact id from the cart stamp is the only key safe to write a
        // conversion against. The legacy shop-wide fuzzy match below is fine
        // for reading cosmetic signal data, but selecting an outcome row with
        // it means a second shopper's still-open skip decision can be handed
        // this order's credit. recordConversionForDecision is given null in
        // that case and takes the create path.
        let recentDecision = null;
        if (hasExactDecisionId) {
          recentDecision = await db.aIDecision.findUnique({ where: { id: decisionId } });
        }
        if (!recentDecision) {
          recentDecision = await db.aIDecision.findFirst({
            where: {
              shopId: shopRecord.id,
              decision: { contains: 'no_intervention' },
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            orderBy: { createdAt: 'desc' }
          });
        }

        const exactDecisionId = (hasExactDecisionId && recentDecision) ? recentDecision.id : null;

        if (!devWriteSkip) {
          const { path } = await recordConversionForDecision(db, {
            shopId: shopRecord.id,
            aiDecisionId: exactDecisionId,
            wasShown: false,
            isHoldout: false,
            revenue: attributionRevenue,
            discountAmount: 0,
            fallbackFields: {
              ...signalFieldsFromDecision(recentDecision),
              // Keep the fuzzy id on the created row for forensics — it is
              // only unsafe as a LOOKUP key, not as a breadcrumb. Left null
              // when it came from the fuzzy path so the new unique index
              // can't collide two visitors onto one decision.
              aiDecisionId: exactDecisionId
            }
          });
          console.log(`[Webhook] Natural conversion ${path}: $${attributionRevenue}`);
        }
      } catch (err) {
        console.error('[Webhook] Error recording natural conversion:', err.message);
      }

      // Outside the try, for the same reason as the holdout branch.
      if (!devWriteSkip) {
        await recordAttributedOrder({
          shopId: shopRecord.id,
          arm: 'skip',
          aiDecisionId: stamps.aiDecisionId,
          rendered: false,
          discountAmount: 0
        });
      }

      // Return, the way the holdout branch does. Without this a cart that
      // resolved to skip fell through into the shown branch below and the
      // same order was credited to BOTH arms — a skip conversion and a shown
      // conversion from one purchase, which is the §2.1 double-count in a
      // new costume. The AI showed nothing here; there is no modal
      // attribution, no analytics revenue and no Conversion row to write.
      return new Response(null, { status: 200 });
    }

    // INTERVENTION CONVERSION TRACKING: When a modal WAS shown and the customer converts,
    // update the existing InterventionOutcome record with conversion data.
    // Uses the unique aiDecisionId stamped on the cart for precise matching.
    // The decision id comes from `stamps`, never from the raw cart attribute.
    // Arm and render stamps are written as `<decisionId>|<epochMs>` so the
    // server can resolve several page loads' worth of stamps by recency —
    // reading `.value` directly yields the composite, which matches no row in
    // AIDecision or InterventionOutcome and silently sends every lookup down
    // its fuzzy fallback.

    // The DECISION stamp says an arm was assigned for this cart; the RENDER
    // stamp says a shopper actually saw the surface. Before §2.2 the shown
    // arm only ever wrote the second one, so a decided-but-never-rendered
    // visitor left no trace and their order could not be attributed at all —
    // while their decision row still sat in the ITT denominator.
    const shownArmOnCart = resolvedArm === 'shown';

    let shownDiscountAmount = 0;
    let shownDecisionId = null;

    if ((shownArmOnCart || exitIntentAttribute || exitDiscountUsed || exitIntentDiscount || configuredDiscountUsed) && shopRecord) {
      try {
        const exactDecisionId = attributionDecisionId;
        let recentOutcome = null;

        // Prefer exact match by aiDecisionId
        if (exactDecisionId) {
          recentOutcome = await db.interventionOutcome.findFirst({
            where: {
              shopId: shopRecord.id,
              aiDecisionId: exactDecisionId,
              wasShown: true,
              converted: false
            }
          });
        }

        // Fallback: most recent unconverted shown outcome (for legacy orders
        // without ID). `rendered` is required here, unlike the exact match
        // above: outcomes are minted at prefetch, and recordInterventionConversion
        // backfills rendered on whatever row it is handed. Without the filter a
        // fuzzy match could land on a prefetched decision the visitor never saw
        // and mint it as an impression — a show that never happened.
        //
        // Only reachable when the cart carried the RENDER stamp. A cart with
        // just the decision stamp has no rendered row to match and must not
        // borrow someone else's.
        if (!recentOutcome && resolvedRendered) {
          recentOutcome = await db.interventionOutcome.findFirst({
            where: {
              shopId: shopRecord.id,
              wasShown: true,
              rendered: true,
              converted: false,
              timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            orderBy: { timestamp: 'desc' }
          });
        }

        const discountAmount = ourDiscountAmount(payload, [
          exitIntentDiscount, exitDiscountUsed, configuredDiscountUsed
        ]);

        if (recentOutcome && !devWriteSkip) {
          await recordInterventionConversion(
            db, recentOutcome.id, attributionRevenue, discountAmount,
            // No render stamp means the shopper never saw it. Mark the
            // outcome converted for intent-to-treat, but leave the bandit's
            // per-impression reward alone — see recordInterventionConversion.
            { proveRender: resolvedRendered }
          );
          console.log(`[Webhook] Intervention conversion recorded for outcome ${recentOutcome.id} (rendered=${resolvedRendered})`);
        }

        shownDiscountAmount = discountAmount;
        shownDecisionId = exactDecisionId;
      } catch (err) {
        console.error('[Webhook] Error recording intervention conversion:', err.message);
      }

      // Outside the try, for the same reason as the other two arms: the
      // learning write and the merchant-facing write are independent facts,
      // and the idempotency claim makes anything skipped here permanent.
      if (!devWriteSkip && (shownArmOnCart || exitIntentAttribute || exitDiscountUsed || exitIntentDiscount || configuredDiscountUsed)) {
        await recordAttributedOrder({
          shopId: shopRecord.id,
          arm: 'shown',
          aiDecisionId: shownDecisionId ?? attributionDecisionId,
          impressionId: stamps.impressionId,
          // M1 counts this order only if this is true.
          rendered: resolvedRendered,
          discountAmount: shownDiscountAmount
        });
      }

      // Journey log: conversion touch. The webhook has no visitorId of its
      // own — resolve it from the stamped impression's shown-touch, falling
      // back to the AI decision's recorded signals.
      if (!devWriteSkip) {
        try {
          let touchVisitorId = null;
          if (impressionAttr?.value) {
            const priorTouch = await db.visitorTouch.findFirst({
              where: { shopId: shopRecord.id, impressionId: impressionAttr.value },
              select: { visitorId: true }
            });
            touchVisitorId = priorTouch?.visitorId || null;
          }
          if (!touchVisitorId && stamps.aiDecisionId) {
            const dec = await db.aIDecision.findUnique({
              where: { id: stamps.aiDecisionId },
              select: { signals: true }
            });
            if (dec?.signals) {
              try { touchVisitorId = JSON.parse(dec.signals).visitorId || null; } catch { /* ignore */ }
            }
          }
          if (touchVisitorId) {
            const { recordTouch } = await import('../utils/journey.server.js');
            await recordTouch(db, {
              shopId: shopRecord.id,
              visitorId: touchVisitorId,
              surface: 'order',
              response: 'converted',
              impressionId: impressionAttr?.value || null,
              aiDecisionId: stamps.aiDecisionId,
              discountCode: exitDiscountUsed?.code || exitIntentDiscount?.code || configuredDiscountUsed?.code || null
            });
          }
        } catch (err) {
          console.error('[Webhook] Error recording conversion touch:', err.message);
        }
      }
    }

    // If no exit intent signal at all, skip
    // exitIntentAttribute  → cart attribute stamped by modal JS on CTA click (primary)
    // exitDiscountUsed     → legacy codes (e.g. 10OFF, 10DOLLARSOFF)
    // exitIntentDiscount   → EXIT-prefixed codes generated by the app
    // configuredDiscountUsed → manually-configured codes (manual mode)
    // The skip and holdout arms have already returned above, so anything
    // reaching here is either the shown arm or an order with no Resparq
    // involvement at all.
    if (!exitIntentAttribute && !exitDiscountUsed && !exitIntentDiscount && !configuredDiscountUsed) {
      console.log("No exit intent offer used, skipping");
      return new Response(null, { status: 200 });
    }

    // Normalise: treat EXIT-prefixed and configured codes the same as legacy discount codes
    // so that analytics, conversions and billing are recorded for all
    if (!exitDiscountUsed && (exitIntentDiscount || configuredDiscountUsed)) {
      exitDiscountUsed = exitIntentDiscount || configuredDiscountUsed;
    }

    // Mark the offer redeemed — closes the loop for budget tracking, redemption
    // reporting, and cleanup (which deletes expired UNredeemed offers; without
    // this flag converted offers were deleted too). Unique codes have one row;
    // generic codes share a code across rows, so mark only the most recent.
    if (shopRecord && exitDiscountUsed?.code) {
      try {
        const offerRow = await db.discountOffer.findFirst({
          where: {
            shopId: shopRecord.id,
            discountCode: exitDiscountUsed.code,
            redeemed: false
          },
          orderBy: { createdAt: 'desc' }
        });
        if (offerRow) {
          await db.discountOffer.update({
            where: { id: offerRow.id },
            data: { redeemed: true, redeemedAt: new Date() }
          });
          console.log(`[Webhook] Offer ${exitDiscountUsed.code} marked redeemed`);
        }
      } catch (err) {
        console.error('[Webhook] Error marking offer redeemed:', err.message);
      }
    }

    const orderValue = parseFloat(payload.total_price);
    console.log(` Exit intent offer attribution: ${exitDiscountUsed?.code || (exitIntentAttribute ? 'cart-attribute' : 'unknown')}`);
    console.log(` Order value: $${orderValue}`);

    // Update analytics and modal library
    await updateAnalytics(admin, orderValue);
    console.log(" Analytics updated with conversion and revenue");

    // CONVERSIONS TABLE: Store order-level data for reporting
    // Resolve the winning variant from the stamped impression so the
    // conversions table links order -> variant (was always null in AI mode).
    let attributedVariantId = null;
    let subscriptionConversion = false;
    if (impressionAttr?.value) {
      try {
        const attributedImpression = await db.variantImpression.findUnique({
          where: { id: impressionAttr.value },
          select: { variantId: true, shopId: true, cartSubscription: true }
        });
        if (attributedImpression && shopRecord && attributedImpression.shopId === shopRecord.id) {
          attributedVariantId = attributedImpression.variantId;
          // spec 2.6: flag conversions whose decision saw a subscription cart.
          subscriptionConversion = attributedImpression.cartSubscription &&
            attributedImpression.cartSubscription !== 'none';
        }
      } catch (err) {
        console.error('[Webhook] Variant resolution for conversion failed:', err.message);
      }
    }

    await storeConversion(shop, payload, exitDiscountUsed, admin, attributedVariantId, subscriptionConversion, {
      discountAmount: ourDiscountAmount(payload, [
        exitIntentDiscount, exitDiscountUsed, configuredDiscountUsed
      ])
    });
    console.log(" Conversion stored in conversions table");

    return new Response(null, { status: 200 });
  } catch (error) {
    // authenticate.webhook throws a Response (401) on invalid HMAC — return
    // it as-is. Swallowing it into a 500 made Shopify retry forged requests.
    if (error instanceof Response) throw error;
    console.error("Webhook error:", error);
    return new Response(null, { status: 500 });
  }
};

async function updateAnalytics(admin, revenue) {
  // Query current analytics and modal library
  const query = `
    query {
      shop {
        id
        analytics: metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
        modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
          value
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();

  const shopId = result.data.shop.id;

  // Parse current analytics or use defaults
  const currentValue = result.data.shop?.analytics?.value;
  const analytics = currentValue ? JSON.parse(currentValue) : {
    impressions: 0,
    clicks: 0,
    closeouts: 0,
    conversions: 0,
    revenue: 0,
    events: []
  };

  // Increment conversions and add revenue
  analytics.conversions += 1;
  analytics.revenue += revenue;

  // Add timestamped conversion event, then prune to the rolling window + cap
  // (shared bound — keeps the metafield from growing until metafieldsSet fails)
  if (!analytics.events) analytics.events = [];
  analytics.events.push({
    type: "conversion",
    timestamp: new Date().toISOString(),
    revenue: revenue
  });
  analytics.events = pruneAnalyticsEvents(analytics.events);

  console.log(" New analytics:", analytics);

  // Save updated analytics
  const analyticsMutation = `
    mutation SetAnalytics($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "analytics"
        value: $value
        type: "json"
      }]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  await admin.graphql(analyticsMutation, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify(analytics)
    }
  });

  // Update modal library stats
  const modalLibraryValue = result.data.shop?.modalLibrary?.value;
  if (modalLibraryValue) {
    const modalLibrary = JSON.parse(modalLibraryValue);
    const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);

    if (currentModal) {
      currentModal.stats.conversions = (currentModal.stats.conversions || 0) + 1;
      currentModal.stats.revenue = (currentModal.stats.revenue || 0) + revenue;

      // Push a conversion event so the analytics page (which filters by modal.stats.events)
      // correctly counts this order instead of recalculating from an empty events array
      if (!currentModal.stats.events) currentModal.stats.events = [];
      currentModal.stats.events.push({
        type: 'conversion',
        timestamp: new Date().toISOString(),
        revenue: revenue
      });

      console.log(` Updated ${currentModal.modalName} stats:`, currentModal.stats);

      // Save updated modal library
      const modalLibraryMutation = `
        mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "modal_library"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
          }
        }
      `;

      await admin.graphql(modalLibraryMutation, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(modalLibrary)
        }
      });
    }
  }
}

async function classifyPromotion(promoId) {
  const promo = await db.promotion.findUnique({
    where: { id: promoId }
  });

  if (!promo) return;

  const hoursSince = (Date.now() - promo.detectedAt.getTime()) / (1000 * 60 * 60);

  // Wait at least 4 hours before classifying
  if (hoursSince < 4) {
    console.log(`⏳ Waiting to classify ${promo.code} (only ${hoursSince.toFixed(1)} hours old)`);
    return;
  }

  const stats = JSON.parse(promo.usageStats);
  const usagePerHour = stats.total / hoursSince;

  let classification, aiStrategy, reason;

  // High usage = site-wide promotion.
  // Never auto-pause: keep recovering carts but let the AI shrink exit offers so
  // they don't stack on top of the site-wide promo. A merchant can still choose
  // Pause manually from the Promotions page if they want modals fully off.
  if (usagePerHour > 10) {
    classification = "site_wide";
    aiStrategy = "decrease";
    reason = `${promo.amount}% site-wide promo detected (${stats.total} uses in ${hoursSince.toFixed(1)} hours). AI reduced exit-offer amounts to avoid stacking discounts.`;
  }
  // Medium usage = targeted campaign
  else if (usagePerHour > 2) {
    classification = "targeted";
    aiStrategy = "continue";
    reason = `Targeted promo (${usagePerHour.toFixed(1)} uses/hour)`;
  }
  // Low usage = customer service code
  else {
    classification = "customer_service";
    aiStrategy = "ignore";
    reason = `Low usage - likely customer service code (${stats.total} total uses)`;
  }

  await db.promotion.update({
    where: { id: promo.id },
    data: {
      classification,
      aiStrategy,
      aiStrategyReason: reason,
      status: "active"
    }
  });

  console.log(` Promotion classified: ${promo.code} → ${classification} (${aiStrategy})`);
}

async function storeConversion(shop, orderPayload, discountUsed, admin, attributedVariantId = null, subscriptionConversion = false, { discountAmount = 0 } = {}) {
  try {
    // Find shop record
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      console.log("Shop not found in database, skipping conversion storage");
      return;
    }

    const settingsQuery = `
      query {
        shop {
          metafield(namespace: "exit_intent", key: "settings") {
            value
          }
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
        }
      }
    `;

    const settingsResponse = await admin.graphql(settingsQuery);
    const settingsResult = await settingsResponse.json();
    const settings = JSON.parse(settingsResult.data.shop?.metafield?.value || '{}');
    const modalLibrary = JSON.parse(settingsResult.data.shop?.modalLibrary?.value || '{"currentModalId":null,"modals":[]}');

    // Get current modal info
    const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);

    // Determine if modal had discount enabled
    const modalHadDiscount = settings.discountEnabled === true || settings.discountEnabled === 'true';

    // discountAmount arrives from the caller (ourDiscountAmount) so the
    // Conversion table, VariantImpression and InterventionOutcome all charge
    // Resparq the same figure — our code's share, never the order's total.

    // Store conversion
    await db.conversion.create({
      data: {
        shopId: shopRecord.id,
        orderId: orderPayload.id.toString(),
        orderNumber: orderPayload.order_number.toString(),
        orderValue: parseFloat(orderPayload.total_price),
        customerEmail: orderPayload.customer?.email || orderPayload.email ||
                       orderPayload.customer?.phone || orderPayload.phone || null,
        orderedAt: new Date(orderPayload.created_at),
        modalId: modalLibrary.currentModalId || 'unknown',
        modalName: currentModal?.modalName || 'Unknown Modal',
        variantId: attributedVariantId, // Resolved from the stamped impression (AI mode)
        modalHadDiscount: modalHadDiscount,
        discountCode: discountUsed?.code || null,
        discountRedeemed: !!discountUsed,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        subscriptionConversion: !!subscriptionConversion,
        modalSnapshot: currentModal ? JSON.stringify(currentModal.config) : null
      }
    });

    console.log(` Conversion stored: Order ${orderPayload.order_number} ($${orderPayload.total_price})`);
  } catch (error) {
    console.error("Error storing conversion:", error);
    // Don't throw - we don't want to fail the webhook if conversion storage fails
  }
}

