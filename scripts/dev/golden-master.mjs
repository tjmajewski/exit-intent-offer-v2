// Golden-master regression guard for the unified offer engine.
// No test runner in this project, so this is a standalone node harness:
//
//   node scripts/dev/golden-master.mjs            # compare vs saved golden
//   node scripts/dev/golden-master.mjs --update   # regenerate the golden file
//
// Runs decideOffer over a fixed matrix of representative scenarios and diffs
// the result against scripts/dev/golden-master.json. Any drift in behavior
// (offer type, amount, ceiling, timing, triggerReason, confidence) fails with
// a per-field diff. Eyeball the snapshot once on --update; it then guards
// against accidental changes. Also locks computePropensity for full-signal
// scenarios (propensityScore omitted => engine scores it).
//
// Determinism: testMode true + shopId null => no DB, no adaptive threshold;
// engine has no Math.random / Date dependence on these paths.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decideOffer } from '../../app/utils/ai-decision.server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'golden-master.json');
const UPDATE = process.argv.includes('--update');

// Fields we pin. Reasoning copy intentionally excluded — it embeds P/amounts
// already covered by the structured fields and would make the golden brittle.
const PINNED = ['show', 'propensity', 'triggerReason', 'timing', 'ceilingPercent', 'type', 'amount', 'threshold', 'confidence'];

// ---------------------------------------------------------------------------
// Scenario matrix. `P` (when set) is stamped as propensityScore for a
// deterministic ceiling; scenarios without P exercise computePropensity.
// ---------------------------------------------------------------------------
const scenarios = [
  // --- ceiling curve across propensity (agg 5, conversion) ---
  { name: 'P95 high-propensity announce', signals: { propensityScore: 95, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'P85 announce boundary',        signals: { propensityScore: 85, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'P80 first discount',           signals: { propensityScore: 80, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'P60 mid taper',                signals: { propensityScore: 60, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'P30 low propensity',           signals: { propensityScore: 30, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'P10 floor of curve',           signals: { propensityScore: 10, cartValue: 80, deviceType: 'desktop' }, ctx: { aggression: 5 } },

  // --- aggression dial at fixed mid propensity ---
  { name: 'P50 aggression 0 announce', signals: { propensityScore: 50, cartValue: 80 }, ctx: { aggression: 0 } },
  { name: 'P50 aggression 2',          signals: { propensityScore: 50, cartValue: 80 }, ctx: { aggression: 2 } },
  { name: 'P50 aggression 10 max',     signals: { propensityScore: 50, cartValue: 80 }, ctx: { aggression: 10 } },

  // --- margin sensitivity (low agm clamps harder) ---
  { name: 'P30 thin margin 0.25', signals: { propensityScore: 30, cartValue: 80 }, ctx: { aggression: 8, assumedGrossMargin: 0.25 } },
  { name: 'P30 fat margin 0.60',  signals: { propensityScore: 30, cartValue: 80 }, ctx: { aggression: 8, assumedGrossMargin: 0.60 } },

  // --- trigger reasons / timing ---
  { name: 'failed coupon immediate',  signals: { propensityScore: 55, cartValue: 80, failedCouponAttempt: true }, ctx: { aggression: 5 } },
  { name: 'checkout exit immediate',  signals: { propensityScore: 55, cartValue: 80, exitPage: 'checkout' }, ctx: { aggression: 5 } },
  { name: 'cart hesitation trigger',  signals: { propensityScore: 55, cartValue: 80, cartHesitation: 2 }, ctx: { aggression: 5 } },
  { name: 'stale cart trigger',       signals: { propensityScore: 55, cartValue: 80, cartAgeMinutes: 90 }, ctx: { aggression: 5 } },

  // --- revenue mode (threshold/AOV offer) ---
  { name: 'revenue mode single item', signals: { propensityScore: 40, cartValue: 120, exitPage: 'product', itemCount: 1, aiGoal: 'revenue' }, ctx: { aggression: 6 } },
  { name: 'revenue mode multi item',  signals: { propensityScore: 40, cartValue: 120, itemCount: 3, aiGoal: 'revenue' }, ctx: { aggression: 6 } },

  // --- full-signal scenarios that exercise computePropensity ---
  { name: 'computeP: engaged repeat buyer', signals: { purchaseHistoryCount: 5, customerLifetimeValue: 600, accountStatus: 'logged_in', timeOnSite: 120, pageViews: 8, scrollDepth: 70, visitFrequency: 4, trafficSource: 'email', cartValue: 150, itemCount: 2, deviceType: 'desktop' }, ctx: { aggression: 5 } },
  { name: 'computeP: discount seeker',      signals: { failedCouponAttempt: true, cartHesitation: 3, hasAbandonedBefore: true, abandonmentCount: 2, visitFrequency: 1, timeOnSite: 40, cartValue: 60, deviceType: 'mobile', exitPage: 'cart' }, ctx: { aggression: 7 } },
  { name: 'computeP: cold first-timer',     signals: { visitFrequency: 1, timeOnSite: 10, pageViews: 1, cartValue: 25, deviceType: 'mobile', accountStatus: 'guest' }, ctx: { aggression: 5 } },
];

// Suppress the engine's [Funnel Stage] / [Offer Engine] debug logging.
function silence(fn) {
  const orig = console.log;
  console.log = () => {};
  return Promise.resolve(fn()).finally(() => { console.log = orig; });
}

function pick(obj) {
  if (obj == null) return null;
  const out = {};
  for (const k of PINNED) out[k] = obj[k] ?? null;
  return out;
}

const results = {};
for (const s of scenarios) {
  const r = await silence(() => decideOffer(s.signals, { shopId: null, testMode: true, ...s.ctx }));
  results[s.name] = pick(r);
}

if (UPDATE || !existsSync(GOLDEN)) {
  writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
  console.log(`${UPDATE ? 'Updated' : 'Created'} golden master: ${GOLDEN}`);
  console.log(`${Object.keys(results).length} scenarios snapshotted.`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let failures = 0;
const allNames = new Set([...Object.keys(golden), ...Object.keys(results)]);

for (const name of allNames) {
  const exp = golden[name];
  const got = results[name];
  if (exp === undefined) { console.error(`  NEW scenario not in golden: "${name}" (run --update)`); failures++; continue; }
  if (got === undefined) { console.error(`  MISSING scenario present in golden: "${name}" (run --update)`); failures++; continue; }
  const expJson = JSON.stringify(exp);
  const gotJson = JSON.stringify(got);
  if (expJson !== gotJson) {
    failures++;
    console.error(`  DRIFT in "${name}":`);
    const fields = exp == null || got == null ? ['(whole result)'] : PINNED;
    if (exp == null || got == null) {
      console.error(`    expected ${expJson}  got ${gotJson}`);
    } else {
      for (const f of fields) {
        if (JSON.stringify(exp[f]) !== JSON.stringify(got[f])) {
          console.error(`    ${f}: expected ${JSON.stringify(exp[f])}  got ${JSON.stringify(got[f])}`);
        }
      }
    }
  }
}

console.log('');
if (failures > 0) {
  console.error(`GOLDEN MASTER: ${failures} DRIFT(S) — review, then re-snapshot with --update if intended`);
  process.exit(1);
}
console.log(`GOLDEN MASTER: ALL ${allNames.size} SCENARIOS MATCH`);
