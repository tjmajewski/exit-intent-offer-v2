// The bug that stopped every discount for the first paying merchant.
//
// Shopify rejects appliesOnSubscription / appliesOnOneTimePurchase /
// recurringCycleLimit on a store that does not sell subscriptions. Every create
// site sent all three unconditionally, so every mint threw, the decision
// endpoint 500ed, and no discount modal ever rendered. Confirmed against the
// live shop on 2026-09-21; DiscountOffer had been empty since install.
//
// Expected values below are hand-computed from that rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySubscriptionFields,
  isSubscriptionFieldRejection,
  SUBSCRIPTION_RECURRING_CYCLE_LIMIT
} from '../app/utils/discount-subscription-fields.js';

// A create input shaped like the real ones, WITHOUT subscription fields.
const baseInput = () => ({
  title: '20% Off - Exit Intent (24h)',
  code: 'EXIT20-ABC123',
  customerSelection: { all: true },
  combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
  customerGets: { value: { percentage: 0.2 }, items: { all: true } },
  appliesOncePerCustomer: true,
  usageLimit: 1
});

// ------------------------------------------------- applySubscriptionFields

test('a non-subscription store gets NONE of the three fields', () => {
  // This is the fix. All three of these keys present is what Shopify rejected.
  const out = applySubscriptionFields(baseInput(), false);
  assert.equal('appliesOnSubscription' in out.customerGets, false);
  assert.equal('appliesOnOneTimePurchase' in out.customerGets, false);
  assert.equal('recurringCycleLimit' in out, false);
});

test('a subscription store gets all three', () => {
  const out = applySubscriptionFields(baseInput(), true);
  assert.equal(out.customerGets.appliesOnSubscription, true);
  assert.equal(out.customerGets.appliesOnOneTimePurchase, true);
  assert.equal(out.recurringCycleLimit, SUBSCRIPTION_RECURRING_CYCLE_LIMIT);
  assert.equal(SUBSCRIPTION_RECURRING_CYCLE_LIMIT, 1); // first billing cycle only
});

test('everything else in the input is preserved untouched', () => {
  const input = baseInput();
  const out = applySubscriptionFields(input, false);
  assert.equal(out.title, '20% Off - Exit Intent (24h)');
  assert.equal(out.code, 'EXIT20-ABC123');
  assert.equal(out.usageLimit, 1);
  assert.equal(out.appliesOncePerCustomer, true);
  assert.deepEqual(out.customerSelection, { all: true });
  assert.deepEqual(out.combinesWith, {
    orderDiscounts: true, productDiscounts: true, shippingDiscounts: true
  });
  // The parts of customerGets that are not subscription fields survive.
  assert.deepEqual(out.customerGets.value, { percentage: 0.2 });
  assert.deepEqual(out.customerGets.items, { all: true });
});

test('the caller’s input is never mutated — the retry depends on it', () => {
  // submitBasicCodeDiscount calls this twice with the SAME literal: once with
  // subscriptions, then again without. If the first call mutated the input, the
  // retry would still carry the rejected fields and fail identically.
  const input = baseInput();
  const withSubs = applySubscriptionFields(input, true);
  assert.equal(withSubs.customerGets.appliesOnSubscription, true);

  assert.equal('appliesOnSubscription' in input.customerGets, false,
    'first call leaked into the caller’s object');
  assert.equal('recurringCycleLimit' in input, false);

  const retry = applySubscriptionFields(input, false);
  assert.equal('appliesOnSubscription' in retry.customerGets, false);
  assert.equal('recurringCycleLimit' in retry, false);
});

test('stripping is idempotent and removes fields already present', () => {
  // Defensive: if a caller ever hands over an input that already carries them.
  const dirty = baseInput();
  dirty.customerGets.appliesOnSubscription = true;
  dirty.customerGets.appliesOnOneTimePurchase = true;
  dirty.recurringCycleLimit = 1;

  const out = applySubscriptionFields(dirty, false);
  assert.equal('appliesOnSubscription' in out.customerGets, false);
  assert.equal('appliesOnOneTimePurchase' in out.customerGets, false);
  assert.equal('recurringCycleLimit' in out, false);
});

test('an input with no customerGets does not throw', () => {
  const out = applySubscriptionFields({ code: 'X' }, true);
  assert.equal(out.customerGets.appliesOnSubscription, true);
  const off = applySubscriptionFields({ code: 'X' }, false);
  assert.deepEqual(off.customerGets, {});
});

// --------------------------------------------- isSubscriptionFieldRejection

test('the three real userErrors Shopify returned are detected', () => {
  // Copied verbatim from the live probe against 568e5d-75.myshopify.com.
  const userErrors = [
    { field: ['basicCodeDiscount', 'customerGets', 'appliesOnSubscription'],
      message: 'applies_on_subscription field is not permitted without the shop using subscriptions.' },
    { field: ['basicCodeDiscount', 'customerGets', 'appliesOnOneTimePurchase'],
      message: 'applies_on_one_time_purchase field is not permitted without the shop using subscriptions.' },
    { field: ['basicCodeDiscount', 'recurringCycleLimit'],
      message: 'recurring_cycle_limit field is not permitted without the shop using subscriptions.' }
  ];
  assert.equal(isSubscriptionFieldRejection(userErrors), true);
});

test('any ONE of the three is enough to trigger the retry', () => {
  assert.equal(isSubscriptionFieldRejection([
    { field: ['basicCodeDiscount', 'recurringCycleLimit'], message: 'nope' }
  ]), true);
});

test('an unrelated error does NOT trigger the retry', () => {
  // Retrying without subscription fields would not help here, and swallowing a
  // real error as a subscription problem would hide it.
  assert.equal(isSubscriptionFieldRejection([
    { field: ['basicCodeDiscount', 'code'], message: 'Code must be unique.' }
  ]), false);
});

test('no errors means no rejection', () => {
  assert.equal(isSubscriptionFieldRejection([]), false);
  assert.equal(isSubscriptionFieldRejection(null), false);
  assert.equal(isSubscriptionFieldRejection(undefined), false);
  assert.equal(isSubscriptionFieldRejection('not an array'), false);
});

test('detected from the message alone when the field path is missing', () => {
  // The field path is what we match on, but Shopify has been known to return
  // errors without one.
  assert.equal(isSubscriptionFieldRejection([
    { message: 'applies_on_subscription field is not permitted without the shop using subscriptions.' }
  ]), true);
});

test('a malformed error entry does not throw', () => {
  assert.equal(isSubscriptionFieldRejection([null, undefined, {}, { field: null }]), false);
});
