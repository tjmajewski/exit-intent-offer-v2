// Unit harness for phase 7c generated-copy validation + 7a surface-arm logic.
//
//   node scripts/dev/test-generated-copy.mjs

import { validateCandidate } from '../../app/utils/generated-copy.server.js';
import { chooseOpeningSurface, scoreVisitorTouches } from '../../app/utils/surface-arm.server.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

// --- validateCandidate: placeholder discipline ---
assert(validateCandidate('conversion_with_discount', 'headline', 'Hold on — take {{amount}}% off your order'),
  'discount headline with {{amount}} accepted');
assert(!validateCandidate('conversion_no_discount', 'headline', 'Take {{amount}}% off now'),
  'no-discount baseline rejects {{amount}}');
assert(!validateCandidate('conversion_with_discount', 'cta', 'Claim {{amount}}% off'),
  'CTA with placeholder rejected');
assert(!validateCandidate('conversion_with_discount', 'headline', 'Save {{percent}} today'),
  'unknown placeholder rejected');

// --- validateCandidate: length + tone rails ---
assert(!validateCandidate('conversion_with_discount', 'headline', 'x'.repeat(71)),
  'over-length headline rejected');
assert(!validateCandidate('conversion_with_discount', 'cta', 'This call to action is far too long'),
  'over-length CTA rejected');
assert(!validateCandidate('conversion_with_discount', 'headline', 'BUY NOW!! HUGE SAVINGS!!'),
  'double exclamation rejected');
assert(!validateCandidate('conversion_with_discount', 'headline', 'MASSIVE CLEARANCE EVENT TODAY'),
  'all-caps shouting rejected');
assert(!validateCandidate('conversion_with_discount', 'headline', ''),
  'empty rejected');
assert(!validateCandidate('conversion_with_discount', 'headline', null),
  'non-string rejected');
assert(validateCandidate('pure_reminder', 'subhead', 'Your cart is saved and waiting for you'),
  'clean no-discount subhead accepted');

// --- surface arm: cold start explores at a bounded rate ---
let pills = 0;
for (let i = 0; i < 2000; i++) {
  if (chooseOpeningSurface(null) === 'pill') pills++;
}
assert(pills > 100 && pills < 320,
  `cold start opens pill ~10% of the time (${(pills / 20).toFixed(1)}%)`);

// --- surface arm: mature stats route to the winner ---
// Thresholds leave room for Thompson uncertainty + the 10% exploration
// floor: a "clear" winner should take ~85-90% of tournaments, so assert
// >75% over 2000 draws (sd of the estimate ≈ 0.8pt — not flake territory).
const pillWins = {
  modal: { shown: 400, converted: 12 },  // 3%
  pill: { shown: 400, converted: 40 }    // 10%
};
let pillPicks = 0;
for (let i = 0; i < 2000; i++) {
  if (chooseOpeningSurface(pillWins) === 'pill') pillPicks++;
}
assert(pillPicks > 1500, `clear pill winner gets most traffic (${pillPicks}/2000)`);

const modalWins = {
  modal: { shown: 400, converted: 40 },  // 10%
  pill: { shown: 400, converted: 12 }    // 3%
};
let modalPicks = 0;
for (let i = 0; i < 2000; i++) {
  if (chooseOpeningSurface(modalWins) === 'modal') modalPicks++;
}
assert(modalPicks > 1500, `clear modal winner keeps most traffic (${modalPicks}/2000)`);

// --- journey sessionization: opener pulls + 24h conversion window ---
const t0 = Date.now();
const touches = [
  { surface: 'pill', response: 'shown', segmentKey: 'd:mobile|t:paid|a:guest|p:cart|pr:no|f:first', timestamp: new Date(t0) },
  { surface: 'order', response: 'converted', segmentKey: null, timestamp: new Date(t0 + 60 * 60 * 1000) },
  { surface: 'modal', response: 'shown', segmentKey: 'd:desktop|t:email|a:loyal|p:cart|pr:no|f:frequent', timestamp: new Date(t0 + 5 * 24 * 60 * 60 * 1000) }
];
const pulls = scoreVisitorTouches(touches);
assert(pulls.length === 2, `two arm pulls scored (${pulls.length})`);
assert(pulls[0].surface === 'pill' && pulls[0].converted === true && pulls[0].device === 'mobile',
  'pill opener credited with the conversion inside 24h');
assert(pulls[1].surface === 'modal' && pulls[1].converted === false,
  'later modal opener not credited with the stale conversion');

console.log(failures === 0 ? '\nGENERATED COPY + SURFACE ARM: ALL TESTS PASS' : `\nGENERATED COPY + SURFACE ARM: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
