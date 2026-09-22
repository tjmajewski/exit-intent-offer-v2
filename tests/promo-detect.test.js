// HANDOFF-2026-09-19 §1.3 — the promo-stacking guard.
//
// Two layers are asserted here: the predicate itself, and the baseline it
// actually produces. The predicate alone is not enough — the bug was never
// that the predicate was wrong, it was that nothing ever called it, and a
// guard that returns true but routes to a discount pool anyway fixes nothing.

/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPromoActive, normalisePromoInCart, promoGuardEnabled } from '../app/utils/promo-detect.js';
import { selectBaseline } from '../app/utils/baseline-selector.js';

// ---------------------------------------------------------------- predicate

test('the §1.3 case: a promo in the cart means a promo is active', () => {
  assert.equal(
    hasPromoActive({ promoInCart: true, shopPromotion: null, isTestMode: false, isHybrid: false }),
    true
  );
});

test('no promo anywhere is the untouched status quo', () => {
  assert.equal(
    hasPromoActive({ promoInCart: false, shopPromotion: null, isTestMode: false, isHybrid: false }),
    false
  );
});

test('a tracked site-wide Promotion row counts even with a clean cart', () => {
  assert.equal(
    hasPromoActive({ promoInCart: false, shopPromotion: { code: 'SUMMER20' }, isTestMode: false, isHybrid: false }),
    true
  );
});

test('test mode always reaches the engine, promo or not', () => {
  // A merchant walking their own storefront with a coupon in the cart must see
  // the offer they are testing, not a reminder.
  assert.equal(
    hasPromoActive({ promoInCart: true, shopPromotion: { code: 'X' }, isTestMode: true, isHybrid: false }),
    false
  );
});

test('hybrid honours the offer the merchant pinned by hand', () => {
  // Same carve-out as the Enterprise promo block at ai-decision.jsx:441.
  // This is what makes the guard zero-delta for the one live shop.
  assert.equal(
    hasPromoActive({ promoInCart: true, shopPromotion: null, isTestMode: false, isHybrid: true }),
    false
  );
});

test('signals are client-supplied, so only a real boolean true counts', () => {
  assert.equal(normalisePromoInCart({ promoInCart: true }), true);
  assert.equal(normalisePromoInCart({ promoInCart: 'true' }), false);
  assert.equal(normalisePromoInCart({ promoInCart: 1 }), false);
  assert.equal(normalisePromoInCart({}), false);
  assert.equal(normalisePromoInCart(undefined), false);
});

test('an absent input object does not throw and does not claim a promo', () => {
  assert.equal(hasPromoActive(), false);
  assert.equal(hasPromoActive({}), false);
});

// ------------------------------------------------- the baseline it produces
//
// Hand-computed against baseline-selector.js:
//   - the hasPromoActive branch (:141) returns BEFORE thresholdFitsVisitor
//     (:148) and before the high-intent bar (:155).
//   - detectFunnelGoal decides revenue_* vs conversion_*.

test('promo + low intent routes to a no-discount pool, not a discount pool', () => {
  const baseline = selectBaseline({
    hasPromoActive: true,
    propensityScore: 30,
    cartValue: 40,
    visitorId: 'v1'
  });
  assert.ok(
    baseline.endsWith('_no_discount'),
    `expected a no-discount baseline, got ${baseline}`
  );
});

test('promo beats the threshold branch for a high-intent, large-cart visitor', () => {
  // This is the case that is easy to get wrong: thresholdFitsVisitor is
  // evaluated AFTER the promo branch, so a visitor who would otherwise have
  // been handed a threshold offer must still come back no-discount.
  const signals = {
    hasPromoActive: true,
    propensityScore: 85,
    cartValue: 200,
    visitorId: 'v2'
  };
  const baseline = selectBaseline(signals);
  assert.ok(
    baseline.endsWith('_no_discount'),
    `expected a no-discount baseline, got ${baseline}`
  );
  assert.notEqual(baseline, 'revenue_with_discount');
});

test('negative control: without a promo, a low-intent visitor still gets money off', () => {
  // Proves the guard did not simply disable discounting for everyone — the
  // failure mode that would zero a merchant-facing number.
  const baseline = selectBaseline({
    hasPromoActive: false,
    propensityScore: 30,
    cartValue: 40,
    visitorId: 'v1'
  });
  assert.ok(
    baseline.includes('with_discount'),
    `expected a discount baseline, got ${baseline}`
  );
});

test('the guard changes the outcome for exactly the same visitor', () => {
  // Same signals, one flag apart. If these two are ever equal the guard is
  // inert again, which is the original bug.
  const signals = { propensityScore: 30, cartValue: 40, visitorId: 'v3' };
  const without = selectBaseline({ ...signals, hasPromoActive: false });
  const with_ = selectBaseline({ ...signals, hasPromoActive: true });
  assert.notEqual(without, with_);
});

// ------------------------------------------------------------------ the flag
//
// Off by default while the one live shop (mode=ai, 9 rendered impressions in
// 30 days, $0 discounts issued) is mid-trial. See promoGuardEnabled().

test('the guard is OFF unless the env flag is exactly "1"', () => {
  const original = process.env.RESPARQ_PROMO_GUARD_ENABLED;
  try {
    delete process.env.RESPARQ_PROMO_GUARD_ENABLED;
    assert.equal(promoGuardEnabled(), false, 'absent must be off');

    process.env.RESPARQ_PROMO_GUARD_ENABLED = '0';
    assert.equal(promoGuardEnabled(), false);

    // Not 'true', not 'yes' — one spelling, so a half-remembered value cannot
    // silently arm a guard that changes a live merchant's offers.
    process.env.RESPARQ_PROMO_GUARD_ENABLED = 'true';
    assert.equal(promoGuardEnabled(), false);

    process.env.RESPARQ_PROMO_GUARD_ENABLED = '1';
    assert.equal(promoGuardEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.RESPARQ_PROMO_GUARD_ENABLED;
    else process.env.RESPARQ_PROMO_GUARD_ENABLED = original;
  }
});

test('the predicate itself does not read the env — it stays pure', () => {
  const original = process.env.RESPARQ_PROMO_GUARD_ENABLED;
  try {
    // Same inputs, opposite flag states, identical answer. The gate lives at
    // the call site; if this ever diverges, every hand-computed assertion above
    // becomes dependent on ambient state.
    const input = { promoInCart: true, shopPromotion: null, isTestMode: false, isHybrid: false };
    delete process.env.RESPARQ_PROMO_GUARD_ENABLED;
    const off = hasPromoActive(input);
    process.env.RESPARQ_PROMO_GUARD_ENABLED = '1';
    const on = hasPromoActive(input);
    assert.equal(off, true);
    assert.equal(on, true);
  } finally {
    if (original === undefined) delete process.env.RESPARQ_PROMO_GUARD_ENABLED;
    else process.env.RESPARQ_PROMO_GUARD_ENABLED = original;
  }
});
