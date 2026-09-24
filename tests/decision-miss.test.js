// Why a decision never reached a screen.
//
// Two halves have to agree and are wired together only at runtime: the
// storefront beacons a reason string as the page dies, and the console turns
// that string into a sentence. A reason the console does not know renders as
// a slug; a reason the endpoint does not know is dropped on the floor. So the
// vocabulary is pinned here, in one place all three read.
//
// The mobile exit triggers are pinned too. They exist because an exit_intent
// gene on a phone had no way to fire: mouseout does not happen, and the idle
// timer it fell back to resets on every scroll and touch. If the triggers are
// ever unwired, the failure is silent — decisions keep being minted and simply
// never show — which is exactly the failure these tests are here to catch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeMiss, summarizeDecision, resultKind, foldOutcomeRows } from '../app/components/admin/decision-summary.js';

const modal = readFileSync(
  new URL('../extensions/exit-intent-modal/assets/exit-intent-modal.js', import.meta.url), 'utf8');
const endpoint = readFileSync(
  new URL('../app/routes/apps.exit-intent.api.decision-miss.jsx', import.meta.url), 'utf8');

const REASONS = ['trigger_never_fired', 'competing_popup_dropped', 'left_before_idle', 'left_before_dwell'];

describe('miss reasons — one vocabulary, three readers', () => {
  test('every reason the endpoint accepts, the console can name', () => {
    for (const reason of REASONS) {
      assert.ok(endpoint.includes(`"${reason}"`), `endpoint does not accept ${reason}`);
      const described = describeMiss(reason);
      assert.ok(described && described.label, `console cannot name ${reason}`);
      assert.ok(described.detail, `${reason} has no explanation for an operator`);
      assert.ok(!described.label.includes('_'), `${reason} renders as a raw slug`);
    }
  });

  test('every reason the storefront can send, the endpoint accepts', () => {
    // The beacon picks from a literal set; anything else would be rejected
    // server-side and the miss lost.
    const sent = [...modal.matchAll(/missReason = '([a-z_]+)'/g)].map((m) => m[1]);
    const fallbacks = [...modal.matchAll(/\? '([a-z_]+)'\s*:\s*'([a-z_]+)'/g)]
      .flatMap((m) => [m[1], m[2]])
      .filter((value) => REASONS.includes(value));
    for (const reason of [...sent, ...fallbacks]) {
      assert.ok(REASONS.includes(reason), `storefront sends ${reason}, which nothing accepts`);
    }
    assert.ok(sent.length > 0, 'no reason is ever assigned in the storefront');
  });

  test('an unrecognised reason degrades to a readable slug, never a crash', () => {
    assert.equal(describeMiss('something_new').label, 'something new');
    assert.equal(describeMiss(null), null);
    assert.equal(describeMiss(undefined), null);
  });
});

