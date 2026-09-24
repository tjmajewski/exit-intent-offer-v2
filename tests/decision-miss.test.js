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
import { describeMiss, summarizeDecision, resultKind } from '../app/components/admin/decision-summary.js';

const modal = readFileSync(
  new URL('../extensions/exit-intent-modal/assets/exit-intent-modal.js', import.meta.url), 'utf8');
const endpoint = readFileSync(
  new URL('../app/routes/apps.exit-intent.api.decision-miss.jsx', import.meta.url), 'utf8');

const REASONS = ['trigger_never_fired', 'competing_popup_dropped', 'left_before_idle'];

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

  test('a row that rendered never shows a miss', () => {
    const summary = summarizeDecision(row({ wasShown: true, rendered: true, converted: false, missReason: null }));
    assert.equal(summary.facts.miss, null);
    assert.equal(resultKind(summary.result, summary.source), 'shown');
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
  test('the three mobile exit signals are wired', () => {
    const fn = modal.slice(modal.indexOf('setupMobileExitTriggers('));
    assert.ok(/addEventListener\('popstate'/.test(fn), 'no back-gesture trigger');
    assert.ok(/addEventListener\('visibilitychange'/.test(fn), 'no tab-return trigger');
    assert.ok(/addEventListener\('scroll'/.test(fn), 'no scroll-flick trigger');
  });

  test('both AI tiers arm them for a gene that asked for exit intent', () => {
    const armings = [...modal.matchAll(/setupMobileExitTriggers\(/g)];
    // Pro, Enterprise, and the pill-escalation watch.
    assert.ok(armings.length >= 3, `only ${armings.length} call sites arm mobile exit triggers`);
    assert.ok(
      /isMobile && \(triggerType === 'exit_intent' \|\| triggerType === 'exit_intent_or_idle'\)/.test(modal),
      'mobile exit triggers are not gated on an exit-intent gene'
    );
  });

  test('nothing renders the modal to a hidden tab', () => {
    // Showing while document.hidden would book an impression nobody saw. The
    // tab-return trigger must fire on the way BACK, never on the way out.
    const fn = modal.slice(modal.indexOf('setupMobileExitTriggers('), modal.indexOf('setupIdleTrigger(seconds'));
    const hiddenBranch = fn.slice(fn.indexOf('if (document.hidden)'), fn.indexOf('window.addEventListener'));
    assert.ok(!/fire\(/.test(hiddenBranch), 'a modal can be shown while the tab is hidden');
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
    const where = endpoint.slice(endpoint.indexOf('updateMany'), endpoint.indexOf('data: { missReason'));
    assert.ok(/rendered:\s*false/.test(where), 'a rendered row can still be given a miss reason');
    assert.ok(/missReason:\s*null/.test(where), 'a second beacon can overwrite the first, truer reason');
  });
});
