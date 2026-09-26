// The copy served when the engine meant to make an offer and could not.
//
// The bug this pins: the discount path in apps.exit-intent.api.ai-decision.jsx
// used to throw a 500 when Shopify's discount mutation failed, which silently
// removed the visitor from the intent-to-treat denominator. The fix degrades to
// a no-discount surface instead — but zeroing `decision.amount` without also
// replacing the variant's copy is worse than the 500 it replaced.
//
// The variant's genes are written for the offer that was supposed to exist, and
// the storefront interpolates {{amount}} as CURRENCY for anything that is not a
// percentage (exit-intent-modal.js):
//
//     '{{amount}}': decision.type === 'percentage'
//       ? decision.amount
//       : formatCurrency(decision.amount)
//
// So 'Take {{amount}}% off your order' with type flipped to 'no-discount' and
// amount 0 renders
//
//     Take $0% off your order
//
// above a CTA that redeems nothing. This file exists so that copy can never be
// reintroduced on the failure path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFER_UNDELIVERABLE_COPY,
  misdescribesOffer,
  genePools
} from '../app/utils/gene-pools.js';

const FIELDS = ['headline', 'subhead', 'cta'];
const OFFER_TYPES = ['percentage', 'fixed', 'threshold', 'no-discount'];

describe('OFFER_UNDELIVERABLE_COPY', () => {
  test('every field is present and non-empty', () => {
    for (const field of FIELDS) {
      assert.equal(typeof OFFER_UNDELIVERABLE_COPY[field], 'string');
      assert.ok(OFFER_UNDELIVERABLE_COPY[field].length > 0, `${field} is empty`);
    }
  });

  test('carries no {{placeholder}} the client would interpolate', () => {
    // The whole failure mode. A placeholder here is a number the client will
    // fill in from a decision that no longer has one.
    for (const field of FIELDS) {
      assert.doesNotMatch(
        OFFER_UNDELIVERABLE_COPY[field],
        /\{\{.*?\}\}/,
        `${field} carries a placeholder: ${OFFER_UNDELIVERABLE_COPY[field]}`
      );
    }
  });

  test('names no amount, so it cannot misdescribe any offer type', () => {
    for (const field of FIELDS) {
      for (const offerType of OFFER_TYPES) {
        assert.equal(
          misdescribesOffer(OFFER_UNDELIVERABLE_COPY[field], offerType),
          false,
          `${field} misdescribes a ${offerType} offer`
        );
      }
    }
  });

  test('promises nothing waiting at checkout', () => {
    // The generic-code branch says "Your discount is waiting at checkout",
    // which is true there — the merchant's code is still delivered. On this
    // path there is no code at all, so that sentence would be a lie.
    for (const field of FIELDS) {
      assert.doesNotMatch(
        OFFER_UNDELIVERABLE_COPY[field],
        /discount|% off|\$\d|coupon|promo|save \d/i,
        `${field} promises an offer that does not exist: ${OFFER_UNDELIVERABLE_COPY[field]}`
      );
    }
  });

  test('trips no archetype banned-claim pattern', () => {
    // Belt and braces: the fallback is served under whatever archetype the
    // decision started as, so it has to be clean against all of them.
    for (const [baseline, pool] of Object.entries(genePools)) {
      for (const re of pool.copyBannedPatterns || []) {
        for (const field of FIELDS) {
          assert.doesNotMatch(
            OFFER_UNDELIVERABLE_COPY[field],
            re,
            `${field} trips ${baseline}'s banned pattern ${re}`
          );
        }
      }
    }
  });

  test('is frozen, so a caller cannot mutate the shared fallback', () => {
    assert.ok(Object.isFrozen(OFFER_UNDELIVERABLE_COPY));
  });
});
