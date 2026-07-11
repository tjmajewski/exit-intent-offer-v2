// Unit harness for phase 4 hierarchical-pooling pure functions.
// Standalone node script (no test runner, matches golden-master.mjs):
//
//   node scripts/dev/test-cluster-priors.mjs

import {
  aovBandFromValue, mapProductTypeToVertical, normalizeVertical,
  clusterKeysFor, clusterKey, shopClusterDims
} from '../../app/utils/store-cluster.server.js';
import { blendWithPrior, VARIANT_PRIOR_WEIGHT } from '../../app/utils/cluster-priors.server.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)})`);

// --- aovBandFromValue boundaries ---
eq(aovBandFromValue(49.99), 'low', 'AOV 49.99 -> low');
eq(aovBandFromValue(50), 'mid', 'AOV 50 -> mid');
eq(aovBandFromValue(150), 'mid', 'AOV 150 -> mid');
eq(aovBandFromValue(150.01), 'high', 'AOV 150.01 -> high');
eq(aovBandFromValue(0), null, 'AOV 0 -> null');
eq(aovBandFromValue(null), null, 'AOV null -> null');
eq(aovBandFromValue(NaN), null, 'AOV NaN -> null');

// --- vertical keyword mapping ---
eq(mapProductTypeToVertical('Fashion Jewelry'), 'jewelry', 'fashion jewelry clusters as jewelry (order matters)');
eq(mapProductTypeToVertical('Sneakers'), 'fashion', 'sneakers -> fashion');
eq(mapProductTypeToVertical('Bluetooth Speaker'), 'electronics', 'speaker -> electronics');
eq(mapProductTypeToVertical('Dog Treats'), 'pets', 'dog treats -> pets');
eq(mapProductTypeToVertical('Organic Face Serum Skincare'), 'beauty', 'skincare -> beauty');
eq(mapProductTypeToVertical('zzzz'), null, 'unmapped -> null');
eq(mapProductTypeToVertical(''), null, 'empty -> null');

// --- normalizeVertical ---
eq(normalizeVertical('Jewelry'), 'jewelry', 'self-report case-normalized');
eq(normalizeVertical('necklaces and rings'), 'jewelry', 'free-text self-report mapped');
eq(normalizeVertical(null), null, 'null self-report');

// --- cluster keys ---
eq(JSON.stringify(clusterKeysFor({ derivedVertical: 'jewelry', aovBand: 'high' })),
   JSON.stringify(['v:jewelry|a:high', 'v:jewelry']),
   'full cluster -> two keys, most-specific first');
eq(JSON.stringify(clusterKeysFor({ derivedVertical: 'jewelry', aovBand: null })),
   JSON.stringify(['v:jewelry']),
   'vertical only -> one key');
eq(JSON.stringify(clusterKeysFor({ derivedVertical: null, storeVertical: 'Jewelry', aovBand: 'low' })),
   JSON.stringify(['v:jewelry|a:low', 'v:jewelry']),
   'self-reported vertical used when derivation absent');
eq(JSON.stringify(clusterKeysFor({ aovBand: 'high' })),
   JSON.stringify(['a:high']),
   'band only -> aov key');
eq(JSON.stringify(clusterKeysFor({})), JSON.stringify([]), 'no dims -> empty (global fallback)');
eq(clusterKey('jewelry', 'high'), 'v:jewelry|a:high', 'clusterKey full');
eq(clusterKey('jewelry', null), 'v:jewelry', 'clusterKey vertical only');

// --- shopClusterDims precedence ---
eq(shopClusterDims({ derivedVertical: 'beauty', storeVertical: 'fashion' }).vertical, 'beauty',
   'derived vertical trumps self-report');

// --- blendWithPrior math ---
const flat = blendWithPrior(3, 47, undefined, undefined);
assert(flat.alpha === 4 && flat.beta === 48, 'no prior -> flat Beta(conv+1, fail+1)');

const cold = blendWithPrior(0, 0, 0.05, VARIANT_PRIOR_WEIGHT);
assert(Math.abs(cold.alpha - 6) < 1e-9 && Math.abs(cold.beta - 96) < 1e-9,
  `cold variant + 5% prior -> Beta(6, 96), mean ${(cold.alpha / (cold.alpha + cold.beta)).toFixed(3)} ~ prior`);

const warm = blendWithPrior(100, 900, 0.5, VARIANT_PRIOR_WEIGHT);
const warmMean = warm.alpha / (warm.alpha + warm.beta);
assert(Math.abs(warmMean - 0.1) < 0.05,
  `1000 own impressions dominate a wild 50% prior (mean ${warmMean.toFixed(3)} ~ own 0.100)`);

const invalid = blendWithPrior(2, 8, 1.7, 100);
assert(invalid.alpha === 3 && invalid.beta === 9, 'out-of-range prior CVR ignored -> flat');

const negGuard = blendWithPrior(-5, -5, 0.1, 100);
assert(negGuard.alpha >= 1 && negGuard.beta >= 1, 'negative counts clamped');

console.log(failures === 0 ? '\nCLUSTER PRIORS: ALL TESTS PASS' : `\nCLUSTER PRIORS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
