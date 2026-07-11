// Unit harness for phase 5 per-segment stats logic.
//
//   node scripts/dev/test-segment-stats.mjs
//
// Covers the device-coarsening helper and the two-level shrinkage chain
// (cell -> pooled posterior) that selection applies: a cell with real data
// must be able to flip the preference away from the pooled winner, while a
// thin cell barely moves it.

import { deviceKeyFromSegmentKey, composeSegmentKey } from '../../app/utils/segment-key.js';
import { blendWithPrior } from '../../app/utils/cluster-priors.server.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
};
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)})`);

// --- deviceKeyFromSegmentKey ---
eq(deviceKeyFromSegmentKey('d:mobile|t:paid|a:guest|p:product|pr:no|f:first'), 'd:mobile',
   'full composite -> device token');
eq(deviceKeyFromSegmentKey('d:desktop|t:email|a:loyal|p:cart|pr:yes|f:frequent'), 'd:desktop',
   'desktop composite -> d:desktop');
eq(deviceKeyFromSegmentKey('d:unknown|t:paid|a:guest|p:product|pr:no|f:first'), null,
   'unknown device -> null (no pooling of unknowns)');
eq(deviceKeyFromSegmentKey('mobile_paid'), null, 'legacy coarse segment -> null');
eq(deviceKeyFromSegmentKey(null), null, 'null -> null');
eq(deviceKeyFromSegmentKey('d:mobile'), 'd:mobile', 'already-coarse key round-trips');

// composeSegmentKey output feeds straight into the coarsener
const composed = composeSegmentKey({ deviceType: 'Mobile', trafficSource: 'paid', accountStatus: 'guest', pageType: 'product', promoInCart: false, visitFrequency: 1 });
eq(deviceKeyFromSegmentKey(composed), 'd:mobile', 'composed key coarsens cleanly');

// --- shrinkage chain: cell overrides pooled preference ---
const CELL_PRIOR_WEIGHT = 20; // mirror variant-engine constant
const mean = ({ alpha, beta }) => alpha / (alpha + beta);
const chain = (pooledConv, pooledFail, cellConv, cellFail) => {
  const pooled = blendWithPrior(pooledConv, pooledFail, undefined, undefined);
  return mean(blendWithPrior(cellConv, cellFail, mean(pooled), CELL_PRIOR_WEIGHT));
};

// Pooled: A converts 10%, B converts 5% -> pooled prefers A.
// Mobile-paid cell: A 2/60 (3.3%), B 12/60 (20%) -> cell must prefer B.
const aCell = chain(100, 900, 2, 58);
const bCell = chain(50, 950, 12, 48);
assert(bCell > aCell, `cell data flips preference: B ${bCell.toFixed(3)} > A ${aCell.toFixed(3)} despite pooled favoring A`);

// Pooled preference must persist (pooled means untouched by cell rows)
const aPooled = mean(blendWithPrior(100, 900, undefined, undefined));
const bPooled = mean(blendWithPrior(50, 950, undefined, undefined));
assert(aPooled > bPooled, `pooled posterior still favors A (${aPooled.toFixed(3)} > ${bPooled.toFixed(3)})`);

// Thin cell (5 impressions) shrinks hard to pooled: preference must NOT flip.
const aThin = chain(100, 900, 0, 5);
const bThin = chain(50, 950, 2, 3);
assert(Math.abs(aThin - 0.1) < 0.05, `5-impression cell stays near pooled 10% (got ${aThin.toFixed(3)})`);
assert(bThin < 0.2, `tiny hot cell can't run away from pooled 5% (got ${bThin.toFixed(3)})`);

// Big cell dominates: 500-impression cell at 20% lands near 20%.
const big = chain(100, 900, 100, 400);
assert(Math.abs(big - 0.2) < 0.02, `500-impression cell dominates pooled (got ${big.toFixed(3)})`);

console.log(failures === 0 ? '\nSEGMENT STATS: ALL TESTS PASS' : `\nSEGMENT STATS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
