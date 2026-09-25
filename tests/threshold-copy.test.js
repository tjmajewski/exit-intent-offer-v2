// A threshold offer's copy, on both render paths.
//
// The bug this pins: `Math.ceil((threshold - cartValue) / 5) * 5` goes NEGATIVE
// once a cart already qualifies, and that value interpolates into any gene
// carrying `{{threshold_remaining}}`. A shopper $100 past a $250 threshold read
//
//     You're just $-100 away from $70 off
//
// `resolveModalContent` had grown a correct `qualified` branch. The fallback
// path `updateModalWithAI` — taken whenever the template registry is missing or
// `?resparqLiveAI=0` is set — had an older guard that asked whether the headline
// mentioned the OFFER ('off'/'save'/'away'/'unlock'). Every threshold headline
// does, so it always declined to act and the negative rendered.
//
// Two copies of one rule is what let one be fixed and the other not, so the
// rule lives in `resolveThresholdCopy` now and both paths call it. These tests
// execute the real helper source rather than asserting on a regex, so a future
// divergence fails here instead of on a shopper's screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../extensions/exit-intent-modal/assets/exit-intent-modal.js', import.meta.url), 'utf8');

// Lift the two helpers out of the asset's IIFE and run them for real, against a
// formatCurrency matching the asset's own (USD, no decimals).
function loadHelpers() {
  const grab = (name) => {
    const start = src.indexOf(`  function ${name}(`);
    assert.notEqual(start, -1, `${name} is gone from the extension asset`);
    const end = src.indexOf('\n  }\n', start);
    assert.notEqual(end, -1, `could not find the end of ${name}`);
    return src.slice(start, end + 4);
  };
  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
  const factory = new Function('formatCurrency', `
    ${grab('thresholdRemainingFor')}
    ${grab('resolveThresholdCopy')}
    return { thresholdRemainingFor, resolveThresholdCopy };
  `);
  return factory(formatCurrency);
}

const { thresholdRemainingFor, resolveThresholdCopy } = loadHelpers();

describe('remaining spend never goes negative', () => {
  test('a qualified cart has nothing left to spend, not a negative amount', () => {
    // The exact shape of the reported bug.
    assert.equal(thresholdRemainingFor(250, 350), 0);
  });

  test('an exactly-qualifying cart is zero, not five', () => {
    assert.equal(thresholdRemainingFor(250, 250), 0);
  });

  test('an unqualified cart still rounds UP, so the ask is never understated', () => {
    // $18 short must read $20, never $15 — understating it means a shopper
    // adds what we asked for and still does not qualify.
    assert.equal(thresholdRemainingFor(250, 232), 20);
    assert.equal(thresholdRemainingFor(250, 249), 5);
  });

  test('a missing threshold is zero, not NaN', () => {
    assert.equal(thresholdRemainingFor(null, 100), 0);
    assert.equal(thresholdRemainingFor(undefined, 100), 0);
  });
});

