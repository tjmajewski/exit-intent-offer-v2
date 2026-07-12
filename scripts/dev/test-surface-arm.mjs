// Unit harness for the opening-surface arm (phase 7a/7b).
//
//   node scripts/dev/test-surface-arm.mjs
//
// Covers journey sessionization (scoreVisitorTouches) including the
// escalation correction — post-escalation conversions must credit the modal
// arm, not the pill that failed — plus chooseOpeningSurface's cold-start and
// mature behavior.

import {
  scoreVisitorTouches, chooseOpeningSurface,
  MIN_ARM_OUTCOMES, PILL_EXPLORATION_RATE
} from '../../app/utils/surface-arm.server.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

const T0 = Date.parse('2026-07-01T12:00:00Z');
const ts = (mins) => new Date(T0 + mins * 60 * 1000).toISOString();
const KEY = 'd:mobile|t:paid|a:guest|p:product|pr:no|f:first';

// --- plain modal opener, converts ---
let pulls = scoreVisitorTouches([
  { surface: 'modal', response: 'shown', segmentKey: KEY, timestamp: ts(0) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: ts(30) }
]);
assert(pulls.length === 1 && pulls[0].surface === 'modal' && pulls[0].converted && pulls[0].device === 'mobile',
  'modal opener + conversion -> one converted modal pull (device from segmentKey)');

// --- pill opener, converts directly (no escalation) ---
pulls = scoreVisitorTouches([
  { surface: 'pill', response: 'shown', segmentKey: KEY, timestamp: ts(0) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: ts(10) }
]);
assert(pulls.length === 1 && pulls[0].surface === 'pill' && pulls[0].converted,
  'pill opener + direct conversion -> converted pill pull');

// --- ESCALATION CORRECTION: pill ignored, modal escalates, THEN converts ---
pulls = scoreVisitorTouches([
  { surface: 'pill', response: 'shown', segmentKey: KEY, timestamp: ts(0) },
  { surface: 'modal', response: 'escalated', segmentKey: null, timestamp: ts(5) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: ts(20) }
]);
{
  const pill = pulls.find(p => p.surface === 'pill');
  const modal = pulls.find(p => p.surface === 'modal');
  assert(pulls.length === 2, 'escalated session produces two pulls (pill + modal)');
  assert(pill && !pill.converted, 'pill pull NOT credited (conversion came after escalation)');
  assert(modal && modal.converted, 'escalated modal pull credited with the conversion');
  assert(modal && modal.device === 'mobile', 'escalated pull inherits device from the opener pill');
}

// --- conversion BEFORE escalation stays with the pill ---
pulls = scoreVisitorTouches([
  { surface: 'pill', response: 'shown', segmentKey: KEY, timestamp: ts(0) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: ts(3) },
  { surface: 'modal', response: 'escalated', segmentKey: null, timestamp: ts(5) }
]);
{
  const pill = pulls.find(p => p.surface === 'pill');
  assert(pill && pill.converted, 'conversion before escalation credits the pill');
}

// --- conversion outside the 24h window doesn't credit ---
pulls = scoreVisitorTouches([
  { surface: 'modal', response: 'shown', segmentKey: KEY, timestamp: ts(0) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: ts(25 * 60) }
]);
assert(pulls.length === 1 && !pulls[0].converted, '25h-later conversion outside the attribution window');

// --- unknown segmentKey pools to all ---
pulls = scoreVisitorTouches([
  { surface: 'modal', response: 'shown', segmentKey: null, timestamp: ts(0) }
]);
assert(pulls[0].device === 'all', 'missing segmentKey pools into the all cell');

// --- chooseOpeningSurface: cold start explores at the floor ---
{
  let pillCount = 0;
  for (let i = 0; i < 4000; i++) if (chooseOpeningSurface(null) === 'pill') pillCount++;
  const rate = pillCount / 4000;
  assert(Math.abs(rate - PILL_EXPLORATION_RATE) < 0.03,
    `cold start pill rate ~${PILL_EXPLORATION_RATE} (got ${rate.toFixed(3)})`);
}

// --- mature arms: a clearly better pill wins most of the time ---
{
  const stats = {
    modal: { shown: 500, converted: 10 }, // 2%
    pill: { shown: 500, converted: 40 }   // 8%
  };
  let pillCount = 0;
  for (let i = 0; i < 2000; i++) if (chooseOpeningSurface(stats) === 'pill') pillCount++;
  const rate = pillCount / 2000;
  assert(rate > 0.8, `dominant pill arm wins most tournaments (got ${rate.toFixed(3)})`);
  assert(rate < 1.0, 'exploration floor keeps the modal arm alive');
}

// --- thin arms stay on the exploration floor ---
{
  const stats = {
    modal: { shown: MIN_ARM_OUTCOMES + 5, converted: 1 },
    pill: { shown: 3, converted: 3 } // hot but tiny
  };
  let pillCount = 0;
  for (let i = 0; i < 4000; i++) if (chooseOpeningSurface(stats) === 'pill') pillCount++;
  const rate = pillCount / 4000;
  assert(Math.abs(rate - PILL_EXPLORATION_RATE) < 0.03,
    `immature pill arm can't run away on 3 lucky outcomes (got ${rate.toFixed(3)})`);
}

console.log(failures === 0 ? '\nSURFACE ARM: ALL TESTS PASS' : `\nSURFACE ARM: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