describe('the console reads a miss off the outcome row', () => {
  const row = (result) => ({
    id: 'd1',
    createdAt: '2026-09-24T18:00:00Z',
    decision: JSON.stringify({ type: 'percentage', amount: 12, headline: 'Wait, {{amount}}% off' }),
    signals: JSON.stringify({ cartValue: 412, deviceType: 'mobile', propensityScore: 38 }),
    result,
  });

  test('a never-rendered row carries its reason as a sentence', () => {
    const notRendered = { wasShown: true, rendered: false, converted: false, missReason: 'left_before_idle' };
    const summary = summarizeDecision(row(notRendered));
    assert.equal(resultKind(summary.result, summary.source), 'not_rendered');
    assert.equal(summary.facts.miss.label, 'left before idle');
    assert.match(summary.facts.miss.detail, /resets on every scroll/);
  });

  test('no recorded reason is absence, not a cause', () => {
    // A dropped beacon and a storefront script cached from before the beacon
    // shipped both land here. Inventing a cause for them would turn a gap in
    // instrumentation into a finding.
    const summary = summarizeDecision(row({ wasShown: true, rendered: false, converted: false, missReason: null }));
    assert.equal(summary.facts.miss, null);
  });

  test('a rendered row showing a stale reason is the case that matters', () => {
    // missReason: null here would make this pass no matter what the fold does.
    // The real risk is a rendered row that still carries a beaconed reason.
    const summary = summarizeDecision(row({ wasShown: true, rendered: true, converted: false, missReason: 'left_before_idle' }));
    assert.equal(resultKind(summary.result, summary.source), 'shown');
    // summarizeDecision reports what the row says; foldOutcomeRows is what
    // guarantees a rendered row never reaches it carrying a reason.
    const folded = foldOutcomeRows([
      { aiDecisionId: 'd', wasShown: true, rendered: true, converted: false, missReason: null },
      { aiDecisionId: 'd', wasShown: true, rendered: false, converted: false, missReason: 'left_before_idle' },
    ]);
    assert.equal(folded.get('d').rendered, true);
    assert.equal(folded.get('d').missReason, null, 'a rendered decision kept a miss reason');
  });

  test('an order attributed to a modal that never displayed is not a success', () => {
    // recordInterventionConversion can attribute with proveRender:false, so a
    // decision whose surface never rendered can still convert. Calling that
    // "Converted" put a success badge on a row that also carried the reason it
    // was never seen.
    const summary = summarizeDecision(row({ wasShown: true, rendered: false, converted: true, missReason: 'left_before_dwell', revenue: 80 }));
    assert.equal(resultKind(summary.result, summary.source), 'bought_anyway');
  });

  test('a decision logged before JSON still answers every column', () => {
    const summary = summarizeDecision({ id: 'x', createdAt: '2026-09-24T18:00:00Z', decision: 'show_variant', signals: '{}' });
    // One unparseable row must not take the table down with it.
    for (const key of ['miss', 'origin', 'promoCode', 'propensity', 'cartValue', 'device']) {
      assert.ok(key in summary.facts, `legacy row is missing facts.${key}`);
    }
  });
});