describe('threshold copy states the condition', () => {
  const decision = { type: 'threshold', threshold: 250, amount: 70 };

  test('a qualified cart is never told it is $-100 away', () => {
    const r = resolveThresholdCopy(decision, 350, "You're just $-100 away from $70 off", 'Add more', true);
    assert.equal(r.qualified, true);
    assert.equal(r.changed, true);
    assert.equal(r.headline, 'You unlocked $70 off!');
    assert.doesNotMatch(r.headline, /-/);
    assert.doesNotMatch(r.subhead, /-/);
  });

  test('the old guard would have passed this copy through — the new one does not', () => {
    // Regression pin on the actual defect. `mentionsOffer` tested for
    // off/save/away/unlock; this headline has three of the four.
    const headline = "You're just $-100 away from $70 off";
    const mentionsOffer = ['off', 'save', 'away', 'unlock'].some(w => headline.toLowerCase().includes(w));
    assert.equal(mentionsOffer, true, 'the premise of the old bug no longer holds');
    assert.equal(resolveThresholdCopy(decision, 350, headline, 'Add more', true).changed, true);
  });

  test('a cart one dollar short is still given the goal, not the unlock', () => {
    const r = resolveThresholdCopy(decision, 249, "Don't Leave Empty-Handed!", 'Come back', true);
    assert.equal(r.qualified, false);
    assert.equal(r.headline, "You're $5 away from $70 off");
  });

  test('copy that already names the remaining spend is left alone', () => {
    const headline = 'Spend $20 more and save $70';
    const r = resolveThresholdCopy(decision, 232, headline, 'Nearly there', true);
    assert.equal(r.changed, false);
    assert.equal(r.headline, headline, 'evolved copy lost its edge for no reason');
  });

  test('copy that names the threshold itself counts as stating the condition', () => {
    const headline = 'Orders over $250 get $70 off';
    assert.equal(resolveThresholdCopy(decision, 100, headline, '', false).changed, false);
  });

  test('a generic headline is replaced — a reward with no requirement is not honest', () => {
    const r = resolveThresholdCopy(decision, 100, 'Flash sale — $70 off, today only', 'Hurry', true);
    assert.equal(r.changed, true);
    assert.equal(r.headline, "You're $150 away from $70 off");
  });

  test('a hidden subhead cannot satisfy the condition on the headline\'s behalf', () => {
    // showSubhead false means the shopper never reads it, so it cannot be
    // where the requirement is stated.
    const r = resolveThresholdCopy(decision, 232, 'Big savings inside', 'Spend $20 more', false);
    assert.equal(r.changed, true);
    const visible = resolveThresholdCopy(decision, 232, 'Big savings inside', 'Spend $20 more', true);
    assert.equal(visible.changed, false);
  });

  test('a null threshold does not declare a non-empty cart qualified', () => {
    // `cartValue >= null` coerces to `cartValue >= 0` — true for every cart.
    const r = resolveThresholdCopy({ type: 'threshold', threshold: null, amount: 70 }, 100, 'Generic', 'Copy', true);
    assert.equal(r.qualified, false);
  });
});

describe('both render paths go through the one helper', () => {
  test('neither path computes remaining spend inline any more', () => {
    const inline = src.match(/Math\.ceil\(\(\s*decision\.threshold - cartValue\s*\)\s*\/\s*5\s*\)\s*\*\s*5/g);
    assert.equal(inline, null,
      'a render path is computing remaining spend itself again — it will go negative');
  });

  test('the fallback path no longer tests for the reward instead of the requirement', () => {
    assert.doesNotMatch(src, /const mentionsOffer\s*=/,
      'the guard that never fired is back');
  });

  test('updateModalWithAI and resolveModalContent both call resolveThresholdCopy', () => {
    const calls = src.match(/resolveThresholdCopy\(/g) || [];
    // One definition + two call sites.
    assert.ok(calls.length >= 3,
      `expected both render paths to call the helper, found ${calls.length - 1} call site(s)`);
  });
});

describe('enrich-signals refuses an error envelope', () => {
  test('the success path checks response.ok before trusting the body', () => {
    // A 429 body is valid JSON. Returned unchecked it became the signals
    // payload — truthy, so ai-decision accepted it and decided on cartValue 0.
    const fn = src.slice(src.indexOf('async enrichSignals'), src.indexOf('async getEnterpriseDecision'));
    assert.match(fn, /if \(!response\.ok\)/, 'enrich-signals trusts a non-200 body again');
    assert.match(fn, /return basicSignals/, 'no fallback to basic signals on a bad response');
    assert.doesNotMatch(fn, /^\s*return await response\.json\(\);/m,
      'the unchecked return is back');
  });

  test('a 200 carrying an error envelope is rejected too', () => {
    const fn = src.slice(src.indexOf('async enrichSignals'), src.indexOf('async getEnterpriseDecision'));
    assert.match(fn, /enriched\.error/, 'a 200 error envelope would still pass as signals');
  });
});
