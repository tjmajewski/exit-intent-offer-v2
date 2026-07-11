// Unit harness for phase 6a evidence-gated discount decision.
//
//   node scripts/dev/test-discount-arm.mjs
//
// Verifies the aggression -> confidence-bar mapping, the cold-start
// fallback, and that the Monte-Carlo verdict is deterministic in the three
// regimes that matter: clear discount win, clear no-discount win (discount
// converts equally but burns margin), and a borderline case where the
// aggression dial itself decides.

import {
  requiredConfidence, decideDiscountBaseline, probDiscountWins, MIN_ARM_OUTCOMES
} from '../../app/utils/discount-arm.server.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

// --- aggression -> confidence bar ---
assert(Math.abs(requiredConfidence(1) - 0.905) < 1e-9, 'aggression 1 -> bar 0.905');
assert(Math.abs(requiredConfidence(5) - 0.725) < 1e-9, 'aggression 5 -> bar 0.725');
assert(Math.abs(requiredConfidence(10) - 0.5) < 1e-9, 'aggression 10 -> bar 0.50');
assert(Math.abs(requiredConfidence(99) - 0.5) < 1e-9, 'aggression clamps high');
assert(Math.abs(requiredConfidence(NaN) - 0.725) < 1e-9, 'invalid aggression -> default 5');

// --- cold start: thin arms keep the coin flip ---
const thin = {
  discount: { impressions: MIN_ARM_OUTCOMES - 1, conversions: 3, profit: 90 },
  noDiscount: { impressions: 500, conversions: 20, profit: 900 }
};
assert(decideDiscountBaseline(thin, 5).evidenceBased === false, 'thin discount arm -> not evidence-based');
assert(decideDiscountBaseline(null, 5).evidenceBased === false, 'missing arms -> not evidence-based');
assert(probDiscountWins({ discount: null, noDiscount: null }) === null, 'probDiscountWins null-safe');

// --- clear discount win: 10% CVR @ $40/conv vs 4% @ $50/conv ---
const clearWin = {
  discount: { impressions: 500, conversions: 50, profit: 2000 },
  noDiscount: { impressions: 500, conversions: 20, profit: 1000 }
};
const winVerdict = decideDiscountBaseline(clearWin, 1); // strictest bar
assert(winVerdict.evidenceBased && winVerdict.useDiscount,
  `clear winner clears even the 0.905 bar (pWin=${winVerdict.pWin?.toFixed(3)})`);

// --- clear no-discount win: same CVR, discount burns margin ---
const marginBurn = {
  discount: { impressions: 500, conversions: 25, profit: 750 },   // 5% @ $30
  noDiscount: { impressions: 500, conversions: 25, profit: 1250 } // 5% @ $50
};
const burnVerdict = decideDiscountBaseline(marginBurn, 10); // loosest bar
assert(burnVerdict.evidenceBased && !burnVerdict.useDiscount,
  `margin-burning discount rejected even at aggression 10 (pWin=${burnVerdict.pWin?.toFixed(3)})`);

// --- borderline (~0.77 pWin): the dial decides ---
const borderline = {
  discount: { impressions: 400, conversions: 28, profit: 1120 },  // 7% @ $40
  noDiscount: { impressions: 400, conversions: 20, profit: 900 }  // 5% @ $45
};
const atTen = decideDiscountBaseline(borderline, 10);
const atOne = decideDiscountBaseline(borderline, 1);
assert(atTen.evidenceBased && atTen.useDiscount,
  `borderline case discounts at aggression 10 (pWin=${atTen.pWin?.toFixed(3)} >= 0.50)`);
assert(atOne.evidenceBased && !atOne.useDiscount,
  `same case holds margin at aggression 1 (pWin=${atOne.pWin?.toFixed(3)} < 0.905)`);

// --- determinism of the verdict for identical visitors ---
const v1 = decideDiscountBaseline(clearWin, 5).useDiscount;
const v2 = decideDiscountBaseline(clearWin, 5).useDiscount;
const v3 = decideDiscountBaseline(clearWin, 5).useDiscount;
assert(v1 === v2 && v2 === v3, 'identical inputs -> identical treatment (no RNG in the verdict)');

console.log(failures === 0 ? '\nDISCOUNT ARM: ALL TESTS PASS' : `\nDISCOUNT ARM: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
