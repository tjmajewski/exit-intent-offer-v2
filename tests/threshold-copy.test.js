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

// The structural pins below scan for patterns that must not appear in CODE.
// The comments explaining why quote those very patterns, so strip them first —
// otherwise the documentation fails the test it is documenting.
const code = src.replace(/^\s*\/\/.*$/gm, '');

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

  test('a null threshold claims no condition at all', () => {
    // Two wrong answers were available here. `cartValue >= null` coerces to
    // `cartValue >= 0`, so the naive comparison called every non-empty cart
    // qualified and promised an unlocked discount. Clamping the remaining spend
    // instead produced `You're $0 away from $70 off`. Neither is true: there is
    // no condition to state, so state none.
    for (const threshold of [null, undefined]) {
      const r = resolveThresholdCopy({ type: 'threshold', threshold, amount: 70 }, 100, 'Generic', 'Copy', true);
      assert.equal(r.qualified, false, 'an unqualified cart was told it unlocked the discount');
      assert.equal(r.headline, 'Get $70 off your order');
      assert.doesNotMatch(r.headline, /away|unlocked|\$0/);
    }
  });
});

describe('both render paths go through the one helper', () => {
  test('no render path computes remaining spend inline any more', () => {
    // Deliberately loose. The first version of this test pinned the exact
    // expression `decision.threshold - cartValue` and passed while TWO more
    // copies sat in the file spelled differently — one with `defaultCartValue`,
    // one with `(decision.threshold || 0) - cartValue`, which is negative for
    // every non-empty cart when the threshold is null. Match any `Math.ceil`
    // over a subtraction divided by 5, and allow only the helper's own.
    const inline = [...code.matchAll(/Math\.ceil\([^;\n]*-[^;\n]*\/\s*5\s*\)\s*\*\s*5/g)];
    assert.equal(inline.length, 1,
      `expected only thresholdRemainingFor to compute remaining spend, found ${inline.length}: ` +
      inline.map(m => m[0]).join(' | '));
    assert.match(inline[0][0], /^Math\.ceil\(\(threshold - cartValue\)/,
      'the one remaining computation is not the helper\'s');
    // And it is inside the clamp.
    assert.match(code, /Math\.max\(0, Math\.ceil\(\(threshold - cartValue\) \/ 5\) \* 5\)/);
  });

  test('no render path decides "qualified" with its own comparison', () => {
    // `cartValue >= decision.threshold` coerces a null threshold to 0, so every
    // non-empty cart read as qualified. Three sites had it; one of them also
    // drove the primary CTA, so the button disagreed with the headline.
    const comparisons = [...code.matchAll(/>=\s*decision\.threshold/g)];
    assert.equal(comparisons.length, 1,
      `expected only resolveThresholdCopy to decide qualification, found ${comparisons.length} comparisons`);
    // And the one that remains is the helper's, standing behind the early
    // return that handles a null threshold — so it can never see one.
    assert.match(code, /if \(decision\.threshold == null\) \{/,
      'the helper no longer short-circuits on a null threshold');
    const guardAt = code.indexOf('if (decision.threshold == null) {');
    assert.ok(guardAt !== -1 && guardAt < code.indexOf('const qualified = cartValue >='),
      'the null-threshold guard no longer precedes the comparison');
  });

  test('the fallback path no longer tests for the reward instead of the requirement', () => {
    assert.doesNotMatch(code, /const mentionsOffer\s*=/,
      'the guard that never fired is back');
  });

  test('all four render paths call resolveThresholdCopy', () => {
    // updateModalWithAI variant + Pro-default, resolveModalContent variant +
    // Pro-default. Four, not two — the first sweep found two and the other two
    // were spelled differently enough to hide.
    const calls = code.match(/resolveThresholdCopy\(/g) || [];
    assert.equal(calls.length, 5,
      `expected 1 definition + 4 call sites, found ${calls.length} total`);
  });

  test('the Pro-default paths pass empty copy, so the helper always writes', () => {
    // No gene to preserve there — `statesCondition` must be false so the
    // sentence is generated rather than left blank.
    const r = resolveThresholdCopy({ type: 'threshold', threshold: 250, amount: 70 }, 100, '', '', false);
    assert.equal(r.changed, true);
    assert.equal(r.headline, "You're $150 away from $70 off");
    assert.ok(r.subhead, 'the Pro default path would render an empty subhead');
  });

  test('a null threshold on the Pro-default path renders neither a negative nor $0', () => {
    // The old line was `Math.ceil(((decision.threshold || 0) - cartValue) / 5) * 5`
    // with qualified false, so the negative branch was the one taken.
    const r = resolveThresholdCopy({ type: 'threshold', threshold: null, amount: 70 }, 100, '', '', false);
    assert.doesNotMatch(r.headline, /-\$|\$-|\$0/, `rendered ${r.headline}`);
    assert.equal(r.headline, 'Get $70 off your order');
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
