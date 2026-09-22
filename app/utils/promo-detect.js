/* eslint-env node */
// Is a merchant promotion already running for this visitor?
//
// HANDOFF-2026-09-19 §1.3: `signals.hasPromoActive` is READ in two places —
// baseline-selector.js:127,143 and the suppression-reason ternary in
// ai-decision.jsx — and WRITTEN nowhere.
// selectBaseline's no-discount-on-promo branch has therefore never executed.
// A Pro merchant running 20% site-wide has Resparq stack 15% on top of it,
// because every code is minted `combinesWith: { orderDiscounts: true, ... }`
// (discount-codes.js:128,316,397,481).
//
// This module is the missing writer. It is deliberately DETECTION ONLY.
//
// Why not fix it at issuance instead (flip `combinesWith` to false):
//   - Not retroactive. Every code already minted keeps combinesWith: true.
//   - The failure mode inverts and gets worse. A shopper carrying the
//     merchant's 20% site-wide code redeems Resparq's 15%, Shopify refuses to
//     combine, and depending on order of application the shopper can end up
//     paying MORE than they would have without us. Stacking costs the merchant
//     margin; replacing costs the shopper money.
//   - `shippingDiscounts: false` would break every free-shipping promo.
// The comment at discount-codes.js:126 documents that choice and it is right.
// The gap is that nobody ever detected the promo, not that we combined with it.
//
// The asymmetry that makes detection safe to ship on a live shop:
//   - False positive (we think there's a promo, there isn't): the visitor gets
//     a no-discount baseline — a reminder instead of an offer. The modal STILL
//     renders, still stamps the cart, and a no-click conversion still credits.
//     No merchant-facing number goes to zero.
//   - False negative (promo running, we miss it): status quo, no regression.

/**
 * Is the guard allowed to act at all?
 *
 * OFF BY DEFAULT, and that is a deliberate, temporary state — see HANDOFF
 * 2026-09-21 §3.2. The reasoning, recorded so it can be revisited rather than
 * cargo-culted:
 *
 * The one live shop is `568e5d-75.myshopify.com`, `mode=ai` (NOT hybrid, as an
 * earlier reading of a dev-database row wrongly concluded), and their trial
 * decision is days away. Turning this on changes which offer they serve, and
 * the production data cannot say how often: 9 rendered impressions in 30 days
 * is below any threshold at which a promoInCart rate means anything.
 *
 * What settles it is that they issued $0 of discounts over those 30 days. No
 * discount is being issued, so nothing is being stacked, so §1.3's harm is
 * currently theoretical FOR THIS SHOP — while switching the guard on is a real
 * unmeasured change to a live merchant's offers during a trial. Holding it
 * costs nothing today; shipping it risks something.
 *
 * TO TURN ON: set RESPARQ_PROMO_GUARD_ENABLED=1, after
 * `scripts/ops/promo-guard-preflight.mjs` has run against PRODUCTION and
 * reported a real verdict rather than INSUFFICIENT SAMPLE. It is a flag flip
 * and a restart, no deploy.
 *
 * This is separate from hasPromoActive() so that predicate stays pure and its
 * tests stay hand-computable — an env read inside it would make every
 * assertion depend on ambient state.
 *
 * @returns {boolean}
 */
export function promoGuardEnabled() {
  return process.env.RESPARQ_PROMO_GUARD_ENABLED === '1';
}

/**
 * @param {Object} input
 * @param {boolean} input.promoInCart - client-reported: the cart carries a
 *   discount code or any line-item discount. Site-wide AUTOMATIC discounts
 *   allocate to line items, which is exactly the §1.3 case.
 * @param {Object|null} input.shopPromotion - an active site_wide row from the
 *   Promotion table, when one is known. Null for shops whose promos we do not
 *   track.
 * @param {boolean} input.isTestMode - merchant walking their own storefront.
 * @param {boolean} input.isHybrid - merchant pinned the offer themselves.
 * @returns {boolean}
 */
export function hasPromoActive({ promoInCart, shopPromotion, isTestMode, isHybrid } = {}) {
  // Test mode must always reach the engine, consistent with the existing
  // carve-out on the Enterprise promo block in ai-decision.jsx. A merchant
  // testing their own offer with
  // a coupon in the cart must not get a reminder instead of the thing they
  // are trying to look at.
  if (isTestMode === true) return false;

  // Hybrid: the merchant pinned the offer amount by hand and Resparq honors
  // it (spec §2 #1, the same reason the Enterprise promo block in
  // ai-decision.jsx is guarded out for hybrid). Suppressing a pinned offer
  // because a promo is running is Resparq overriding an explicit instruction.
  //
  // What this carve-out does NOT do is make the guard zero-delta for a hybrid
  // shop — it is already inert there, for a different reason. Hybrid discards
  // selectBaseline's result entirely a few lines after the call:
  //   baseline = hybridOfferAmount > 0 ? 'conversion_with_discount' : 'pure_reminder'
  // So with or without this line, a hybrid shop's SERVED baseline is identical.
  //
  // The carve-out's only observable effect on a hybrid shop is to keep the
  // record honest: without it, the persisted AIDecision.signals JSON would say
  // hasPromoActive: true while the pinned discount was served anyway, and the
  // operator console's suppression string would claim a promo was the reason
  // nothing was spent. Both would be false.
  //
  // CONSEQUENCE, and it belongs in the handoff: §1.3 is structurally unfixable
  // for hybrid shops through selectBaseline, because the override outranks it.
  // A real hybrid promo guard has to act on the pinned offer itself — suppress
  // it, or reduce the amount — not on the baseline. Not attempted here.
  if (isHybrid === true) return false;

  return promoInCart === true || Boolean(shopPromotion);
}

/**
 * Client-reported cart state, normalised. Kept next to the predicate so the
 * `=== true` coercion is written once — `signals` is entirely client-supplied
 * (destructured from the request body in ai-decision.jsx) and a truthy string
 * must not read as a promo.
 *
 * Forgeable, and that is acceptable: the forgery direction is "claim a promo
 * exists" → receive a reminder instead of a discount. No shopper has an
 * incentive to do that.
 *
 * @param {Object} signals
 * @returns {boolean}
 */
export function normalisePromoInCart(signals) {
  return signals?.promoInCart === true;
}
