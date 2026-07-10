// Visitor journey log — single write path for VisitorTouch rows.
//
// Every touchpoint interaction (modal shown/dismissed, pill redeem, cart
// banner apply, no-show, holdout, conversion) lands here so sequential
// learning has one journal to train on. Callers are fire-and-forget:
// recordTouch never throws — a lost journey row must never fail a decision,
// a click, or a webhook.
//
// Caller responsibilities (NOT enforced here):
//   - dev/preview gating (isLearningWriteSkipped) and merchant test mode
//   - client-supplied fields arrive pre-sanitized only from trusted server
//     paths; the public journey endpoint restricts surfaces/responses to
//     the client-legal subset before calling this.

export const TOUCH_SURFACES = new Set([
  'modal', 'pill', 'cart_banner', 'none', 'order'
]);

export const TOUCH_RESPONSES = new Set([
  'shown', 'skipped', 'holdout', 'dismissed', 'cta_click', 'redeem', 'apply', 'converted'
]);

// (surface, response) pairs a storefront browser may report directly via the
// public journey endpoint. Everything else (shown/skipped/holdout/cta_click/
// converted) is written server-side from authenticated paths — a client must
// not be able to forge decision or conversion rows.
export const CLIENT_ALLOWED_TOUCHES = new Set([
  'modal:dismissed',
  'pill:shown', 'pill:redeem', 'pill:dismissed',
  'cart_banner:shown', 'cart_banner:apply'
]);

const cleanStr = (v, max = 128) =>
  (typeof v === 'string' && v.length > 0) ? v.slice(0, max) : null;

const cleanNum = (v, min, max) =>
  (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) ? v : null;

const cleanInt = (v, min, max) => {
  const n = cleanNum(v, min, max);
  return n === null ? null : Math.floor(n);
};

/**
 * Record one touchpoint row. Returns the created row or null (invalid input
 * or write failure — logged, never thrown).
 */
export async function recordTouch(db, {
  shopId,
  visitorId,
  surface,
  response,
  variantId = null,
  impressionId = null,
  aiDecisionId = null,
  offerType = null,
  offerAmount = null,
  discountCode = null,
  triggerReason = null,
  propensityScore = null,
  segmentKey = null,
  showNumber = null,
  ignoreStreak = null
} = {}) {
  try {
    const vid = cleanStr(visitorId, 64);
    if (!shopId || !vid) return null; // no visitor id = unjoinable, skip
    if (!TOUCH_SURFACES.has(surface) || !TOUCH_RESPONSES.has(response)) {
      console.warn(`[Journey] Dropping touch with invalid surface/response: ${surface}/${response}`);
      return null;
    }

    return await db.visitorTouch.create({
      data: {
        shopId,
        visitorId: vid,
        surface,
        response,
        variantId: cleanStr(variantId),
        impressionId: cleanStr(impressionId),
        aiDecisionId: cleanStr(aiDecisionId),
        offerType: cleanStr(offerType, 32),
        offerAmount: cleanNum(offerAmount, 0, 100000),
        discountCode: cleanStr(discountCode, 64),
        triggerReason: cleanStr(triggerReason, 32),
        propensityScore: cleanInt(propensityScore, 0, 100),
        segmentKey: cleanStr(segmentKey),
        showNumber: cleanInt(showNumber, 0, 1000),
        ignoreStreak: cleanInt(ignoreStreak, 0, 100)
      }
    });
  } catch (e) {
    console.error('[Journey] Failed to record touch:', e.message);
    return null;
  }
}