describe('mobile can actually fire an exit-intent gene', () => {
  test('the two signals a phone can honestly give are wired', () => {
    assert.ok(/setupDwellTrigger\(seconds, show/.test(modal), 'no dwell trigger');
    assert.ok(/setupTabReturnTrigger\(show/.test(modal), 'no tab-return trigger');
  });

  test('dwell does not listen to interaction', () => {
    // The whole point. setupIdleTrigger resets on scroll and touchmove, which
    // is why an exit_intent gene could not fire on a phone; if dwell ever
    // grows the same listeners it silently becomes another idle timer.
    // Bounded at setupIdleTrigger — which legitimately listens to all of
    // these, and would make this assertion pass or fail on the wrong function.
    const fn = modal.slice(modal.indexOf('setupDwellTrigger(seconds'), modal.indexOf("setupIdleTrigger(seconds, label"));
    for (const event of ['scroll', 'touchmove', 'touchstart', 'mousemove', 'keydown']) {
      assert.ok(!fn.includes(`'${event}'`), `dwell resets on ${event}, which makes it an idle timer`);
    }
  });

  test('the two signals that guessed at intent are gone', () => {
    // popstate fires on same-document history only, so it missed every real
    // exit and fired on theme filter navigation. The scroll flick's 240px/300ms
    // is 800 px/s, which an ordinary swipe and iOS momentum both clear.
    assert.ok(!/addEventListener\('popstate'/.test(modal), 'popstate trigger is back');
    assert.ok(!/FLICK_PX/.test(modal), 'scroll-flick trigger is back');
  });

  test('both AI tiers arm them for a gene that asked for exit intent', () => {
    assert.ok(modal.match(/setupDwellTrigger\(/g).length >= 4, 'dwell is not armed everywhere');
    assert.ok(modal.match(/setupTabReturnTrigger\(/g).length >= 4, 'tab return is not armed everywhere');
    assert.ok(
      /isMobile && \(triggerType === 'exit_intent' \|\| triggerType === 'exit_intent_or_idle'\)/.test(modal),
      'mobile triggers are not gated on an exit-intent gene'
    );
  });

  test('nothing renders the modal to a hidden tab', () => {
    // Showing while document.hidden would book an impression nobody saw.
    const fn = modal.slice(modal.indexOf('setupTabReturnTrigger(show'), modal.indexOf('setupDwellTrigger(seconds'));
    const hiddenBranch = fn.slice(fn.indexOf('if (document.hidden)'), fn.indexOf('const away'));
    assert.ok(!/show\(\)/.test(hiddenBranch), 'a modal can be shown while the tab is hidden');
  });

  test('a returning visitor has to have actually been away', () => {
    // Three seconds caught the notification shade and the app switcher.
    const ms = Number(modal.match(/RETURN_AFTER_MS = (\d+)/)[1]);
    assert.ok(ms >= 10000, `tab-return fires after only ${ms}ms away`);
  });
});

describe('one show per show', () => {
  test('showModal holds a latch across its own awaits', () => {
    // modalShown is not set until the bottom of the method, after an await on
    // a /cart.js fetch. A trigger that fires twice inside that window ran the
    // whole show twice: two stampModalShown() calls burning the 30-day
    // frequency ceiling for one show, and two variant impressions inflating
    // the bandit's denominator.
    const entry = modal.slice(modal.indexOf('async showModal()'), modal.indexOf('async showModalInner()'));
    assert.match(entry, /if \(this\.showInFlight\) return;/);
    assert.match(entry, /this\.showInFlight = true;/);
    assert.match(entry, /finally\s*\{\s*this\.showInFlight = false;/);
  });
});

describe('render is terminal', () => {
  test('confirming a render clears any reason already beaconed', () => {
    // The two race: a backgrounded tab beacons a miss, then the visitor comes
    // back and the mobile trigger shows the modal. Without the clear, the row
    // claims both that it rendered and that it never did.
    const confirm = readFileSync(
      new URL('../app/utils/intervention-threshold.server.js', import.meta.url), 'utf8');
    const fn = confirm.slice(confirm.indexOf('export async function confirmInterventionRender'));
    assert.match(fn.slice(0, 1200), /data:\s*\{\s*rendered:\s*true,\s*missReason:\s*null\s*\}/);
  });

  test('the endpoint refuses to mark a rendered row as missed', () => {
    const start = endpoint.indexOf('updateMany');
    const stop = endpoint.indexOf('data: { missReason');
    assert.ok(start !== -1 && stop > start, 'the endpoint no longer has the query this pins');
    const where = endpoint.slice(start, stop);
    assert.ok(/rendered:\s*false/.test(where), 'a rendered row can still be given a miss reason');
    // Deliberately NOT first-writer-wins: the client beacons as soon as the
    // tab is backgrounded, so freezing the first reason froze a five-second
    // glance at a notification over a cause found forty seconds later.
    assert.ok(!/missReason:\s*null/.test(where), 'the endpoint is back to first-writer-wins');
  });
});

describe('the console does not repeat a claim a shopper could have made', () => {
  const summarize = (signals, decision = { type: 'percentage', amount: 10 }) =>
    summarizeDecision({
      id: 'o', createdAt: '2026-09-24T18:00:00Z',
      decision: JSON.stringify(decision), signals: JSON.stringify(signals),
    });

  test('a client cannot claim a server-side origin', () => {
    // `signals` is verbatim client JSON. A crafted requestReason of
    // "cart_webhook" rendered a live visitor's row as "no visitor was on the
    // page" — the console asserting the one thing it exists to get right.
    const spoofed = summarize({ requestReason: 'cart_webhook' });
    const real = summarize({}, { type: 'percentage', amount: 10, source: 'cart_webhook' });
    assert.notEqual(spoofed.facts.origin.label, real.facts.origin.label);
    assert.equal(spoofed.facts.origin.detail, null, 'a spoofed origin carries an authoritative explanation');
    assert.match(real.facts.origin.detail, /server-side/);
  });

  test('a server source outranks whatever the signals say', () => {
    const row = summarize({ requestReason: 'add_to_cart' }, { type: 'percentage', amount: 10, source: 'idle_cart_pickup' });
    assert.equal(row.facts.origin.label, 'idle sweep');
  });

  test('an unknown origin is shown but bounded', () => {
    // A new reason should surface rather than vanish, but it is untrusted text
    // in a table cell whose width every other row pays for.
    const row = summarize({ requestReason: 'x'.repeat(400) });
    assert.ok(row.facts.origin.label.length <= 24, 'an unbounded string reaches the Origin column');
  });

  test('no recorded origin renders as nothing, not a guess', () => {
    assert.equal(summarize({}).facts.origin, null);
  });
});

describe('zero is an answer, unknown is not', () => {
  const facts = (signals, decision = { type: 'percentage', amount: 10 }) =>
    summarizeDecision({
      id: 'z', createdAt: '2026-09-24T18:00:00Z',
      decision: JSON.stringify(decision), signals: JSON.stringify(signals),
    }).facts;

  test('an unrecorded cart is not a $0 cart', () => {
    // Number(null) and Number("") are both 0, and `??` does not help because
    // both writers store an explicit null rather than undefined.
    assert.equal(facts({ cartValue: null }, { type: 'percentage', amount: 5, cartValue: null }).cartValue, null);
    assert.equal(facts({ cartValue: '' }, { type: 'percentage', amount: 5, cartValue: '' }).cartValue, null);
    assert.equal(facts({ cartValue: 'nonsense' }).cartValue, null);
    assert.equal(facts({ cartValue: 0 }).cartValue, 0, 'a genuinely empty cart stopped being reportable');
    assert.equal(facts({ cartValue: 412.5 }).cartValue, 412.5);
  });

  test('a visitor who has never been shown one is not a visitor we know nothing about', () => {
    assert.equal(facts({ modalShowCount: 0 }).showCount, 0);
    assert.equal(facts({}).showCount, null);
    assert.equal(facts({ propensityScore: 0 }).propensity, 0);
    assert.equal(facts({}).propensity, null);
  });

  test('a zero-amount decision names no offer', () => {
    assert.equal(facts({}, { type: 'percentage', amount: 0 }).offerLabel, null);
    assert.equal(facts({}, { type: 'percentage', amount: 20 }).offerLabel, '20%');
    assert.equal(facts({}, { type: 'fixed', amount: 8 }).offerLabel, '$8');
    // A threshold offer that lost its threshold must not print "over undefined".
    assert.equal(facts({}, { type: 'threshold', amount: 10, threshold: null }).offerLabel, '$10');
    assert.equal(facts({}, { type: 'threshold', amount: 10, threshold: 75 }).offerLabel, '$10 over $75');
    assert.equal(facts({}, { type: 'percentage', amount: 'broken' }).offerLabel, null);
  });
});

describe('folding the outcome rows a decision owns', () => {
  const fold = (rows, clicked = new Map()) => foldOutcomeRows(rows, clicked).get('d');

  test('collapses to the furthest the visitor got', () => {
    const folded = fold([
      { aiDecisionId: 'd', wasShown: true, rendered: false, converted: false, revenue: 0, profit: 0 },
      { aiDecisionId: 'd', wasShown: true, rendered: true, converted: true, revenue: 80, profit: 60 },
    ]);
    assert.equal(folded.rendered, true);
    assert.equal(folded.converted, true);
    assert.equal(folded.revenue, 80);
  });

  test('a holdout stays a holdout however many rows it owns', () => {
    // A holdout that converts gets a second row from the order webhook.
    const folded = fold([
      { aiDecisionId: 'd', wasShown: false, rendered: true, isHoldout: true, converted: false },
      { aiDecisionId: 'd', wasShown: false, rendered: true, isHoldout: false, converted: true, revenue: 50 },
    ]);
    assert.equal(folded.isHoldout, true);
    assert.equal(folded.converted, true);
  });

  test('a null reason never blanks a recorded one', () => {
    const folded = fold([
      { aiDecisionId: 'd', wasShown: true, rendered: false, converted: false, missReason: 'left_before_dwell' },
      { aiDecisionId: 'd', wasShown: true, rendered: false, converted: false, missReason: null },
    ]);
    assert.equal(folded.missReason, 'left_before_dwell');
  });

  test('an unknown click and an unclicked impression stay different', () => {
    // Pill openers mint no VariantImpression, so there is no click to read.
    const noImpression = fold([{ aiDecisionId: 'd', wasShown: true, rendered: true, converted: true, impressionId: null }]);
    assert.equal(noImpression.hasImpression, false);
    const unclicked = fold(
      [{ aiDecisionId: 'd', wasShown: true, rendered: true, converted: true, impressionId: 'i1' }],
      new Map([['i1', false]])
    );
    assert.equal(unclicked.hasImpression, true);
    assert.equal(unclicked.clicked, false);
  });

  test('no rows folds to nothing rather than an empty shell', () => {
    assert.equal(foldOutcomeRows([]).size, 0);
  });
});
