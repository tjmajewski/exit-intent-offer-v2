// Synthetic-data test for the calibrated propensity model.
// No DB, no test runner — standalone harness like golden-master.mjs:
//
//   node scripts/dev/test-propensity-model.mjs
//
// Generates visitors from known ground-truth log-odds, trains the plain-JS
// logistic implementation, and asserts:
//   1. held-out AUC beats 0.75 (the model learns),
//   2. the strongest ground-truth signals are recovered with correct sign,
//   3. scorePropensity round-trips through the stored-model shape (0-100),
//   4. store intercepts move scores in the right direction.

import {
  extractFeatures, trainLogistic, fitStoreIntercept, computeAUC,
  scorePropensity, FEATURE_NAMES, MODEL_VERSION
} from '../../app/utils/propensity-model.server.js';

// Deterministic PRNG (mulberry32) so the test can't flake
let seed = 42;
function rand() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Ground truth: purchase history and time-on-site push conversion UP,
// failed coupon and first visit push it DOWN. Everything else is noise.
function makeSignals() {
  return {
    purchaseHistoryCount: rand() < 0.3 ? Math.floor(rand() * 10) : 0,
    customerLifetimeValue: rand() * 500,
    accountStatus: rand() < 0.4 ? 'logged_in' : 'guest',
    timeOnSite: rand() * 300,
    pageViews: 1 + Math.floor(rand() * 10),
    scrollDepth: rand() * 100,
    productDwellTime: rand() * 120,
    visitFrequency: 1 + Math.floor(rand() * 6),
    trafficSource: ['paid', 'email', 'direct', 'social', 'organic'][Math.floor(rand() * 5)],
    exitPage: ['checkout', 'cart', 'product', 'collection', 'home'][Math.floor(rand() * 5)],
    cartValue: 10 + rand() * 300,
    itemCount: 1 + Math.floor(rand() * 4),
    cartAgeMinutes: rand() * 90,
    failedCouponAttempt: rand() < 0.15,
    cartHesitation: Math.floor(rand() * 4),
    hasAbandonedBefore: rand() < 0.25,
    abandonmentCount: Math.floor(rand() * 3),
    deviceType: rand() < 0.6 ? 'mobile' : 'desktop',
    localHour: Math.floor(rand() * 24),
    dayOfWeek: Math.floor(rand() * 7)
  };
}

function trueLogOdds(s) {
  return -1.2
    + 0.9 * Math.log1p(s.purchaseHistoryCount)
    + 0.5 * Math.log1p(s.timeOnSite / 30)
    - 1.4 * (s.failedCouponAttempt ? 1 : 0)
    - 0.6 * (s.visitFrequency <= 1 ? 1 : 0);
}

const N = 4000;
const rows = [];
for (let i = 0; i < N; i++) {
  const s = makeSignals();
  rows.push({ s, x: extractFeatures(s), y: rand() < sigmoid(trueLogOdds(s)) ? 1 : 0 });
}

const train = rows.slice(0, 3200);
const test = rows.slice(3200);

const model = trainLogistic(train.map((r) => r.x), train.map((r) => r.y));

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

// 1. Held-out AUC — labels are Bernoulli draws, so even the TRUE model has
// an irreducible AUC ceiling. Assert the trained model lands within 0.03 of
// the ground-truth scorer's AUC on the same held-out set.
const testScores = test.map((r) => {
  let z = model.bias;
  for (let j = 0; j < r.x.length; j++) z += model.weights[j] * ((r.x[j] - model.means[j]) / model.stds[j]);
  return z;
});
const auc = computeAUC(testScores, test.map((r) => r.y));
const trueAuc = computeAUC(test.map((r) => trueLogOdds(r.s)), test.map((r) => r.y));
assert(auc > trueAuc - 0.03, `held-out AUC ${auc.toFixed(3)} within 0.03 of Bayes-optimal ${trueAuc.toFixed(3)}`);

// 2. Sign recovery of the ground-truth drivers
const w = (name) => model.weights[FEATURE_NAMES.indexOf(name)];
assert(w('logPurchases') > 0.1, `logPurchases weight ${w('logPurchases').toFixed(3)} recovered positive`);
assert(w('logTimeOnSite') > 0.05, `logTimeOnSite weight ${w('logTimeOnSite').toFixed(3)} recovered positive`);
assert(w('failedCoupon') < -0.1, `failedCoupon weight ${w('failedCoupon').toFixed(3)} recovered negative`);
assert(w('firstVisit') < -0.02, `firstVisit weight ${w('firstVisit').toFixed(3)} recovered negative`);

// 3. scorePropensity round-trip through the stored-model shape
const stored = { featureVersion: MODEL_VERSION, ...model, storeIntercepts: { shopA: 1.0 } };
const sHigh = makeSignals();
sHigh.purchaseHistoryCount = 12; sHigh.timeOnSite = 280; sHigh.failedCouponAttempt = false; sHigh.visitFrequency = 5;
const sLow = makeSignals();
sLow.purchaseHistoryCount = 0; sLow.timeOnSite = 5; sLow.failedCouponAttempt = true; sLow.visitFrequency = 1;
const pHigh = scorePropensity(stored, sHigh);
const pLow = scorePropensity(stored, sLow);
assert(pHigh >= 0 && pHigh <= 100 && pLow >= 0 && pLow <= 100, `scores in 0-100 (high=${pHigh}, low=${pLow})`);
assert(pHigh > pLow, `committed customer scores above discount-hunter (${pHigh} > ${pLow})`);

// 4. Store intercept direction: a store where everyone converts gets a
// positive offset; scores rise for that store.
const shopRows = train.slice(0, 120);
const delta = fitStoreIntercept(model, shopRows.map((r) => r.x), shopRows.map(() => 1));
assert(delta > 0.3, `all-converting store intercept ${delta.toFixed(3)} > 0.3`);
const storedB = { featureVersion: MODEL_VERSION, ...model, storeIntercepts: { hot: delta } };
assert(
  scorePropensity(storedB, sLow, 'hot') > scorePropensity(storedB, sLow, 'coldshop'),
  'intercept lifts the hot store\'s score'
);

// 5. Mismatched feature version / vector length returns null (stale-model guard)
assert(scorePropensity({ ...model, weights: model.weights.slice(0, 5) }, sLow) === null,
  'mismatched weight vector returns null');

console.log(failures === 0 ? '\nPROPENSITY MODEL: ALL TESTS PASS' : `\nPROPENSITY MODEL: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
