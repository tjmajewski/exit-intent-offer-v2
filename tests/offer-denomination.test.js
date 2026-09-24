// The unit around {{amount}}, and the unit the shopper is shown.
//
// `{{amount}}` carries a number and no unit. The storefront decides the unit
// from decision.type — bare for `percentage`, currency for `fixed` and
// `threshold` — and the copy template supplies the rest of the sentence. So
// "Take {{amount}}% off" is only correct against a percentage decision, and
// against a fixed one it renders `Take $17% off your order`.
//
// That reached real shoppers on exit-intent-test-2. Guided mode let the
// merchant pin the offer TYPE and then pinned the copy pool to a constant, so
// a merchant who pinned dollars got the percent pool. Nothing caught it: the
// copy is genuinely in a real pool, it passes brand safety, it is grammatical,
// and the console mirrors the storefront faithfully — so every surface agreed
// on a sentence that named a discount no store offers.
//
// Two things are pinned here. The pools have to be internally coherent, and
// the one path that picks a type before it picks a pool has to follow it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { genePools, amountDenomination, misdescribesOffer } from '../app/utils/gene-pools.js';
import { offerTypeForBaseline, poolForOfferType } from '../app/utils/baseline-selector.js';

const COPY_FIELDS = [
  'headlines', 'headlinesWithUrgency',
  'subheads', 'subheadsWithUrgency',
  'ctas',
];

describe('reading the unit off a template', () => {
  test('a percent template and a currency template are told apart', () => {
    assert.equal(amountDenomination('Take {{amount}}% off your order'), 'percent');
    assert.equal(amountDenomination('Take {{amount}} off your order'), 'currency');
  });

  test('copy that names no amount belongs to no denomination', () => {
    assert.equal(amountDenomination('Apply My Discount'), null);
    assert.equal(amountDenomination('Applied automatically at checkout'), null);
    // ...and is therefore valid against every offer type.
    for (const type of ['percentage', 'fixed', 'threshold', 'no-discount']) {
      assert.equal(misdescribesOffer('Apply My Discount', type), false);
    }
  });

  test('whitespace between the token and the percent sign still reads as percent', () => {
    assert.equal(amountDenomination('Save {{amount}} % today'), 'percent');
  });

  test('the percent sign the model reaches for, not just the ASCII one', () => {
    // Generated and meta-learning copy is model-written. Reading either of
    // these as currency would swap out a CORRECT percentage headline — the
    // guard misfiring on good copy, which is worse than not guarding.
    assert.equal(amountDenomination('Take {{amount}}\uFF05 off'), 'percent');
    assert.equal(amountDenomination('Take {{amount}} percent off'), 'percent');
    assert.equal(misdescribesOffer('Take {{amount}} percent off', 'percentage'), false);
    assert.equal(misdescribesOffer('Take {{amount}}\uFF05 off', 'fixed'), true);
  });

  test('a percent sign that belongs to something else is not the amount', () => {
    // The unit has to be attached to the token, not merely present in the line.
    assert.equal(amountDenomination('100% natural, {{amount}} off'), 'currency');
  });

  test('a different token that merely starts with amount is not the amount', () => {
    assert.equal(amountDenomination('{{amount_total}} off'), null);
  });

  test('a template that mixes units is wrong against everything', () => {
    assert.equal(amountDenomination('Save {{amount}}% or {{amount}} off'), 'mixed');
    assert.equal(misdescribesOffer('Save {{amount}}% or {{amount}} off', 'percentage'), true);
    assert.equal(misdescribesOffer('Save {{amount}}% or {{amount}} off', 'fixed'), true);
  });

  test('the exact sentence that shipped is rejected against a fixed offer', () => {
    assert.equal(misdescribesOffer('Take {{amount}}% off your order', 'fixed'), true);
    assert.equal(misdescribesOffer('Take {{amount}}% off your order', 'percentage'), false);
  });

  test('currency copy is rejected against a percentage offer too', () => {
    // Renders "Take 17 off your order" — less alarming than "$17%", equally wrong.
    assert.equal(misdescribesOffer('Take {{amount}} off your order', 'percentage'), true);
  });

  test('threshold copy is currency-denominated, like fixed', () => {
    assert.equal(misdescribesOffer('Spend {{threshold_remaining}} more and save {{amount}}', 'threshold'), false);
    assert.equal(misdescribesOffer('Spend {{threshold_remaining}} more and save {{amount}}%', 'threshold'), true);
  });

  test('a non-string is not a mismatch', () => {
    for (const value of [null, undefined, 42, {}]) {
      assert.equal(amountDenomination(value), null);
      assert.equal(misdescribesOffer(value, 'fixed'), false);
    }
  });
});

describe('every pool is denominated for the offer it serves', () => {
  for (const [baseline, pool] of Object.entries(genePools)) {
    const offerType = offerTypeForBaseline(baseline);

    test(`${baseline} (${offerType})`, () => {
      for (const field of COPY_FIELDS) {
        for (const line of pool[field] || []) {
          assert.equal(
            misdescribesOffer(line, offerType),
            false,
            `${baseline}.${field}: "${line}" is denominated for a different offer type than ${offerType}`,
          );
        }
      }
    });
  }

  test('a no-discount pool names no amount at all', () => {
    for (const [baseline, pool] of Object.entries(genePools)) {
      if (offerTypeForBaseline(baseline) !== 'no-discount') continue;
      for (const field of COPY_FIELDS) {
        for (const line of pool[field] || []) {
          assert.equal(
            amountDenomination(line), null,
            `${baseline}.${field}: "${line}" names an amount, but this pool serves no discount`,
          );
        }
      }
    }
  });
});

describe('Guided mode picks the pool its pin is denominated in', () => {
  test('a pinned type maps to a pool that serves exactly that type', () => {
    for (const type of ['percentage', 'fixed']) {
      assert.equal(offerTypeForBaseline(poolForOfferType(type)), type);
    }
  });

  test('an unset type falls to percentage, matching the settings form', () => {
    assert.equal(offerTypeForBaseline(poolForOfferType(undefined)), 'percentage');
  });

  test('the decision endpoint routes the Guided pin through that mapping', () => {
    // A regression guard on the literal that caused this. The old line was
    // `baseline = hybridOfferAmount > 0 ? 'conversion_with_discount' : ...`,
    // which ignored the pinned type entirely.
    const src = readFileSync(
      new URL('../app/routes/apps.exit-intent.api.ai-decision.jsx', import.meta.url), 'utf8');
    assert.match(src, /poolForOfferType\(hybridOfferType\)/,
      'Guided mode no longer derives its copy pool from the pinned offer type');
    assert.doesNotMatch(src, /hybridOfferAmount > 0\s*\?\s*'conversion_with_discount'/,
      'Guided mode pins a constant copy pool regardless of the pinned offer type');
  });

  test('the served decision type and the copy guards read the same variable', () => {
    const src = readFileSync(
      new URL('../app/routes/apps.exit-intent.api.ai-decision.jsx', import.meta.url), 'utf8');
    // If the guards check one value and the payload carries another, the guard
    // is decorative — which is how this shipped in the first place.
    assert.match(src, /type: decisionOfferType,/);
    assert.match(src, /misdescribesOffer\(effectiveHeadline, decisionOfferType\)/);
    assert.match(src, /misdescribesOffer\(effectiveCta, decisionOfferType\)/);
    assert.match(src, /misdescribesOffer\(selectedVariant\.subhead, decisionOfferType\)/);
  });
});
